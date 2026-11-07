/**
 * Phase exclusions (ASC-3 phase concurrency): pairs of phases that must never time together,
 * whatever the ring structure allows. A pair is excluded when either phase lists the other.
 */
import type { Intersection, Phase } from './schema';

/** Whether phases `a` and `b` are excluded from timing together. */
export function phasesExclude(phases: readonly Phase[], a: number, b: number): boolean {
  if (a === b) return false;
  return phases.some((p) => (p.number === a && p.exclusions.includes(b)) || (p.number === b && p.exclusions.includes(a)));
}

/** The phases excluded beside `number`, from either side of each pair, sorted. */
export function exclusionsOf(phases: readonly Phase[], number: number): number[] {
  const out = new Set<number>();
  for (const p of phases) {
    if (p.number === number) p.exclusions.forEach((n) => out.add(n));
    else if (p.exclusions.includes(number)) out.add(p.number);
  }
  out.delete(number);
  return [...out].sort((x, y) => x - y);
}

/**
 * Sets the phases `number` must not time beside, keeping both sides of every pair in step: each
 * listed phase lists `number` back, and a phase dropped from the list drops it too. Numbers that
 * are not defined phases, and `number` itself, are left out.
 */
export function setExclusions(intersection: Intersection, number: number, list: readonly number[]): void {
  const defined = new Set(intersection.phases.map((p) => p.number));
  const wanted = [...new Set(list)].filter((n) => n !== number && defined.has(n)).sort((x, y) => x - y);
  for (const phase of intersection.phases) {
    if (phase.number === number) {
      phase.exclusions = wanted;
    } else if (wanted.includes(phase.number)) {
      if (!phase.exclusions.includes(number)) phase.exclusions = [...phase.exclusions, number].sort((x, y) => x - y);
    } else {
      phase.exclusions = phase.exclusions.filter((n) => n !== number);
    }
  }
}
