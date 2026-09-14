/**
 * Structural edits that must keep references consistent: removing a phase also removes it
 * from rings, sequences, splits, coordinated phases, overlaps and preempts, so the editor never
 * leaves dangling phase numbers behind. All functions mutate the intersection they are given
 * (the workspace store hands them a clone).
 */
import { removeLaneGroup } from './capacity';
import type { Intersection, MovementKind, Phase } from './schema';
import { MAX_PHASES } from './schema';
import { makePhase } from './templates';

/** The lowest phase number not yet defined, or null when all 16 are. */
export function nextPhaseNumber(intersection: Intersection): number | null {
  const used = new Set(intersection.phases.map((p) => p.number));
  for (let n = 1; n <= MAX_PHASES; n++) {
    if (!used.has(n)) {
      return n;
    }
  }
  return null;
}

/** Adds a phase with sensible defaults (odd numbers as lefts, even as throughs), kept sorted. */
export function addPhase(intersection: Intersection, number: number): Phase {
  if (intersection.phases.some((p) => p.number === number)) {
    throw new Error(`Phase ${number} already exists`);
  }
  const kind: MovementKind = number % 2 === 1 ? 'left' : 'through';
  const phase = makePhase(number, {
    label: `Phase ${number}`,
    approach: null,
    kind,
    minGreen: kind === 'left' ? 50 : 100,
    maxGreen1: kind === 'left' ? 200 : 300,
    yellow: kind === 'left' ? 35 : 40,
    redClear: kind === 'left' ? 15 : 20,
  });
  intersection.phases.push(phase);
  intersection.phases.sort((a, b) => a.number - b.number);
  return phase;
}

export function removePhase(intersection: Intersection, number: number): void {
  const without = (list: number[]) => list.filter((n) => n !== number);
  intersection.phases = intersection.phases.filter((p) => p.number !== number);
  for (const ring of intersection.rings) {
    ring.groups = ring.groups.map(without);
  }
  for (const pattern of intersection.patterns) {
    delete pattern.splits[String(number)];
    pattern.coordinatedPhases = without(pattern.coordinatedPhases);
    if (pattern.sequence) {
      for (const ring of pattern.sequence) {
        ring.groups = ring.groups.map(without);
      }
    }
  }
  for (const overlap of intersection.overlaps) {
    overlap.includedPhases = without(overlap.includedPhases);
    overlap.modifierPhases = without(overlap.modifierPhases);
  }
  for (const preempt of intersection.preempts) {
    preempt.trackClearancePhases = without(preempt.trackClearancePhases);
    preempt.dwellPhases = without(preempt.dwellPhases);
    preempt.exitPhases = without(preempt.exitPhases);
  }
  for (const group of intersection.laneGroups.filter((g) => g.phase === number)) {
    removeLaneGroup(intersection, group.id);
  }
}

/** `base`, or `base (2)`, `base (3)`, … — whichever is not in `taken`. */
export function uniqueName(base: string, taken: Iterable<string>): string {
  const names = new Set(taken);
  if (!names.has(base)) {
    return base;
  }
  for (let n = 2; ; n++) {
    const candidate = `${base} (${n})`;
    if (!names.has(candidate)) {
      return candidate;
    }
  }
}

/**
 * Random lowercase hex digits. Uses `crypto.getRandomValues`, which, unlike `crypto.randomUUID`,
 * also exists on plain-http pages, such as a SPATT server opened by its network address.
 */
export function randomHex(digits: number): string {
  const bytes = crypto.getRandomValues(new Uint8Array(Math.ceil(digits / 2)));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('').slice(0, digits);
}

/** A short random id with a prefix, e.g. `i-3f9a1c2b`. */
export function randomId(prefix: string, random: () => string = () => randomHex(8)): string {
  return `${prefix}-${random().replace(/-/g, '').slice(0, 8).toLowerCase()}`;
}
