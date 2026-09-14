/**
 * Moving the end of coordinated green: the coordinated phases gain (or give up) time, and the
 * other barrier groups give (or take) the same amount, equally in every ring, so the cycle and the
 * barriers still line up. The start of coordinated green stays where it is on the system clock, so
 * the offset number only changes when it is measured to a point that moves (the end of
 * coordinated green, or the start of the ring sequence when earlier groups change).
 */
import { effectiveSequence, type Intersection, type Tenths } from '../model';
import { convertOffset, projectCycle } from './projection';
import { splitMinimums } from './splits';

export interface GreenShift {
  splits: Record<string, Tenths>;
  offset: Tenths;
  /** The change actually made (tenths): `delta` limited by the phases' minimum splits. */
  applied: Tenths;
}

/**
 * Lengthens (positive `delta`) or shortens the coordinated phases by `delta` tenths.
 *
 * - Longer: time comes from the barrier groups after the coordinated group in cycle order, one
 *   group at a time, the same amount from each ring there, each ring's phases giving last to first,
 *   never below their minimum split.
 * - Shorter: the coordinated phases give time down to their minimums; it goes to the last phase of
 *   each ring in the group that follows the coordinated group.
 *
 * Returns `null` when the pattern cannot be projected or has no other barrier group to trade with.
 */
export function shiftCoordinatedGreen(intersection: Intersection, patternId: string, delta: Tenths): GreenShift | null {
  const pattern = intersection.patterns.find((p) => p.id === patternId);
  const before = projectCycle(intersection, patternId);
  if (!pattern || !before.ok) return null;

  const phases = new Map(intersection.phases.map((p) => [p.number, p]));
  const enabled = (n: number) => phases.get(n)?.enabled === true;
  const sequence = effectiveSequence(pattern, intersection.rings);
  const groupCount = sequence[0]?.groups.length ?? 0;
  const coordinated = new Set(pattern.coordinatedPhases);
  const serving = (g: number) => sequence.map((ring) => (ring.groups[g] ?? []).filter(enabled)).filter((list) => list.length > 0);
  const coordGroup = Array.from({ length: groupCount }, (_, g) => g).find((g) => serving(g).some((list) => list.some((n) => coordinated.has(n))));
  if (coordGroup === undefined || groupCount < 2) return null;
  const others = Array.from({ length: groupCount - 1 }, (_, k) => (coordGroup + 1 + k) % groupCount).filter((g) => serving(g).length > 0);
  if (others.length === 0) return null;

  const splits: Record<string, Tenths> = { ...pattern.splits };
  const get = (n: number) => splits[String(n)] ?? 0;
  const spare = (n: number) => Math.max(0, get(n) - splitMinimums(phases.get(n)!).floor);
  const targets = serving(coordGroup).map((list) => list.find((n) => coordinated.has(n)) ?? list.at(-1)!);

  let applied: Tenths;
  if (delta >= 0) {
    let left = delta;
    for (const g of others) {
      const rings = serving(g);
      const take = Math.min(left, ...rings.map((list) => list.reduce((sum, n) => sum + spare(n), 0)));
      for (const list of rings) {
        let owed = take;
        for (const n of [...list].reverse()) {
          const cut = Math.min(owed, spare(n));
          splits[String(n)] = get(n) - cut;
          owed -= cut;
        }
      }
      left -= take;
    }
    applied = delta - left;
  } else {
    applied = -Math.min(-delta, ...targets.map(spare));
    for (const list of serving(others[0]!)) {
      const n = list.at(-1)!;
      splits[String(n)] = get(n) - applied;
    }
  }
  for (const n of targets) {
    splits[String(n)] = get(n) + applied;
  }

  // Keep coordinated green starting at the same system time, whatever the offset is measured to.
  const greenStart = convertOffset(before.projection, 'beginCoordGreen');
  const trial: Intersection = { ...intersection, patterns: intersection.patterns.map((p) => (p.id === patternId ? { ...p, splits, offset: greenStart, offsetReference: 'beginCoordGreen' as const } : p)) };
  const after = projectCycle(trial, patternId);
  const offset = after.ok ? convertOffset(after.projection, pattern.offsetReference) : pattern.offset;
  return { splits, offset, applied };
}
