/**
 * Cycle projection: where every phase's split, green, yellow and red clearance fall in one cycle
 * of a coordinated pattern, and the coordination points derived from them.
 *
 * Two time bases appear throughout:
 * - **sequence time** runs from the start of barrier group 1 (the first phase of each ring's
 *   sequence), which is where the rings' splits are laid end to end;
 * - **local time** runs from local zero, the point the pattern's offset reference names.
 *
 * Local zero happens at system time `offset` (mod cycle). Every value is tenths of a second.
 */
import {
  effectiveSequence,
  formatSeconds,
  validateIntersection,
  type Intersection,
  type Issue,
  type OffsetReference,
  type Pattern,
  type Tenths,
} from '../model';

export interface PhaseInterval {
  phase: number;
  /** Zero-based ring and barrier group indexes. */
  ring: number;
  group: number;
  coordinated: boolean;
  /** Sequence times. The split runs splitStart → splitEnd; green, yellow, red clear tile it. */
  splitStart: Tenths;
  greenStart: Tenths;
  yellowStart: Tenths;
  redClearStart: Tenths;
  splitEnd: Tenths;
  /** End of walk and of pedestrian clearance when the phase has pedestrian service. */
  walkEnd: Tenths | null;
  pedestrianClearanceEnd: Tenths | null;
  /**
   * Latest end of green (sequence time): the force-off for a non-coordinated phase, the yield
   * point for a coordinated one. Equal to `yellowStart` in a projection.
   */
  forceOff: Tenths;
  /**
   * Latest start of green that still gives the minimum green before the force-off, and the
   * same for a full walk and pedestrian clearance. `null` for coordinated phases, which are
   * always served. These are measured in sequence time and may be before `splitStart`, since a
   * phase can start early when the phases before it gap out.
   */
  latestVehicleStart: Tenths | null;
  latestPedestrianStart: Tenths | null;
}

export interface CycleProjection {
  patternId: string;
  cycle: Tenths;
  offset: Tenths;
  offsetReference: OffsetReference;
  /** Intervals per ring, in timing order. Rings with an empty barrier group simply have a gap. */
  rings: PhaseInterval[][];
  /** Sequence time of each barrier crossing, ending with the cycle length. */
  barriers: Tenths[];
  /** Sequence time of every offset reference point. */
  referencePoints: Record<OffsetReference, Tenths>;
  /** Sequence time of local zero (the pattern's own reference point). */
  localZero: Tenths;
}

/**
 * `ok` with the projection and the errors that did not stop it (a split shorter than minimum
 * green still has a well-defined window), or not `ok` with the errors that did.
 */
export type ProjectionResult = { ok: true; projection: CycleProjection; issues: Issue[] } | { ok: false; issues: Issue[] };

/**
 * Pattern errors that leave the layout undefined or ambiguous: no cycle, rings that miss a
 * barrier or do not fill the cycle, a missing split, or no single coordinated group to measure
 * the offset from. Every ring structure error blocks as well. Other errors (short splits, timing
 * limits, the offset range) are drawn and reported.
 */
const BLOCKING_PATTERN_CODES = new Set([
  'pattern.sequence-membership',
  'pattern.cycle-missing',
  'pattern.coord-missing',
  'pattern.coord-invalid',
  'pattern.coord-same-ring',
  'pattern.coord-different-barriers',
  'pattern.split-missing',
  'pattern.barrier-misaligned',
  'pattern.cycle-sum',
]);

export const mod = (value: number, cycle: number): number => ((value % cycle) + cycle) % cycle;

/** Sequence time → local time (0 ≤ result < cycle). */
export const toLocal = (projection: CycleProjection, sequenceTime: Tenths): Tenths =>
  mod(sequenceTime - projection.localZero, projection.cycle);

/** Sequence time → the system time (mod cycle) at which it happens. */
export const toSystem = (projection: CycleProjection, sequenceTime: Tenths): Tenths =>
  mod(sequenceTime - projection.localZero + projection.offset, projection.cycle);

/**
 * The system-time spans (mod cycle) covered by the sequence-time span `start → end`: one span, or
 * two when it runs past the end of the cycle. Each is `[from, to)` with `0 ≤ from < to ≤ cycle`.
 */
export function systemSpans(projection: CycleProjection, start: Tenths, end: Tenths): [Tenths, Tenths][] {
  const length = Math.min(end - start, projection.cycle);
  if (length <= 0) {
    return [];
  }
  const from = toSystem(projection, start);
  const to = from + length;
  return to <= projection.cycle ? [[from, to]] : [[from, projection.cycle], [0, to - projection.cycle]];
}

/**
 * Projects one coordinated pattern. Fails with the blocking issues when the ring structure or the
 * pattern's layout is broken (see `BLOCKING_PATTERN_CODES`) or a split cannot hold its phase's
 * yellow and red clearance, since no honest drawing exists; otherwise projects and returns the
 * remaining errors for the phases and this pattern alongside.
 */
export function projectCycle(intersection: Intersection, patternId: string): ProjectionResult {
  const patternIndex = intersection.patterns.findIndex((p) => p.id === patternId);
  const pattern = intersection.patterns[patternIndex];
  if (!pattern) {
    return { ok: false, issues: [{ severity: 'error', code: 'projection.unknown-pattern', message: `No pattern "${patternId}"`, path: ['patterns'] }] };
  }
  if (pattern.mode !== 'coordinated') {
    return {
      ok: false,
      issues: [{ severity: 'error', code: 'projection.free-pattern', message: `Pattern "${pattern.name}" runs free, so it has no fixed cycle to project`, path: ['patterns', patternIndex, 'mode'] }],
    };
  }
  const relevant = validateIntersection(intersection).filter((issue) => issue.severity === 'error' && concernsProjection(issue, patternIndex));
  const blocking = relevant.filter((issue) => issue.path[0] === 'rings' || BLOCKING_PATTERN_CODES.has(issue.code));
  if (blocking.length > 0) {
    return { ok: false, issues: blocking };
  }
  const projection = project(intersection, pattern);
  const cramped = projection.rings.flat().filter((interval) => interval.yellowStart < interval.splitStart);
  if (cramped.length > 0) {
    return {
      ok: false,
      issues: cramped.map((interval) => ({
        severity: 'error' as const,
        code: 'projection.split-below-clearance',
        message: `Pattern "${pattern.name}": phase ${interval.phase} split of ${formatSeconds(interval.splitEnd - interval.splitStart)} s cannot hold its yellow and red clearance`,
        path: ['patterns', patternIndex, 'splits', String(interval.phase)],
      })),
    };
  }
  return { ok: true, projection, issues: relevant };
}

function concernsProjection(issue: Issue, patternIndex: number): boolean {
  const [root, index] = issue.path;
  if (root === 'patterns') {
    return index === patternIndex;
  }
  return root === 'phases' || root === 'rings';
}

function project(intersection: Intersection, pattern: Pattern): CycleProjection {
  const phases = new Map(intersection.phases.map((p) => [p.number, p]));
  const sequence = effectiveSequence(pattern, intersection.rings);
  const enabled = (n: number) => phases.get(n)?.enabled === true;
  const split = (n: number): Tenths => pattern.splits[String(n)] ?? 0;
  const coordinated = new Set(pattern.coordinatedPhases);
  const groupCount = sequence[0]?.groups.length ?? 0;

  // Barrier group durations come from any ring that has phases in the group (validation has
  // established that all such rings agree).
  const barriers: Tenths[] = [];
  let elapsed = 0;
  for (let g = 0; g < groupCount; g++) {
    const serving = sequence.map((ring) => (ring.groups[g] ?? []).filter(enabled)).find((phaseList) => phaseList.length > 0) ?? [];
    elapsed += serving.reduce((sum, n) => sum + split(n), 0);
    barriers.push(elapsed);
  }

  const rings: PhaseInterval[][] = sequence.map((ring, r) => {
    const intervals: PhaseInterval[] = [];
    ring.groups.forEach((group, g) => {
      let cursor = g === 0 ? 0 : (barriers[g - 1] ?? 0);
      for (const n of group.filter(enabled)) {
        const phase = phases.get(n)!;
        const splitStart = cursor;
        const splitEnd = cursor + split(n);
        const redClearStart = splitEnd - phase.redClear;
        const yellowStart = redClearStart - phase.yellow;
        const ped = phase.pedestrian.enabled;
        const isCoordinated = coordinated.has(n);
        intervals.push({
          phase: n,
          ring: r,
          group: g,
          coordinated: isCoordinated,
          splitStart,
          greenStart: splitStart,
          yellowStart,
          redClearStart,
          splitEnd,
          walkEnd: ped ? splitStart + phase.pedestrian.walk : null,
          pedestrianClearanceEnd: ped ? splitStart + phase.pedestrian.walk + phase.pedestrian.clearance : null,
          forceOff: yellowStart,
          latestVehicleStart: isCoordinated ? null : yellowStart - phase.minGreen,
          latestPedestrianStart: isCoordinated || !ped ? null : yellowStart - phase.pedestrian.walk - phase.pedestrian.clearance,
        });
        cursor = splitEnd;
      }
    });
    return intervals;
  });

  const coordIntervals = rings.flat().filter((i) => i.coordinated);
  const referencePoints: Record<OffsetReference, Tenths> = {
    firstPhaseStart: 0,
    beginCoordGreen: Math.min(...coordIntervals.map((i) => i.greenStart)),
    beginCoordYellow: Math.min(...coordIntervals.map((i) => i.yellowStart)),
  };

  return {
    patternId: pattern.id,
    cycle: pattern.cycle,
    offset: pattern.offset,
    offsetReference: pattern.offsetReference,
    rings,
    barriers,
    referencePoints,
    localZero: referencePoints[pattern.offsetReference],
  };
}

/**
 * The offset that puts the same timing on the ground when measured to another reference point.
 * Moving local zero later in the cycle by `d` moves the offset later by `d`.
 */
export function convertOffset(projection: CycleProjection, to: OffsetReference): Tenths {
  const from = projection.referencePoints[projection.offsetReference];
  return mod(projection.offset - from + projection.referencePoints[to], projection.cycle);
}
