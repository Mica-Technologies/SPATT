/**
 * Capacity analysis from lane groups and a volume count, following the HCM 2000 signalized
 * intersection method (Transportation Research Board, Highway Capacity Manual 2000, chapter 16)
 * in a simplified form:
 *
 * - Saturation flow: base × lanes × lane width, heavy vehicle, grade, area type, lane
 *   utilization, left-turn and right-turn factors. Parking, bus blockage and pedestrian/bicycle
 *   factors are taken as 1, and permitted lefts are not reduced for opposing traffic (reported,
 *   with the lane group's hand-entered saturation flow as the way round it).
 * - Lost time per phase = yellow + red clearance (start-up lost time 2 s, extension of effective
 *   green 2 s), so a phase's effective green is its split less yellow and red clearance.
 * - Cycle length: Webster, C₀ = (1.5 L + 5) / (1 − Y), over the critical ring in each barrier group.
 * - Delay: uniform plus incremental delay (progression factor 1, k = 0.5, I = 1, T = 0.25 h), with
 *   level of service from the HCM thresholds.
 *
 * Volumes are vehicles per hour; durations in the model stay integer tenths, and results are in
 * seconds where the HCM works in seconds.
 */
import {
  effectiveSequence,
  MOVEMENTS,
  type Intersection,
  type LaneGroup,
  type MovementVolumes,
  type Pattern,
  type Phase,
  type Ring,
  type Tenths,
  type VolumeSet,
} from '../model';
import { apportion, balanceSplits, splitMinimums } from './splits';

export const HEAVY_VEHICLE_EQUIVALENT = 2;
export const ANALYSIS_PERIOD_HOURS = 0.25;
export const INCREMENTAL_DELAY_K = 0.5;
/** The HCM level-of-service delay ceilings (s/veh); above the last is F. */
export const LOS_THRESHOLDS: readonly [number, Los][] = [
  [10, 'A'],
  [20, 'B'],
  [35, 'C'],
  [55, 'D'],
  [80, 'E'],
];
export type Los = 'A' | 'B' | 'C' | 'D' | 'E' | 'F';

export function levelOfService(delay: number): Los {
  return LOS_THRESHOLDS.find(([ceiling]) => delay <= ceiling)?.[1] ?? 'F';
}

export interface SaturationFactors {
  laneWidth: number;
  heavyVehicles: number;
  grade: number;
  areaType: number;
  laneUtilization: number;
  leftTurn: number;
  rightTurn: number;
}

export interface SaturationFlow {
  /** Veh/h of green for the whole group: the hand-entered value if there is one. */
  value: number;
  /** The calculated value, even when overridden. */
  calculated: number;
  factors: SaturationFactors;
  overridden: boolean;
  /** Lefts served by a phase that is not a left-turn phase, so not reduced for opposing flow. */
  permittedLefts: boolean;
}

/** HCM default lane utilization factors by lane count (the last applies beyond). */
const LANE_UTILIZATION = { through: [1, 0.952, 0.908], left: [1, 0.971], right: [1, 0.885] } as const;

function laneUtilization(group: LaneGroup): number {
  const { left, through, right } = group.movements;
  const table = !through && left && !right ? LANE_UTILIZATION.left : !through && right && !left ? LANE_UTILIZATION.right : LANE_UTILIZATION.through;
  return table[Math.min(group.lanes, table.length) - 1]!;
}

export function saturationFlow(intersection: Intersection, group: LaneGroup, volumes: MovementVolumes | undefined): SaturationFlow {
  const phase = intersection.phases.find((p) => p.number === group.phase);
  const total = volumes ? volumes.left + volumes.through + volumes.right : 0;
  const share = (n: number) => (total > 0 ? n / total : 0);
  const { left, through, right } = group.movements;
  const exclusiveLeft = left && !through && !right;
  const exclusiveRight = right && !through && !left;
  const factors: SaturationFactors = {
    laneWidth: 1 + (group.laneWidth - 3.6) / 9,
    heavyVehicles: 100 / (100 + group.heavyVehiclesPercent * (HEAVY_VEHICLE_EQUIVALENT - 1)),
    grade: 1 - group.gradePercent / 200,
    areaType: intersection.capacity.centralBusinessDistrict ? 0.9 : 1,
    laneUtilization: laneUtilization(group),
    leftTurn: !left ? 1 : exclusiveLeft ? 0.95 : 1 / (1 + 0.05 * share(volumes?.left ?? 0)),
    rightTurn: !right ? 1 : exclusiveRight ? 0.85 : 1 - 0.15 * share(volumes?.right ?? 0),
  };
  const product = Object.values(factors).reduce((p, f) => p * f, 1);
  const calculated = intersection.capacity.baseSaturationFlow * group.lanes * product;
  return {
    value: group.saturationFlow ?? calculated,
    calculated,
    factors,
    overridden: group.saturationFlow !== null,
    permittedLefts: left && phase?.movement.kind !== 'left',
  };
}

/** A phase's lost time: yellow plus red clearance. */
export function lostTime(phase: Phase): Tenths {
  return phase.yellow + phase.redClear;
}

export interface CriticalGroup {
  /** Barrier group index. */
  group: number;
  /** The ring with the highest flow-ratio sum in this group. */
  ring: number;
  phases: number[];
  flowRatio: number;
  lostTime: Tenths;
}

export interface CriticalAnalysis {
  /** Per enabled phase in the rings: the highest v/s of its lane groups (0 without any). */
  phaseFlowRatios: Record<string, number>;
  groups: CriticalGroup[];
  /** Y: the sum of critical flow ratios. */
  flowRatio: number;
  /** L: lost time along the critical path, tenths. */
  lostTime: Tenths;
  /** Webster's optimum cycle rounded up to whole seconds, or null when Y ≥ 1. */
  webster: Tenths | null;
}

function volumesOf(set: VolumeSet, group: LaneGroup): MovementVolumes {
  return set.volumes[group.id] ?? { left: 0, through: 0, right: 0 };
}

const totalVolume = (v: MovementVolumes) => MOVEMENTS.reduce((sum, m) => sum + v[m], 0);

export function criticalAnalysis(intersection: Intersection, set: VolumeSet, rings: Ring[] = intersection.rings): CriticalAnalysis {
  const phases = new Map(intersection.phases.map((p) => [p.number, p]));
  const enabled = (n: number) => phases.get(n)?.enabled === true;
  const phaseFlowRatios: Record<string, number> = {};
  for (const n of rings.flatMap((r) => r.groups.flat()).filter(enabled)) {
    phaseFlowRatios[String(n)] = 0;
  }
  for (const group of intersection.laneGroups) {
    const key = String(group.phase);
    if (!(key in phaseFlowRatios)) continue;
    const volumes = volumesOf(set, group);
    const y = totalVolume(volumes) / set.peakHourFactor / saturationFlow(intersection, group, volumes).value;
    phaseFlowRatios[key] = Math.max(phaseFlowRatios[key]!, y);
  }

  const groupCount = rings[0]?.groups.length ?? 0;
  const groups: CriticalGroup[] = [];
  for (let g = 0; g < groupCount; g++) {
    let best: CriticalGroup | null = null;
    rings.forEach((ring, r) => {
      const inGroup = (ring.groups[g] ?? []).filter(enabled);
      if (inGroup.length === 0) return;
      const flowRatio = inGroup.reduce((sum, n) => sum + phaseFlowRatios[String(n)]!, 0);
      const lost = inGroup.reduce((sum, n) => sum + lostTime(phases.get(n)!), 0);
      // Ties go to the ring with more lost time, which needs the longer group.
      if (!best || flowRatio > best.flowRatio || (flowRatio === best.flowRatio && lost > best.lostTime)) {
        best = { group: g, ring: r, phases: inGroup, flowRatio, lostTime: lost };
      }
    });
    if (best) groups.push(best);
  }
  const flowRatio = groups.reduce((sum, g) => sum + g.flowRatio, 0);
  const lost = groups.reduce((sum, g) => sum + g.lostTime, 0);
  const webster = flowRatio < 1 ? Math.ceil((1.5 * (lost / 10) + 5) / (1 - flowRatio)) * 10 : null;
  return { phaseFlowRatios, groups, flowRatio, lostTime: lost, webster };
}

export interface LaneGroupResult {
  laneGroupId: string;
  label: string;
  phase: number;
  /** Counted hourly volume. */
  volume: number;
  /** Peak 15-minute flow rate, v = V / PHF. */
  flow: number;
  saturation: SaturationFlow;
  flowRatio: number;
  /** Effective green, seconds. */
  effectiveGreen: number;
  capacity: number;
  /** v/c; Infinity with no capacity. */
  volumeToCapacity: number;
  uniformDelay: number | null;
  incrementalDelay: number | null;
  delay: number | null;
  los: Los | null;
}

export type PatternAnalysis =
  | {
      ok: true;
      volumeSet: VolumeSet;
      cycle: number;
      laneGroups: LaneGroupResult[];
      critical: CriticalAnalysis;
      /** Xc = Y · C / (C − L). */
      criticalVolumeToCapacity: number | null;
      /** Volume-weighted average delay, s/veh. */
      delay: number | null;
      los: Los | null;
    }
  | { ok: false; reason: 'no-volume-set' | 'no-lane-groups' | 'no-cycle' };

/** Uniform and incremental delay (s/veh) for one lane group; C and g in seconds. */
export function controlDelay(cycle: number, effectiveGreen: number, flow: number, capacity: number): { uniform: number; incremental: number } | null {
  if (capacity <= 0 || cycle <= 0) return null;
  const gC = effectiveGreen / cycle;
  const x = flow / capacity;
  const uniform = (0.5 * cycle * (1 - gC) ** 2) / (1 - Math.min(1, x) * gC);
  const T = ANALYSIS_PERIOD_HOURS;
  const incremental = 900 * T * (x - 1 + Math.sqrt((x - 1) ** 2 + (8 * INCREMENTAL_DELAY_K * x) / (capacity * T)));
  return { uniform, incremental };
}

export function analyzePattern(intersection: Intersection, patternId: string): PatternAnalysis {
  const pattern = intersection.patterns.find((p) => p.id === patternId);
  const set = intersection.volumeSets.find((s) => s.id === pattern?.volumeSetId);
  if (!pattern || !set) return { ok: false, reason: 'no-volume-set' };
  if (intersection.laneGroups.length === 0) return { ok: false, reason: 'no-lane-groups' };
  if (pattern.mode !== 'coordinated' || pattern.cycle <= 0) return { ok: false, reason: 'no-cycle' };

  const phases = new Map(intersection.phases.map((p) => [p.number, p]));
  const cycle = pattern.cycle / 10;
  const critical = criticalAnalysis(intersection, set, effectiveSequence(pattern, intersection.rings));
  const laneGroups = intersection.laneGroups.map((group): LaneGroupResult => {
    const volumes = volumesOf(set, group);
    const volume = totalVolume(volumes);
    const flow = volume / set.peakHourFactor;
    const saturation = saturationFlow(intersection, group, volumes);
    const phase = phases.get(group.phase);
    const split = pattern.splits[String(group.phase)] ?? 0;
    const effectiveGreen = phase?.enabled ? Math.max(0, split - lostTime(phase)) / 10 : 0;
    const capacity = (saturation.value * effectiveGreen) / cycle;
    const delay = controlDelay(cycle, effectiveGreen, flow, capacity);
    const total = delay ? delay.uniform + delay.incremental : null;
    return {
      laneGroupId: group.id,
      label: group.label,
      phase: group.phase,
      volume,
      flow,
      saturation,
      flowRatio: flow / saturation.value,
      effectiveGreen,
      capacity,
      volumeToCapacity: capacity > 0 ? flow / capacity : Infinity,
      uniformDelay: delay?.uniform ?? null,
      incrementalDelay: delay?.incremental ?? null,
      delay: total,
      los: total === null ? null : levelOfService(total),
    };
  });
  const lost = critical.lostTime / 10;
  const counted = laneGroups.filter((g) => g.flow > 0);
  const flowSum = counted.reduce((sum, g) => sum + g.flow, 0);
  const delay = counted.length > 0 && counted.every((g) => g.delay !== null) ? counted.reduce((sum, g) => sum + g.delay! * g.flow, 0) / flowSum : null;
  return {
    ok: true,
    volumeSet: set,
    cycle,
    laneGroups,
    critical,
    criticalVolumeToCapacity: cycle > lost ? (critical.flowRatio * cycle) / (cycle - lost) : null,
    delay,
    los: delay === null ? null : levelOfService(delay),
  };
}

export interface SuggestOptions {
  /** Tenths. */
  minCycle?: Tenths;
  maxCycle?: Tenths;
}

export const SUGGEST_MIN_CYCLE: Tenths = 400;
export const SUGGEST_MAX_CYCLE: Tenths = 1800;

export type SuggestedTiming =
  | {
      ok: true;
      /** Splits for the suggested cycle; the caller makes the pattern. */
      cycle: Tenths;
      splits: Record<string, Tenths>;
      critical: CriticalAnalysis;
      /** Why the cycle differs from Webster's, if it does. */
      limitedBy: 'minimum' | 'maximum' | 'phase-minimums' | 'oversaturated' | null;
    }
  | { ok: false; reason: 'no-volume-set' | 'no-lane-groups' | 'not-coordinated' | 'no-volumes' };

/**
 * A cycle and splits for a coordinated pattern from its count: Webster's cycle within
 * [minCycle, maxCycle] and at least the critical path of phase minimums, then each barrier group's
 * effective green in proportion to its critical flow ratio, and each ring's time in the group in
 * proportion to its phases' flow ratios. Splits are finally brought to their minimums and the cycle
 * by `balanceSplits`, so they satisfy the same rules as hand-entered ones.
 *
 * A phase's minimum here includes its pedestrian interval whenever it has pedestrian service, with
 * or without recall: a suggested plan should be able to serve a pedestrian call in coordination.
 */
export function suggestTiming(intersection: Intersection, patternId: string, options: SuggestOptions = {}): SuggestedTiming {
  const { minCycle = SUGGEST_MIN_CYCLE, maxCycle = SUGGEST_MAX_CYCLE } = options;
  const pattern = intersection.patterns.find((p) => p.id === patternId);
  const set = intersection.volumeSets.find((s) => s.id === pattern?.volumeSetId);
  if (!pattern || !set) return { ok: false, reason: 'no-volume-set' };
  if (intersection.laneGroups.length === 0) return { ok: false, reason: 'no-lane-groups' };
  if (pattern.mode !== 'coordinated') return { ok: false, reason: 'not-coordinated' };

  const sequence = effectiveSequence(pattern, intersection.rings);
  const critical = criticalAnalysis(intersection, set, sequence);
  if (critical.flowRatio === 0) return { ok: false, reason: 'no-volumes' };
  // Balancing treats pedestrian service as recalled, so splits are raised to the pedestrian minimum.
  const pedestrianFloors = intersection.phases.map((p) => (p.pedestrian.enabled ? { ...p, pedestrian: { ...p.pedestrian, recall: true } } : p));
  const phases = new Map(pedestrianFloors.map((p) => [p.number, p]));
  const enabled = (n: number) => phases.get(n)?.enabled === true;

  const floorCycle = critical.groups.reduce((sum, g) => {
    const ringFloors = sequence.map((ring) => (ring.groups[g.group] ?? []).filter(enabled).reduce((s, n) => s + splitMinimums(phases.get(n)!).floor, 0));
    return sum + Math.max(0, ...ringFloors);
  }, 0);
  let cycle = critical.webster ?? maxCycle;
  let limitedBy: Extract<SuggestedTiming, { ok: true }>['limitedBy'] = critical.webster === null ? 'oversaturated' : null;
  if (cycle > maxCycle) [cycle, limitedBy] = [maxCycle, limitedBy ?? 'maximum'];
  if (cycle < minCycle) [cycle, limitedBy] = [minCycle, 'minimum'];
  const floorRounded = Math.ceil(floorCycle / 10) * 10;
  if (cycle < floorRounded) [cycle, limitedBy] = [floorRounded, 'phase-minimums'];

  const green = cycle - critical.lostTime;
  const groupGreens = apportion(Math.max(0, green), critical.groups.map((g) => g.flowRatio));
  const splits: Record<string, Tenths> = {};
  critical.groups.forEach((g, k) => {
    const duration = groupGreens[k]! + g.lostTime;
    for (const ring of sequence) {
      const inGroup = (ring.groups[g.group] ?? []).filter(enabled);
      if (inGroup.length === 0) continue;
      const ringLost = inGroup.reduce((sum, n) => sum + lostTime(phases.get(n)!), 0);
      const shares = apportion(Math.max(0, duration - ringLost), inGroup.map((n) => critical.phaseFlowRatios[String(n)]!));
      inGroup.forEach((n, i) => (splits[String(n)] = shares[i]! + lostTime(phases.get(n)!)));
    }
  });
  const trial: Intersection = { ...intersection, phases: pedestrianFloors, patterns: [{ ...pattern, cycle, splits }] };
  return { ok: true, cycle, splits: balanceSplits(trial, pattern.id), critical, limitedBy };
}

/** The suggestion as a new pattern (not added): the base pattern's coordination with the new timing. */
export function suggestedPattern(base: Pattern, suggestion: Extract<SuggestedTiming, { ok: true }>, id: string, name: string): Pattern {
  return { ...structuredClone(base), id, name, cycle: suggestion.cycle, splits: suggestion.splits, offset: base.offset % suggestion.cycle };
}
