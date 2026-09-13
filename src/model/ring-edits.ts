/**
 * Edits to an intersection's base ring structure (`intersection.rings`).
 *
 * Every function mutates the intersection it is given (the workspace store hands them a clone)
 * and keeps the structure rectangular: all rings end with the same number of barrier groups.
 * A pattern's `sequence` (its lead/lag order) may only reorder phases within the base structure's
 * ring and group membership, so after any change that moves a phase between rings or groups, or
 * adds or removes a ring or group, patterns whose sequence no longer matches are reset to the base
 * order in the same edit. Each structural edit returns the ids of the patterns it reset.
 */
import type { Intersection, Ring } from './schema';
import { MAX_RINGS } from './schema';

export interface PhaseLocation {
  ring: number;
  group: number;
  index: number;
}

/** Where a phase first appears in a ring structure, or null when it is not placed. */
export function locatePhase(rings: readonly Ring[], phase: number): PhaseLocation | null {
  for (let r = 0; r < rings.length; r++) {
    const groups = rings[r]?.groups ?? [];
    for (let g = 0; g < groups.length; g++) {
      const index = groups[g]?.indexOf(phase) ?? -1;
      if (index >= 0) {
        return { ring: r, group: g, index };
      }
    }
  }
  return null;
}

/** Defined phases that appear in no ring, in number order. */
export function unassignedPhases(intersection: Intersection): number[] {
  const placed = new Set(intersection.rings.flatMap((ring) => ring.groups.flat()));
  return intersection.phases
    .map((p) => p.number)
    .filter((n) => !placed.has(n))
    .sort((a, b) => a - b);
}

/** The number of barrier groups the structure has (the largest ring's, if they disagree). */
export function barrierGroupCount(rings: readonly Ring[]): number {
  return rings.reduce((most, ring) => Math.max(most, ring.groups.length), 0);
}

/**
 * True when two ring structures place the same phases in the same ring and barrier group,
 * whatever their order within each group.
 */
export function sameRingMembership(a: readonly Ring[], b: readonly Ring[]): boolean {
  if (a.length !== b.length) {
    return false;
  }
  const key = (group: readonly number[]) => [...group].sort((x, y) => x - y).join(',');
  return a.every((ring, r) => {
    const other = b[r];
    if (!other || ring.groups.length !== other.groups.length) {
      return false;
    }
    return ring.groups.every((group, g) => key(group) === key(other.groups[g] ?? []));
  });
}

/** Resets to `null` every pattern sequence whose membership differs from the base rings. */
export function reconcileSequences(intersection: Intersection): string[] {
  const reset: string[] = [];
  for (const pattern of intersection.patterns) {
    if (pattern.sequence !== null && !sameRingMembership(pattern.sequence, intersection.rings)) {
      pattern.sequence = null;
      reset.push(pattern.id);
    }
  }
  return reset;
}

/** Pads shorter rings with empty barrier groups so every ring has the same count. */
function equalizeGroups(intersection: Intersection): void {
  const count = barrierGroupCount(intersection.rings);
  for (const ring of intersection.rings) {
    while (ring.groups.length < count) {
      ring.groups.push([]);
    }
  }
}

function takeOut(intersection: Intersection, phase: number): void {
  for (const ring of intersection.rings) {
    ring.groups = ring.groups.map((group) => group.filter((n) => n !== phase));
  }
}

/**
 * Converts a drop position into a `movePhase` index. `beforeIndex` counts positions in the
 * target group as it is now, dragged phase included; when the phase is already earlier in that
 * same group, taking it out shifts the position back by one.
 */
export function indexAfterRemoval(rings: readonly Ring[], phase: number, toRing: number, toGroup: number, beforeIndex: number): number {
  const group = rings[toRing]?.groups[toGroup] ?? [];
  const earlier = group.slice(0, Math.max(0, beforeIndex)).filter((n) => n === phase).length;
  return Math.max(0, beforeIndex - earlier);
}

/**
 * Places `phase` in ring `toRing`, barrier group `toGroup`, at `toIndex` in that group once the
 * phase has been taken out of wherever it was (clamped to the group's length). Any other
 * occurrence of the phase in the structure is removed, so this also repairs a repeated phase.
 */
export function movePhase(intersection: Intersection, phase: number, toRing: number, toGroup: number, toIndex: number): string[] {
  if (!intersection.phases.some((p) => p.number === phase)) {
    throw new Error(`Phase ${phase} is not defined`);
  }
  equalizeGroups(intersection);
  const target = intersection.rings[toRing]?.groups[toGroup];
  if (!target) {
    throw new Error(`Ring ${toRing + 1} has no barrier group ${toGroup + 1}`);
  }
  takeOut(intersection, phase);
  const group = intersection.rings[toRing]!.groups[toGroup]!;
  group.splice(Math.min(Math.max(0, toIndex), group.length), 0, phase);
  return reconcileSequences(intersection);
}

/** Takes a phase (defined or not) out of every ring, leaving it unassigned. */
export function unassignPhase(intersection: Intersection, phase: number): string[] {
  takeOut(intersection, phase);
  return reconcileSequences(intersection);
}

/** Appends an empty ring with as many barrier groups as the others. */
export function addRing(intersection: Intersection): string[] {
  if (intersection.rings.length >= MAX_RINGS) {
    throw new Error(`An intersection has at most ${MAX_RINGS} rings`);
  }
  equalizeGroups(intersection);
  const count = Math.max(1, barrierGroupCount(intersection.rings));
  intersection.rings.push({ groups: Array.from({ length: count }, () => []) });
  equalizeGroups(intersection);
  return reconcileSequences(intersection);
}

/** Removes ring `ring`; its phases become unassigned. The last ring cannot be removed. */
export function removeRing(intersection: Intersection, ring: number): string[] {
  if (intersection.rings.length <= 1) {
    throw new Error('An intersection needs at least one ring');
  }
  if (!intersection.rings[ring]) {
    throw new Error(`There is no ring ${ring + 1}`);
  }
  intersection.rings.splice(ring, 1);
  equalizeGroups(intersection);
  return reconcileSequences(intersection);
}

/** Appends an empty barrier group to every ring. */
export function addBarrierGroup(intersection: Intersection): string[] {
  equalizeGroups(intersection);
  for (const ring of intersection.rings) {
    ring.groups.push([]);
  }
  return reconcileSequences(intersection);
}

/** Removes barrier group `group` from every ring; its phases become unassigned. */
export function removeBarrierGroup(intersection: Intersection, group: number): string[] {
  equalizeGroups(intersection);
  const count = barrierGroupCount(intersection.rings);
  if (count <= 1) {
    throw new Error('The ring structure needs at least one barrier group');
  }
  if (group < 0 || group >= count) {
    throw new Error(`There is no barrier group ${group + 1}`);
  }
  for (const ring of intersection.rings) {
    ring.groups.splice(group, 1);
  }
  return reconcileSequences(intersection);
}
