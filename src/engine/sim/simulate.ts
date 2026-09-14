/**
 * Runs a controller behaviour against random traffic from a volume count, tick by tick.
 *
 * Traffic is a point queue per lane group: vehicles arrive as a Poisson process at the count's
 * peak 15-minute flow rate (volume / peak hour factor), wait at the stop bar, and leave at the lane
 * group's saturation flow while its phase is green. A stop-bar detector is occupied while a queue is
 * waiting or a vehicle arrives, and each arrival is an actuation. Pedestrian pushbutton presses are a
 * Poisson process per phase at the rate given in the settings. Everything is seeded, so a run
 * repeats exactly.
 *
 * Delay is the time each vehicle spends in the queue (arrival to departure), so a vehicle that meets
 * a green with no queue has none; it is closest to HCM uniform plus incremental delay without the
 * deceleration and acceleration a real vehicle adds.
 */
import { MOVEMENTS, type Intersection, type Ring } from '../../model';
import { effectiveSequence } from '../../model';
import { saturationFlow } from '../capacity';
import { nextArrivalTicks, seededRandom } from './random';
import { TICKS_PER_SECOND, type ControllerModel, type PedestrianSignal, type Termination, type VehicleSignal } from './types';

export interface SimulationSettings {
  /** The pattern the controller runs, or `null` to run free. */
  patternId: string | null;
  volumeSetId: string;
  /** Simulated time, seconds (after warm-up). */
  durationSeconds: number;
  /** Time simulated first and left out of the statistics, seconds. */
  warmUpSeconds: number;
  seed: number;
  /** Pushbutton presses per hour, by phase number. */
  pedestrianCallsPerHour: Record<string, number>;
}

export const DEFAULT_SIMULATION: Omit<SimulationSettings, 'patternId' | 'volumeSetId'> = { durationSeconds: 3600, warmUpSeconds: 300, seed: 1, pedestrianCallsPerHour: {} };

export interface Stat {
  count: number;
  mean: number | null;
  min: number | null;
  max: number | null;
}

export interface PhaseResult {
  phase: number;
  /** Green times served, seconds. */
  green: Stat;
  terminations: Record<Termination, number>;
  /** Share of cycles in which the phase was served (null without cycles). */
  servedShare: number | null;
  /** Walk intervals served. */
  walks: number;
}

export interface LaneGroupSimResult {
  laneGroupId: string;
  label: string;
  phase: number;
  arrivals: number;
  departures: number;
  /** Mean time in the queue per departed vehicle, seconds. */
  meanDelay: number | null;
  maxQueue: number;
  /** Vehicles still waiting at the end. */
  finalQueue: number;
}

/** A span of a phase's vehicle or pedestrian signal, for playback. Ticks from the start of the run. */
export interface SignalSpan {
  phase: number;
  signal: Exclude<VehicleSignal, 'red'> | Exclude<PedestrianSignal, 'dont-walk'>;
  start: number;
  end: number;
}

export interface SimulationResult {
  controller: string;
  /** Ticks simulated, warm-up included; statistics start at `warmUpTicks`. */
  ticks: number;
  warmUpTicks: number;
  /**
   * Cycle lengths (seconds): time between successive yields of the first coordinated phase when
   * coordinated, otherwise between successive returns to the first barrier group.
   */
  cycle: Stat;
  phases: PhaseResult[];
  laneGroups: LaneGroupSimResult[];
  /** Mean delay over every departed vehicle, seconds. */
  meanDelay: number | null;
  trace: {
    spans: SignalSpan[];
    /** Queue length per lane group, sampled every second (index = second). */
    queues: Record<string, number[]>;
  };
}

function stat(values: readonly number[]): Stat {
  if (values.length === 0) return { count: 0, mean: null, min: null, max: null };
  return { count: values.length, mean: values.reduce((a, b) => a + b, 0) / values.length, min: Math.min(...values), max: Math.max(...values) };
}

/** The barrier group a cycle is counted from: the coordinated phases' group, else the first. */
function homeGroup(intersection: Intersection, patternId: string | null, sequence: Ring[]): number[] {
  const pattern = intersection.patterns.find((p) => p.id === patternId);
  const coordinated = pattern?.mode === 'coordinated' ? new Set(pattern.coordinatedPhases) : new Set<number>();
  const groups = sequence[0]?.groups.length ?? 0;
  for (let g = 0; g < groups; g++) {
    const phases = sequence.flatMap((ring) => ring.groups[g] ?? []);
    if (coordinated.size === 0 ? phases.length > 0 : phases.some((n) => coordinated.has(n))) return phases;
  }
  return [];
}

export function simulate(intersection: Intersection, settings: SimulationSettings, controller: ControllerModel): SimulationResult {
  const set = intersection.volumeSets.find((s) => s.id === settings.volumeSetId);
  const random = seededRandom(settings.seed);
  const warmUpTicks = Math.round(settings.warmUpSeconds * TICKS_PER_SECOND);
  const ticks = warmUpTicks + Math.round(settings.durationSeconds * TICKS_PER_SECOND);
  const pattern = intersection.patterns.find((p) => p.id === settings.patternId);
  const sequence = pattern ? effectiveSequence(pattern, intersection.rings) : intersection.rings;
  const phaseNumbers = [...new Set(sequence.flatMap((r) => r.groups.flat()))].filter((n) => intersection.phases.find((p) => p.number === n)?.enabled).sort((a, b) => a - b);
  const home = new Set(homeGroup(intersection, settings.patternId, sequence));
  const yieldPhase = pattern?.mode === 'coordinated' ? pattern.coordinatedPhases[0] : undefined;

  const lanes = intersection.laneGroups.map((group) => {
    const volumes = set?.volumes[group.id] ?? { left: 0, through: 0, right: 0 };
    const hourly = MOVEMENTS.reduce((sum, m) => sum + volumes[m], 0) / (set?.peakHourFactor ?? 1);
    return {
      group,
      rate: hourly,
      perTick: saturationFlow(intersection, group, volumes).value / 3600 / TICKS_PER_SECOND,
      next: nextArrivalTicks(random, hourly, TICKS_PER_SECOND),
      queue: [] as number[],
      credit: 0,
      arrivals: 0,
      departures: 0,
      delayTicks: 0,
      maxQueue: 0,
      samples: [] as number[],
    };
  });
  const pedestrians = phaseNumbers.map((n) => {
    const rate = settings.pedestrianCallsPerHour[String(n)] ?? 0;
    return { phase: n, rate, next: nextArrivalTicks(random, rate, TICKS_PER_SECOND) };
  });

  const greenStart = new Map<number, number>();
  const greens = new Map<number, number[]>(phaseNumbers.map((n) => [n, []]));
  const walks = new Map<number, number>(phaseNumbers.map((n) => [n, 0]));
  const terminations = new Map<number, Record<Termination, number>>(phaseNumbers.map((n) => [n, { 'gap-out': 0, 'max-out': 0, 'force-off': 0, yield: 0, barrier: 0 }]));
  const served = new Map<number, number>(phaseNumbers.map((n) => [n, 0]));
  const servedThisCycle = new Set<number>();
  const cycleStarts: number[] = [];
  let homeWasActive = false;
  const open = new Map<string, SignalSpan>();
  const spans: SignalSpan[] = [];

  const presence = new Set<number>();
  const actuations = new Set<number>();
  const presses = new Set<number>();

  for (let tick = 0; tick < ticks; tick++) {
    const measuring = tick >= warmUpTicks;
    presence.clear();
    actuations.clear();
    presses.clear();
    for (const lane of lanes) {
      while (lane.next <= tick) {
        lane.queue.push(tick);
        if (measuring) lane.arrivals++;
        actuations.add(lane.group.phase);
        lane.next += nextArrivalTicks(random, lane.rate, TICKS_PER_SECOND);
      }
      if (lane.queue.length > 0) presence.add(lane.group.phase);
    }
    for (const ped of pedestrians) {
      while (ped.next <= tick) {
        presses.add(ped.phase);
        ped.next += nextArrivalTicks(random, ped.rate, TICKS_PER_SECOND);
      }
    }

    controller.step({ tick, presence, actuations, pedestrianPresses: presses });

    // Discharge, statistics and the playback trace.
    for (const lane of lanes) {
      if (controller.signal(lane.group.phase).vehicle === 'green') {
        lane.credit += lane.perTick;
        while (lane.credit >= 1 && lane.queue.length > 0) {
          const arrived = lane.queue.shift()!;
          lane.credit -= 1;
          if (arrived >= warmUpTicks) {
            lane.departures++;
            lane.delayTicks += tick - arrived;
          }
        }
        if (lane.queue.length === 0) lane.credit = Math.min(lane.credit, 1);
      } else {
        lane.credit = 0;
      }
      if (measuring) lane.maxQueue = Math.max(lane.maxQueue, lane.queue.length);
      if (tick % TICKS_PER_SECOND === 0) lane.samples.push(lane.queue.length);
    }

    let homeActive = false;
    for (const n of phaseNumbers) {
      const signal = controller.signal(n);
      if (home.has(n) && signal.vehicle !== 'red') homeActive = true;
      for (const [key, value] of [
        ['v', signal.vehicle === 'red' ? null : signal.vehicle],
        ['p', signal.pedestrian === 'dont-walk' ? null : signal.pedestrian],
      ] as const) {
        const id = `${n}${key}`;
        const current = open.get(id);
        if (current && current.signal !== value) {
          current.end = tick;
          spans.push(current);
          open.delete(id);
        }
        if (value && (!current || current.signal !== value)) {
          open.set(id, { phase: n, signal: value, start: tick, end: tick });
          if (value === 'green') {
            greenStart.set(n, tick);
            servedThisCycle.add(n);
          }
          if (value === 'walk' && measuring) walks.set(n, walks.get(n)! + 1);
        }
        if (current && current.signal === 'green' && value !== 'green' && measuring) {
          greens.get(n)!.push((tick - greenStart.get(n)!) / TICKS_PER_SECOND);
        }
      }
    }
    const drained = controller.drainTerminations();
    for (const t of drained) {
      if (t.tick >= warmUpTicks) terminations.get(t.phase)![t.reason]++;
    }
    const boundary = yieldPhase === undefined ? homeActive && !homeWasActive : drained.some((t) => t.phase === yieldPhase && t.reason === 'yield');
    if (boundary) {
      if (measuring && cycleStarts.length > 0) {
        for (const n of servedThisCycle) served.set(n, served.get(n)! + 1);
      }
      if (measuring) cycleStarts.push(tick);
      servedThisCycle.clear();
      for (const n of phaseNumbers) if (controller.signal(n).vehicle !== 'red') servedThisCycle.add(n);
    }
    homeWasActive = homeActive;
  }
  for (const span of open.values()) spans.push({ ...span, end: ticks });
  spans.sort((a, b) => a.start - b.start || a.phase - b.phase);

  const cycleLengths = cycleStarts.slice(1).map((t, k) => (t - cycleStarts[k]!) / TICKS_PER_SECOND);
  const departed = lanes.reduce((sum, l) => sum + l.departures, 0);
  return {
    controller: controller.name,
    ticks,
    warmUpTicks,
    cycle: stat(cycleLengths),
    phases: phaseNumbers.map((n) => ({
      phase: n,
      green: stat(greens.get(n)!),
      terminations: terminations.get(n)!,
      servedShare: cycleLengths.length > 0 ? served.get(n)! / cycleLengths.length : null,
      walks: walks.get(n)!,
    })),
    laneGroups: lanes.map((l) => ({
      laneGroupId: l.group.id,
      label: l.group.label,
      phase: l.group.phase,
      arrivals: l.arrivals,
      departures: l.departures,
      meanDelay: l.departures > 0 ? l.delayTicks / l.departures / TICKS_PER_SECOND : null,
      maxQueue: l.maxQueue,
      finalQueue: l.queue.length,
    })),
    meanDelay: departed > 0 ? lanes.reduce((sum, l) => sum + l.delayTicks, 0) / departed / TICKS_PER_SECOND : null,
    trace: { spans, queues: Object.fromEntries(lanes.map((l) => [l.group.id, l.samples])) },
  };
}
