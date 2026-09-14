/**
 * Pattern list and sequence edits, as recipes over a (cloned) intersection. Kept free of React
 * so they can be tested directly.
 */
import { balanceSplits, cycleBounds, evenSplits } from '../../../engine';
import { effectiveSequence, uniqueName, type Intersection, type Pattern, type Ring } from '../../../model';

/** The smallest cycle a new pattern starts with. */
export const NEW_PATTERN_MIN_CYCLE = 600;

/** `pattern-<n>` with the lowest `n` not already used in the intersection. */
export function nextPatternId(intersection: Intersection): string {
  const taken = new Set(intersection.patterns.map((p) => p.id));
  for (let n = 1; ; n++) {
    const id = `pattern-${n}`;
    if (!taken.has(id)) {
      return id;
    }
  }
}

/**
 * A coordinated phase per ring in the first barrier group that has phases in every serving ring:
 * each ring's last enabled through movement there, else its last enabled phase.
 */
export function defaultCoordinatedPhases(intersection: Intersection): number[] {
  const phases = new Map(intersection.phases.map((p) => [p.number, p]));
  const groupCount = intersection.rings[0]?.groups.length ?? 0;
  for (let g = 0; g < groupCount; g++) {
    const chosen = intersection.rings
      .map((ring) => (ring.groups[g] ?? []).filter((n) => phases.get(n)?.enabled))
      .filter((list) => list.length > 0)
      .map((list) => list.filter((n) => phases.get(n)!.movement.kind === 'through').at(-1) ?? list.at(-1)!);
    if (chosen.length > 0) {
      return chosen;
    }
  }
  return [];
}

/** Cycle for a new pattern: the minimum with pedestrians, up to the next 10 s, at least 60 s. */
export function newPatternCycle(intersection: Intersection): number {
  const minimum = cycleBounds(intersection).minimumWithPedestrians.cycle;
  return Math.max(NEW_PATTERN_MIN_CYCLE, Math.ceil(minimum / 100) * 100);
}

/** A new coordinated pattern with proportional splits; not yet added to the intersection. */
export function createPattern(intersection: Intersection): Pattern {
  const cycle = newPatternCycle(intersection);
  const pattern: Pattern = {
    id: nextPatternId(intersection),
    name: uniqueName(`Pattern ${intersection.patterns.length + 1}`, intersection.patterns.map((p) => p.name)),
    mode: 'coordinated',
    cycle,
    offset: 0,
    offsetReference: 'beginCoordGreen',
    coordinatedPhases: defaultCoordinatedPhases(intersection),
    splits: evenSplits(intersection, cycle),
    sequence: null,
    maxGreen: 'max1',
    forceOffMode: 'fixed',
    volumeSetId: null,
  };
  return pattern;
}

/** Adds a copy of a pattern right after it and returns the copy's id. */
export function duplicatePattern(intersection: Intersection, id: string): string | null {
  const index = intersection.patterns.findIndex((p) => p.id === id);
  const source = intersection.patterns[index];
  if (!source) {
    return null;
  }
  const copy: Pattern = { ...structuredClone(source), id: nextPatternId(intersection), name: uniqueName(source.name, intersection.patterns.map((p) => p.name)) };
  intersection.patterns.splice(index + 1, 0, copy);
  return copy.id;
}

/**
 * Removes a pattern; schedule entries that ran it run free instead. Returns the id of the
 * pattern to select next (the one that took its place, else the one before), or null.
 */
export function deletePattern(intersection: Intersection, id: string): string | null {
  const index = intersection.patterns.findIndex((p) => p.id === id);
  if (index < 0) {
    return intersection.patterns[0]?.id ?? null;
  }
  intersection.patterns.splice(index, 1);
  for (const entry of intersection.schedule) {
    if (entry.patternId === id) {
      entry.patternId = null;
    }
  }
  return (intersection.patterns[index] ?? intersection.patterns[index - 1])?.id ?? null;
}

/** Schedule entries that run a pattern. */
export const scheduleUses = (intersection: Intersection, id: string): number => intersection.schedule.filter((e) => e.patternId === id).length;

function sameOrder(a: Ring[], b: Ring[]): boolean {
  return JSON.stringify(a.map((r) => r.groups)) === JSON.stringify(b.map((r) => r.groups));
}

/**
 * Swaps two phases of one ring's barrier group in the pattern's own sequence (starting from the
 * base rings if it has none). The sequence goes back to `null` when it matches the base again.
 */
export function swapSequencePhases(intersection: Intersection, patternId: string, ring: number, a: number, b: number): void {
  const pattern = intersection.patterns.find((p) => p.id === patternId);
  if (!pattern) {
    return;
  }
  const sequence = structuredClone(effectiveSequence(pattern, intersection.rings));
  const group = sequence[ring]?.groups.find((phases) => phases.includes(a) && phases.includes(b));
  if (!group) {
    return;
  }
  const i = group.indexOf(a);
  const j = group.indexOf(b);
  [group[i], group[j]] = [group[j]!, group[i]!];
  pattern.sequence = sameOrder(sequence, intersection.rings) ? null : sequence;
}

/** Replaces the splits of a pattern with balanced ones. */
export function applyBalance(intersection: Intersection, patternId: string): void {
  const pattern = intersection.patterns.find((p) => p.id === patternId);
  if (pattern) {
    pattern.splits = balanceSplits(intersection, patternId);
  }
}

/** Replaces the splits of a pattern with proportional ones for its cycle. */
export function applyEven(intersection: Intersection, patternId: string): void {
  const pattern = intersection.patterns.find((p) => p.id === patternId);
  if (pattern) {
    pattern.splits = evenSplits(intersection, pattern.cycle);
  }
}

/**
 * Turns a coordinated phase on or off. Turning one on drops any coordinated phase it conflicts
 * with (the same ring, or another barrier group), so the choice stays one a controller accepts.
 */
export function toggleCoordinatedPhase(intersection: Intersection, patternId: string, phase: number): void {
  const pattern = intersection.patterns.find((p) => p.id === patternId);
  if (!pattern) {
    return;
  }
  if (pattern.coordinatedPhases.includes(phase)) {
    pattern.coordinatedPhases = pattern.coordinatedPhases.filter((n) => n !== phase);
    return;
  }
  const sequence = effectiveSequence(pattern, intersection.rings);
  const locate = (n: number) => {
    for (let r = 0; r < sequence.length; r++) {
      const g = sequence[r]!.groups.findIndex((phases) => phases.includes(n));
      if (g >= 0) return { r, g };
    }
    return null;
  };
  const at = locate(phase);
  const kept = pattern.coordinatedPhases.filter((n) => {
    const other = locate(n);
    return at === null || (other !== null && other.r !== at.r && other.g === at.g);
  });
  pattern.coordinatedPhases = [...kept, phase].sort((x, y) => x - y);
}
