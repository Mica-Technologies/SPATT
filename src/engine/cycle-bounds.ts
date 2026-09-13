/**
 * Cycle bounds for free (uncoordinated) operation: how short a cycle can get when every phase
 * gaps out at minimum, and how long when every phase maxes out.
 *
 * Each ring's time through a barrier group is the sum of its phases' green plus clearances; the
 * rings must wait for each other at the barrier, so a group lasts as long as its longest ring.
 */
import type { Intersection, Phase, Tenths } from '../model';

export interface GroupBound {
  /** Per ring: time through this barrier group (0 for a ring with no enabled phase in it). */
  rings: Tenths[];
  /** The barrier-limited time: the longest ring. */
  total: Tenths;
}

export interface CycleBounds {
  /** Every phase called, each timing its minimum green. */
  minimum: { groups: GroupBound[]; cycle: Tenths };
  /** As `minimum`, but phases with pedestrian service run their full walk and clearance. */
  minimumWithPedestrians: { groups: GroupBound[]; cycle: Tenths };
  /** Every phase called and maxing out (on Max 1, or Max 2 where programmed if `useMax2`). */
  maximum: { groups: GroupBound[]; cycle: Tenths };
}

type GreenOf = (phase: Phase) => Tenths;

export function cycleBounds(intersection: Intersection, useMax2 = false): CycleBounds {
  const vehicleMin: GreenOf = (p) => (p.movement.kind === 'pedestrian' ? 0 : p.minGreen);
  const pedestrianGreen = (p: Phase): Tenths => (p.pedestrian.enabled ? p.pedestrian.walk + p.pedestrian.clearance : 0);
  const max: GreenOf = (p) => {
    const vehicle = p.movement.kind === 'pedestrian' ? 0 : useMax2 && p.maxGreen2 > 0 ? p.maxGreen2 : p.maxGreen1;
    return Math.max(vehicle, pedestrianGreen(p));
  };
  return {
    minimum: bound(intersection, vehicleMin),
    minimumWithPedestrians: bound(intersection, (p) => Math.max(vehicleMin(p), pedestrianGreen(p))),
    maximum: bound(intersection, max),
  };
}

function bound(intersection: Intersection, green: GreenOf): { groups: GroupBound[]; cycle: Tenths } {
  const phases = new Map(intersection.phases.map((p) => [p.number, p]));
  const groupCount = intersection.rings[0]?.groups.length ?? 0;
  const groups: GroupBound[] = [];
  for (let g = 0; g < groupCount; g++) {
    const rings = intersection.rings.map((ring) =>
      (ring.groups[g] ?? []).reduce((sum, n) => {
        const phase = phases.get(n);
        return phase?.enabled ? sum + green(phase) + phase.yellow + phase.redClear : sum;
      }, 0),
    );
    groups.push({ rings, total: Math.max(0, ...rings) });
  }
  return { groups, cycle: groups.reduce((sum, group) => sum + group.total, 0) };
}
