import type { Intersection, Issue } from '../../model';

/**
 * Phase numbers that intersection-relative issues point at: a pattern split
 * (`patterns.<i>.splits.<phase>`) or a phase's own fields (`phases.<index>...`).
 */
export function flaggedPhases(intersection: Intersection, issues: readonly Issue[]): Set<number> {
  const flagged = new Set<number>();
  for (const { path } of issues) {
    if (path[0] === 'patterns' && path[2] === 'splits' && path[3] !== undefined) {
      flagged.add(Number(path[3]));
    } else if (path[0] === 'phases' && typeof path[1] === 'number') {
      const phase = intersection.phases[path[1]];
      if (phase) flagged.add(phase.number);
    }
  }
  return flagged;
}
