/**
 * A generic NEMA dual-ring actuated controller, from SPATT's own model of a plan.
 *
 * Each ring times its phases in sequence within a barrier group: minimum green (raised by added
 * initial under volume density), extension by the passage time (reduced towards the minimum gap),
 * gap-out, max-out on Max 1 or Max 2, the walk and pedestrian clearance, yellow and red clearance.
 * Phases without demand are skipped. A ring that would cross a barrier waits until every ring in the
 * group is ready, then they cross together to the next group with demand; dual-entry phases time
 * in rings that have no demand there.
 *
 * Coordinated patterns add a cycle from the pattern's projection: coordinated phases are always
 * called, never gap or max out, and yield at their scheduled end of green when another phase is
 * waiting; other phases are forced off at their scheduled force-off (fixed), or also after their own
 * split's green (floating), and only start if their minimum green (and a called pedestrian interval)
 * fits before the force-off.
 *
 * Simplifications: simultaneous gap-out at barriers is always on; conditional service is not
 * modelled; the max timer runs while a conflicting call is waiting and holds (does not reset) when
 * the call goes away; volume density's time before reduction counts from the start of green.
 */
import { effectiveSequence, type Intersection, type Phase, type Ring } from '../../model';
import { projectCycle, type CycleProjection } from '../projection';
import { TICKS_PER_TENTH, type ControllerInputs, type ControllerModel, type PhaseSignal, type Termination } from './types';

type Interval = 'green' | 'yellow' | 'red' | 'idle';

interface RingState {
  phase: number | null;
  interval: Interval;
  /** Ticks in the current interval. */
  elapsed: number;
  gap: number;
  maxElapsed: number;
  initial: number;
  pedestrian: 'none' | 'walk' | 'clearance' | 'done';
  pedestrianElapsed: number;
  /** Set once the green could end, while it waits for the other rings to reach the barrier. */
  ready: Termination | null;
  /** Coordinated phases: the tick from which the phase may yield (its next scheduled end of green). */
  yieldTick: number;
}

interface PhaseTiming {
  number: number;
  ring: number;
  group: number;
  minGreen: number;
  passage: number;
  max: number;
  yellow: number;
  redClear: number;
  walk: number;
  pedestrianClearance: number;
  hasPedestrian: boolean;
  recall: Phase['recall'];
  pedestrianRecall: boolean;
  restInWalk: boolean;
  dualEntry: boolean;
  locking: boolean;
  addedInitial: number;
  maxInitial: number;
  timeBeforeReduction: number;
  timeToReduce: number;
  minGap: number;
}

interface CoordinationTiming {
  cycle: number;
  /** Sequence time (ticks) at system tick 0. */
  seqAtZero: number;
  coordinated: Set<number>;
  /** Per phase, sequence ticks: scheduled green start, yellow start (force-off / yield) and split green length. */
  schedule: Map<number, { greenStart: number; yellowStart: number; splitGreen: number }>;
  /** Earliest coordinated yield point (sequence ticks): non-coordinated time is measured from here. */
  yieldRef: number;
  floating: boolean;
}

const mod = (a: number, n: number) => ((a % n) + n) % n;

export interface NemaOptions {
  /** The pattern to run; `null` or a free pattern runs free on Max 1. */
  patternId: string | null;
}

export class NemaController implements ControllerModel {
  readonly name = 'NEMA';
  private readonly phases = new Map<number, PhaseTiming>();
  private readonly sequence: Ring[];
  private readonly groupCount: number;
  private readonly coordination: CoordinationTiming | null;
  private readonly rings: RingState[];
  private group = 0;
  private tick = 0;
  private readonly vehicleCalls = new Set<number>();
  private readonly pedestrianCalls = new Set<number>();
  private readonly redActuations = new Map<number, number>();
  private terminations: { phase: number; reason: Termination; tick: number }[] = [];

  constructor(intersection: Intersection, options: NemaOptions) {
    const pattern = intersection.patterns.find((p) => p.id === options.patternId) ?? null;
    this.sequence = pattern ? effectiveSequence(pattern, intersection.rings) : intersection.rings;
    this.groupCount = this.sequence[0]?.groups.length ?? 0;
    const useMax2 = pattern?.maxGreen === 'max2';
    const byNumber = new Map(intersection.phases.map((p) => [p.number, p]));
    this.sequence.forEach((ring, r) =>
      ring.groups.forEach((group, g) =>
        group.forEach((n) => {
          const p = byNumber.get(n);
          if (!p?.enabled) return;
          const t = (tenths: number) => tenths * TICKS_PER_TENTH;
          const vehicle = p.movement.kind !== 'pedestrian';
          this.phases.set(n, {
            number: n,
            ring: r,
            group: g,
            minGreen: vehicle ? t(p.minGreen) : 0,
            passage: vehicle ? t(p.passage) : 0,
            max: t(useMax2 && p.maxGreen2 > 0 ? p.maxGreen2 : p.maxGreen1),
            yellow: t(p.yellow),
            redClear: t(p.redClear),
            walk: t(p.pedestrian.walk),
            pedestrianClearance: t(p.pedestrian.clearance),
            hasPedestrian: p.pedestrian.enabled,
            recall: p.recall,
            pedestrianRecall: p.pedestrian.enabled && p.pedestrian.recall,
            restInWalk: p.pedestrian.restInWalk,
            dualEntry: p.dualEntry,
            locking: p.lockingDetector,
            addedInitial: t(p.volumeDensity.addedInitialPerActuation),
            maxInitial: t(p.volumeDensity.maxInitial),
            timeBeforeReduction: t(p.volumeDensity.timeBeforeReduction),
            timeToReduce: t(p.volumeDensity.timeToReduce),
            minGap: t(p.volumeDensity.minGap),
          });
        }),
      ),
    );

    this.coordination = pattern?.mode === 'coordinated' ? coordinationTiming(intersection, pattern.id, pattern.forceOffMode === 'floating') : null;
    this.rings = this.sequence.map(() => idleRing());
    this.start();
  }

  /** Starts in the scheduled interval when coordinated, otherwise all rings idle in group 0. */
  private start(): void {
    const c = this.coordination;
    if (!c) return;
    const seq = c.seqAtZero;
    this.sequence.forEach((ring, r) => {
      for (const n of ring.groups.flat()) {
        const s = c.schedule.get(n);
        const timing = this.phases.get(n);
        if (!s || !timing) continue;
        const into = mod(seq - s.greenStart, c.cycle);
        if (into < s.yellowStart - s.greenStart) {
          Object.assign(this.rings[r]!, { phase: n, interval: 'green', elapsed: into, initial: timing.minGreen, pedestrian: 'done', yieldTick: s.yellowStart - s.greenStart - into } satisfies Partial<RingState>);
          this.group = timing.group;
        }
      }
    });
  }

  signal(phase: number): PhaseSignal {
    const timing = this.phases.get(phase);
    const ring = timing ? this.rings[timing.ring] : undefined;
    if (!ring || ring.phase !== phase || ring.interval === 'idle') return { vehicle: 'red', pedestrian: 'dont-walk' };
    return {
      vehicle: ring.interval === 'green' ? 'green' : ring.interval === 'yellow' ? 'yellow' : 'red',
      pedestrian: ring.interval === 'green' && ring.pedestrian === 'walk' ? 'walk' : ring.interval === 'green' && ring.pedestrian === 'clearance' ? 'clearance' : 'dont-walk',
    };
  }

  drainTerminations() {
    const out = this.terminations;
    this.terminations = [];
    return out;
  }

  step(inputs: ControllerInputs): void {
    this.tick = inputs.tick;
    this.updateCalls(inputs);
    this.rings.forEach((ring, r) => this.timeRing(ring, r, inputs));
    this.crossBarrier();
  }

  private seq(): number {
    const c = this.coordination!;
    return mod(c.seqAtZero + this.tick, c.cycle);
  }

  private isGreen(n: number): boolean {
    const timing = this.phases.get(n);
    const ring = timing && this.rings[timing.ring];
    return !!ring && ring.phase === n && ring.interval === 'green';
  }

  private updateCalls(inputs: ControllerInputs): void {
    for (const timing of this.phases.values()) {
      const n = timing.number;
      const green = this.isGreen(n);
      if (inputs.actuations.has(n) && !green) this.redActuations.set(n, (this.redActuations.get(n) ?? 0) + 1);
      if (green) {
        this.vehicleCalls.delete(n);
      } else if (inputs.presence.has(n) || timing.recall === 'minimum' || timing.recall === 'maximum' || this.coordination?.coordinated.has(n)) {
        this.vehicleCalls.add(n);
      } else if (!timing.locking) {
        this.vehicleCalls.delete(n);
      }
      if (timing.hasPedestrian && (inputs.pedestrianPresses.has(n) || timing.pedestrianRecall)) {
        const ring = this.rings[timing.ring]!;
        // A press during this phase's walk is served by it.
        if (!(green && ring.pedestrian === 'walk')) this.pedestrianCalls.add(n);
      }
    }
    // Soft recall: a call only when nothing else is calling.
    const others = this.vehicleCalls.size + this.pedestrianCalls.size;
    for (const timing of this.phases.values()) {
      if (timing.recall === 'soft' && others === 0 && !this.isGreen(timing.number)) this.vehicleCalls.add(timing.number);
    }
  }

  private demand(n: number): boolean {
    return this.vehicleCalls.has(n) || this.pedestrianCalls.has(n);
  }

  /** Whether phase `n` may start now: demand, and in coordination time to serve it before its force-off. */
  private serviceable(n: number): boolean {
    if (!this.demand(n)) return false;
    const c = this.coordination;
    if (!c || c.coordinated.has(n)) return true;
    const s = c.schedule.get(n);
    const timing = this.phases.get(n)!;
    if (!s) return false;
    const u = mod(this.seq() - c.yieldRef, c.cycle);
    const forceOff = mod(s.yellowStart - c.yieldRef, c.cycle);
    const needs = Math.max(timing.minGreen, this.pedestrianCalls.has(n) ? timing.walk + timing.pedestrianClearance : 0);
    return u + needs <= forceOff;
  }

  private nextInGroup(r: number, after: number | null): number | null {
    const list = this.sequence[r]!.groups[this.group] ?? [];
    const from = after === null ? 0 : list.indexOf(after) + 1;
    return list.slice(from).find((n) => this.phases.has(n) && this.serviceable(n)) ?? null;
  }

  private demandElsewhere(): boolean {
    return this.nextGroupWithDemand() !== null;
  }

  private nextGroupWithDemand(): number | null {
    for (let k = 1; k <= this.groupCount; k++) {
      const g = (this.group + k) % this.groupCount;
      if (g === this.group && k !== this.groupCount) continue;
      if (this.sequence.some((ring) => (ring.groups[g] ?? []).some((n) => this.phases.has(n) && this.serviceable(n)))) return g;
    }
    return null;
  }

  private timeRing(ring: RingState, r: number, inputs: ControllerInputs): void {
    ring.elapsed++;
    if (ring.interval === 'yellow') {
      const timing = this.phases.get(ring.phase!)!;
      if (ring.elapsed >= timing.yellow) Object.assign(ring, { interval: 'red', elapsed: 0 });
      return;
    }
    if (ring.interval === 'red') {
      const timing = this.phases.get(ring.phase!)!;
      if (ring.elapsed < timing.redClear) return;
      const next = this.nextInGroup(r, ring.phase);
      if (next !== null) this.startGreen(ring, next);
      else Object.assign(ring, { interval: 'idle', elapsed: 0 });
      return;
    }
    if (ring.interval !== 'green') return;

    const n = ring.phase!;
    const timing = this.phases.get(n)!;
    const coordinatedPhase = this.coordination?.coordinated.has(n) ?? false;
    const withinGroup = this.nextInGroup(r, n) !== null;
    const conflicting = withinGroup || this.demandElsewhere();

    // Pedestrian intervals.
    if (ring.pedestrian === 'walk' || ring.pedestrian === 'clearance') ring.pedestrianElapsed++;
    if (ring.pedestrian === 'walk' && ring.pedestrianElapsed >= timing.walk && !(timing.restInWalk && !conflicting)) {
      Object.assign(ring, { pedestrian: 'clearance', pedestrianElapsed: 0 });
    } else if (ring.pedestrian === 'clearance' && ring.pedestrianElapsed >= timing.pedestrianClearance) {
      ring.pedestrian = 'done';
    }

    // Extension and max timers.
    ring.gap = inputs.actuations.has(n) || inputs.presence.has(n) ? 0 : ring.gap + 1;
    if (conflicting) ring.maxElapsed++;

    if (ring.ready === null) {
      const pedestrianBusy = ring.pedestrian === 'walk' || ring.pedestrian === 'clearance';
      const minimumDone = ring.elapsed >= ring.initial && !pedestrianBusy;
      ring.ready = conflicting && minimumDone ? this.termination(ring, timing, coordinatedPhase) : null;
    }
    if (ring.ready === null) return;
    if (withinGroup) {
      this.endGreen(ring, n, ring.ready);
    }
    // Otherwise the ring waits at the barrier (see crossBarrier).
  }

  private termination(ring: RingState, timing: PhaseTiming, coordinatedPhase: boolean): Termination | null {
    const c = this.coordination;
    if (c && coordinatedPhase) {
      return this.tick >= ring.yieldTick ? 'yield' : null;
    }
    if (c) {
      const s = c.schedule.get(timing.number);
      if (s) {
        const u = mod(this.seq() - c.yieldRef, c.cycle);
        if (u >= mod(s.yellowStart - c.yieldRef, c.cycle) || (c.floating && ring.elapsed >= s.splitGreen)) return 'force-off';
      }
    }
    if (ring.maxElapsed >= timing.max) return 'max-out';
    if (timing.recall === 'maximum') return null;
    return ring.gap >= this.passage(ring, timing) ? 'gap-out' : null;
  }

  /** The passage time, reduced linearly towards the minimum gap under volume density. */
  private passage(ring: RingState, timing: PhaseTiming): number {
    if (timing.minGap <= 0 || timing.timeToReduce <= 0 || ring.elapsed <= timing.timeBeforeReduction) return timing.passage;
    const progress = Math.min(1, (ring.elapsed - timing.timeBeforeReduction) / timing.timeToReduce);
    return Math.max(timing.minGap, timing.passage - (timing.passage - timing.minGap) * progress);
  }

  private startGreen(ring: RingState, n: number): void {
    const timing = this.phases.get(n)!;
    const actuations = this.redActuations.get(n) ?? 0;
    const initial = timing.addedInitial > 0 ? Math.max(timing.minGreen, Math.min(timing.maxInitial, actuations * timing.addedInitial)) : timing.minGreen;
    const walk = this.pedestrianCalls.has(n);
    if (walk) this.pedestrianCalls.delete(n);
    this.vehicleCalls.delete(n);
    this.redActuations.set(n, 0);
    // A coordinated phase that starts early (or late) still yields at its next scheduled end of green.
    const c = this.coordination;
    const s = c?.coordinated.has(n) ? c.schedule.get(n) : undefined;
    const yieldTick = c && s ? this.tick + mod(s.yellowStart - this.seq(), c.cycle) : 0;
    Object.assign(ring, { phase: n, interval: 'green', elapsed: 0, gap: 0, maxElapsed: 0, initial, pedestrian: walk ? 'walk' : 'none', pedestrianElapsed: 0, ready: null, yieldTick } satisfies RingState);
  }

  private endGreen(ring: RingState, n: number, reason: Termination): void {
    this.terminations.push({ phase: n, reason, tick: this.tick });
    Object.assign(ring, { interval: 'yellow', elapsed: 0, ready: null });
  }

  private crossBarrier(): void {
    const timing = (r: number) => this.sequence[r]!.groups[this.group] ?? [];
    // Rings still green in this group must all be ready to leave it.
    const green = this.rings.filter((ring) => ring.interval === 'green');
    const clearing = this.rings.some((ring) => ring.interval === 'yellow' || ring.interval === 'red');
    if (green.length > 0) {
      const allReady = green.every((ring) => ring.ready !== null && this.nextInGroup(this.rings.indexOf(ring), ring.phase) === null);
      if (allReady && !clearing && this.demandElsewhere()) {
        for (const ring of green) this.endGreen(ring, ring.phase!, ring.ready!);
      }
      return;
    }
    if (clearing) return;
    const next = this.nextGroupWithDemand();
    if (next === null) return;
    this.group = next;
    const starts = this.sequence.map((_, r) => timing(r).find((n) => this.phases.has(n) && this.serviceable(n)) ?? null);
    const anyStart = starts.some((n) => n !== null);
    this.rings.forEach((ring, r) => {
      const n = starts[r] ?? (anyStart ? (timing(r).find((p) => this.phases.get(p)?.dualEntry) ?? null) : null);
      if (n !== null) this.startGreen(ring, n);
      else Object.assign(ring, { phase: null, interval: 'idle', elapsed: 0, ready: null });
    });
  }
}

function idleRing(): RingState {
  return { phase: null, interval: 'idle', elapsed: 0, gap: 0, maxElapsed: 0, initial: 0, pedestrian: 'none', pedestrianElapsed: 0, ready: null, yieldTick: 0 };
}

function coordinationTiming(intersection: Intersection, patternId: string, floating: boolean): CoordinationTiming | null {
  const result = projectCycle(intersection, patternId);
  if (!result.ok) return null;
  const p: CycleProjection = result.projection;
  const t = (tenths: number) => tenths * TICKS_PER_TENTH;
  const schedule = new Map<number, { greenStart: number; yellowStart: number; splitGreen: number }>();
  for (const interval of p.rings.flat()) {
    schedule.set(interval.phase, { greenStart: t(interval.greenStart), yellowStart: t(interval.yellowStart), splitGreen: t(interval.yellowStart - interval.greenStart) });
  }
  const coordinated = new Set(p.rings.flat().filter((i) => i.coordinated).map((i) => i.phase));
  const yields = [...coordinated].map((n) => schedule.get(n)!.yellowStart);
  const cycle = t(p.cycle);
  // System time = sequence − localZero + offset, so sequence at system 0 = localZero − offset.
  return { cycle, seqAtZero: mod(t(p.localZero) - t(p.offset), cycle), coordinated, schedule, yieldRef: Math.min(...yields), floating };
}
