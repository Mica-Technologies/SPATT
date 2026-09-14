/**
 * Split arithmetic for coordinated patterns: the minimum a split may be, bringing a pattern's
 * rings and barrier groups into line with its cycle, and a starting set of splits for a cycle.
 *
 * Every value is tenths of a second. Nothing here validates; the results are for
 * `validateIntersection` to judge like any hand-entered splits.
 */
import { effectiveSequence, type Intersection, type Phase, type Ring, type Tenths } from '../model';

export interface SplitMinimums {
  /** Minimum green + yellow + red clear (just the clearances for a pedestrian phase). */
  vehicle: Tenths;
  /** Walk + pedestrian clearance + yellow + red clear, or `null` without pedestrian service. */
  pedestrian: Tenths | null;
  /**
   * The shortest split validation accepts without an error: the vehicle minimum, raised to the
   * pedestrian minimum when the phase has pedestrian recall (a pedestrian interval that is only
   * served on a call draws a warning, not an error).
   */
  floor: Tenths;
}

export function splitMinimums(phase: Phase): SplitMinimums {
  const clearance = phase.yellow + phase.redClear;
  const vehicle = phase.movement.kind === 'pedestrian' ? clearance : phase.minGreen + clearance;
  const ped = phase.pedestrian;
  const pedestrian = ped.enabled ? ped.walk + ped.clearance + clearance : null;
  return { vehicle, pedestrian, floor: pedestrian !== null && ped.recall ? Math.max(vehicle, pedestrian) : vehicle };
}

/** The phase time is the minimum-with-pedestrians need of `cycleBounds`: green that serves both. */
function minimumWithPedestrians(phase: Phase): Tenths {
  const vehicleGreen = phase.movement.kind === 'pedestrian' ? 0 : phase.minGreen;
  const pedestrianGreen = phase.pedestrian.enabled ? phase.pedestrian.walk + phase.pedestrian.clearance : 0;
  return Math.max(vehicleGreen, pedestrianGreen) + phase.yellow + phase.redClear;
}

interface GroupRing {
  ring: number;
  /** Enabled phases of this ring in the group, in timing order. */
  phases: number[];
}

function servingRings(sequence: Ring[], group: number, enabled: (n: number) => boolean): GroupRing[] {
  return sequence.map((ring, r) => ({ ring: r, phases: (ring.groups[group] ?? []).filter(enabled) })).filter((entry) => entry.phases.length > 0);
}

/**
 * Integer shares of `total` in proportion to `weights`, summing exactly to `total` (largest
 * remainder; ties go to the earlier entry). Equal shares when every weight is zero.
 */
export function apportion(total: number, weights: readonly number[]): number[] {
  if (weights.length === 0) {
    return [];
  }
  const weightSum = weights.reduce((sum, w) => sum + w, 0);
  const effective = weightSum > 0 ? weights : weights.map(() => 1);
  const effectiveSum = weightSum > 0 ? weightSum : weights.length;
  const exact = effective.map((w) => (total * w) / effectiveSum);
  const shares = exact.map(Math.floor);
  let left = total - shares.reduce((sum, s) => sum + s, 0);
  const order = exact.map((value, index) => ({ index, fraction: value - Math.floor(value) })).sort((a, b) => b.fraction - a.fraction || a.index - b.index);
  for (let k = 0; left > 0 && order.length > 0; k = (k + 1) % order.length, left--) {
    shares[order[k]!.index]! += 1;
  }
  return shares;
}

/**
 * Brings a pattern's splits into line, returning the new split map (the pattern is not changed):
 *
 * 0. Every enabled phase in the ring structure whose split is below its
 *    `splitMinimums().floor` (a missing split counts as 0) is raised to that floor.
 * 1. In each barrier group, every ring with enabled phases there is raised to the group's
 *    longest ring total. The difference goes to that ring's coordinated phase in the group, or
 *    to its last enabled phase in the group.
 * 2. The barrier groups are then made to fill the cycle. Spare time goes to the coordinated
 *    phases' group, on each serving ring's coordinated phase there, or its last phase. Excess time
 *    comes off that group first (the coordinated phase, then the ring's other phases from last to
 *    first) and then off the other groups in order, only down to each phase's
 *    `splitMinimums().floor` and equally in every ring, so the rings still reach each barrier
 *    together; whatever cannot be removed is left for validation to report. Without a usable
 *    coordinated phase, the first barrier group is used. Free patterns, and patterns without a
 *    cycle, skip this step.
 *
 * Splits of phases that are disabled or not in the ring structure are carried over untouched.
 */
export function balanceSplits(intersection: Intersection, patternId: string): Record<string, Tenths> {
  const pattern = intersection.patterns.find((p) => p.id === patternId);
  if (!pattern) {
    throw new RangeError(`No pattern "${patternId}"`);
  }
  const phases = new Map(intersection.phases.map((p) => [p.number, p]));
  const enabled = (n: number) => phases.get(n)?.enabled === true;
  const sequence = effectiveSequence(pattern, intersection.rings);
  const splits: Record<string, Tenths> = { ...pattern.splits };
  const get = (n: number): Tenths => splits[String(n)] ?? 0;
  const coordinated = new Set(pattern.coordinatedPhases.filter(enabled));
  const groupCount = sequence[0]?.groups.length ?? 0;
  const target = (entry: GroupRing): number => entry.phases.find((n) => coordinated.has(n)) ?? entry.phases.at(-1)!;

  for (const ring of sequence) {
    for (const n of ring.groups.flat().filter(enabled)) {
      const floor = splitMinimums(phases.get(n)!).floor;
      if (get(n) < floor) {
        splits[String(n)] = floor;
      }
    }
  }

  const groupTotals: Tenths[] = [];
  for (let g = 0; g < groupCount; g++) {
    const serving = servingRings(sequence, g, enabled);
    const totals = serving.map((entry) => entry.phases.reduce((sum, n) => sum + get(n), 0));
    const longest = Math.max(0, ...totals);
    serving.forEach((entry, k) => {
      const shortBy = longest - totals[k]!;
      if (shortBy > 0) {
        const n = target(entry);
        splits[String(n)] = get(n) + shortBy;
      }
    });
    groupTotals.push(longest);
  }

  if (pattern.mode !== 'coordinated' || pattern.cycle === 0 || groupCount === 0) {
    return splits;
  }

  let remainder = pattern.cycle - groupTotals.reduce((sum, t) => sum + t, 0);
  if (remainder === 0) {
    return splits;
  }
  const coordGroup = (() => {
    for (let g = 0; g < groupCount; g++) {
      if (servingRings(sequence, g, enabled).some((entry) => entry.phases.some((n) => coordinated.has(n)))) {
        return g;
      }
    }
    return 0;
  })();
  if (remainder > 0) {
    for (const n of servingRings(sequence, coordGroup, enabled).map(target)) {
      splits[String(n)] = get(n) + remainder;
    }
    return splits;
  }

  // Too long: take time off group by group (the coordinated phases' group first), the same amount
  // from every serving ring, each ring giving from its target phase first and then from its other
  // phases, last to first, never below a floor.
  const spare = (n: number) => Math.max(0, get(n) - splitMinimums(phases.get(n)!).floor);
  const givingOrder = (entry: GroupRing) => [target(entry), ...entry.phases.filter((n) => n !== target(entry)).reverse()];
  const groupOrder = [coordGroup, ...Array.from({ length: groupCount }, (_, g) => g).filter((g) => g !== coordGroup)];
  let excess = -remainder;
  for (const g of groupOrder) {
    const serving = servingRings(sequence, g, enabled);
    if (excess === 0 || serving.length === 0) {
      continue;
    }
    const take = Math.min(excess, ...serving.map((entry) => entry.phases.reduce((sum, n) => sum + spare(n), 0)));
    for (const entry of serving) {
      let left = take;
      for (const n of givingOrder(entry)) {
        const cut = Math.min(left, spare(n));
        splits[String(n)] = get(n) - cut;
        left -= cut;
      }
    }
    excess -= take;
  }
  return splits;
}

/**
 * Splits for a cycle from scratch, keyed by every enabled phase placed in the rings:
 * the cycle is shared between barrier groups in proportion to each group's
 * minimum-with-pedestrians need (its longest ring, as in `cycleBounds`), and each ring's share
 * of a group between its phases in proportion to their own needs. Rings therefore reach every
 * barrier together and the groups add up to exactly `cycle`, all in whole tenths. A cycle
 * shorter than the minimums is shared the same way; validation reports the short splits.
 */
export function evenSplits(intersection: Intersection, cycle: Tenths): Record<string, Tenths> {
  const phases = new Map(intersection.phases.map((p) => [p.number, p]));
  const enabled = (n: number) => phases.get(n)?.enabled === true;
  const need = (n: number): Tenths => minimumWithPedestrians(phases.get(n)!);
  const groupCount = intersection.rings[0]?.groups.length ?? 0;

  const groups = Array.from({ length: groupCount }, (_, g) => servingRings(intersection.rings, g, enabled));
  const groupNeeds = groups.map((serving) => Math.max(0, ...serving.map((entry) => entry.phases.reduce((sum, n) => sum + need(n), 0))));
  // With no timing entered at all, the served groups share the cycle equally.
  const weights = groupNeeds.some((w) => w > 0) ? groupNeeds : groups.map((serving) => (serving.length > 0 ? 1 : 0));
  const groupTimes = apportion(cycle, weights);

  const splits: Record<string, Tenths> = {};
  groups.forEach((serving, g) => {
    for (const entry of serving) {
      const shares = apportion(groupTimes[g]!, entry.phases.map(need));
      entry.phases.forEach((n, k) => (splits[String(n)] = shares[k]!));
    }
  });
  return splits;
}
