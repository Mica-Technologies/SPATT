import { describe, expect, it } from 'vitest';
import {
  csmDefault,
  leadLagEightPhase,
  splitPhaseSideStreet,
  standardEightPhase,
  twoPhase,
  validateIntersection,
  type Intersection,
  type Pattern,
} from '../model';
import { cycleBounds } from './cycle-bounds';
import { apportion, balanceSplits, evenSplits, splitMinimums } from './splits';

const patternErrors = (intersection: Intersection) =>
  validateIntersection(intersection).filter((i) => i.severity === 'error' && i.code.startsWith('pattern.'));

/** Applies `balanceSplits` to the first pattern and returns the new splits. */
function balanced(intersection: Intersection, change: (pattern: Pattern) => void = () => {}) {
  const pattern = intersection.patterns[0]!;
  change(pattern);
  pattern.splits = balanceSplits(intersection, pattern.id);
  return pattern.splits;
}

describe('splitMinimums', () => {
  // Standard eight-phase phase 2: min green 10, yellow 4, red clear 2, walk 7, ped clear 18.
  it('gives the vehicle and pedestrian minimums', () => {
    const phase = standardEightPhase().phases[1]!;
    expect(splitMinimums(phase)).toEqual({ vehicle: 160, pedestrian: 310, floor: 160 });
  });

  it('raises the floor to the pedestrian minimum with pedestrian recall', () => {
    const phase = standardEightPhase().phases[1]!;
    phase.pedestrian.recall = true;
    expect(splitMinimums(phase).floor).toBe(310);
  });

  it('drops minimum green for a pedestrian phase', () => {
    const phase = standardEightPhase().phases[1]!;
    phase.movement.kind = 'pedestrian';
    expect(splitMinimums(phase).vehicle).toBe(60);
  });
});

describe('apportion', () => {
  it('shares by largest remainder and sums exactly', () => {
    expect(apportion(900, [410, 370])).toEqual([473, 427]);
    expect(apportion(10, [1, 1, 1])).toEqual([4, 3, 3]);
    expect(apportion(7, [0, 0])).toEqual([4, 3]);
    expect(apportion(5, [])).toEqual([]);
  });
});

describe('balanceSplits', () => {
  it('raises short rings on their coordinated phase, else their last phase', () => {
    // Group 1: ring 1 = 15 + 35 = 50, ring 2 = 15 + 30 = 45 → phase 6 (coordinated) +5.
    // Group 2: ring 1 = 12 + 28 = 40, ring 2 = 10 + 28 = 38 → phase 8 (last) +2. Total 90 = cycle.
    const intersection = standardEightPhase();
    const splits = balanced(intersection, (p) => Object.assign(p.splits, { 6: 300, 7: 100 }));
    expect(splits).toEqual({ 1: 150, 2: 350, 3: 120, 4: 280, 5: 150, 6: 350, 7: 100, 8: 300 });
    expect(patternErrors(intersection)).toEqual([]);
  });

  it('adds a longer cycle to the coordinated phases', () => {
    const intersection = standardEightPhase();
    const splits = balanced(intersection, (p) => (p.cycle = 1000));
    expect(splits).toMatchObject({ 2: 450, 6: 450, 1: 150, 4: 280 });
    expect(patternErrors(intersection)).toEqual([]);
  });

  it('takes a shorter cycle from the coordinated phases, but not below their minimum', () => {
    // 90 → 70 s wants 20 s off phases 2 and 6 (35 s each); their floor is 10 + 4 + 2 = 16 s,
    // so they stop at 16 s and 1.0 s stays over for validation to report.
    const intersection = standardEightPhase();
    const splits = balanced(intersection, (p) => (p.cycle = 700));
    expect(splits).toMatchObject({ 2: 160, 6: 160 });
    expect(patternErrors(intersection).map((i) => i.code)).toEqual(['pattern.cycle-sum']);
  });

  it('keeps pedestrian time for a phase on pedestrian recall, and every ring together', () => {
    // Phase 2's floor is now 7 + 18 + 4 + 2 = 31 s, so only 4 s comes off, in both rings.
    const intersection = standardEightPhase();
    intersection.phases[1]!.pedestrian.recall = true;
    const splits = balanced(intersection, (p) => (p.cycle = 700));
    expect(splits).toMatchObject({ 2: 310, 6: 310 });
  });

  it('follows a lead-lag sequence', () => {
    // Ring 1 runs 2 then 1; phase 2 is still the coordinated phase that takes the difference.
    const intersection = leadLagEightPhase();
    const splits = balanced(intersection, (p) => (p.splits['2'] = 300));
    expect(splits['2']).toBe(350);
    expect(patternErrors(intersection)).toEqual([]);
  });

  it('ignores rings that wait out a split-phased group', () => {
    const intersection = splitPhaseSideStreet();
    const splits = balanced(intersection, (p) => (p.cycle = 1300));
    expect(splits).toEqual({ 1: 150, 2: 550, 4: 300, 5: 150, 6: 550, 8: 300 });
    expect(patternErrors(intersection)).toEqual([]);
  });

  it('uses the first barrier group when there is no coordinated phase', () => {
    const intersection = standardEightPhase();
    const splits = balanced(intersection, (p) => {
      p.cycle = 1000;
      p.coordinatedPhases = [];
    });
    expect(splits).toMatchObject({ 2: 450, 6: 450 });
  });

  it('carries a disabled phase split over untouched and skips it when balancing', () => {
    const intersection = standardEightPhase();
    intersection.phases[6]!.enabled = false; // phase 7
    const splits = balanced(intersection);
    expect(splits).toMatchObject({ 7: 120, 8: 400 });
  });

  it('only aligns rings in a free pattern', () => {
    const intersection = csmDefault();
    const splits = balanced(intersection, (p) => (p.cycle = 1500));
    expect(Object.values(splits).every((v) => v === 225)).toBe(true);
  });

  it('rejects an unknown pattern', () => {
    expect(() => balanceSplits(standardEightPhase(), 'nope')).toThrow(RangeError);
  });
});

describe('evenSplits', () => {
  it('shares the cycle by minimum-with-pedestrians need (standard eight-phase, 90 s)', () => {
    // Needs: lefts 10 s, 2/6 31 s, 4/8 27 s → groups 41 and 37 s of 78.
    // Groups 90·41/78 = 47.3 → 47.3 s and 42.7 s; within them 47.3·10/41 = 11.5 s etc.
    const intersection = standardEightPhase();
    const splits = evenSplits(intersection, 900);
    expect(splits).toEqual({ 1: 115, 2: 358, 5: 115, 6: 358, 3: 115, 4: 312, 7: 115, 8: 312 });
    intersection.patterns[0]!.splits = splits;
    expect(patternErrors(intersection)).toEqual([]);
  });

  it('handles split phasing (ring 2 empty in groups 2 and 3)', () => {
    const intersection = splitPhaseSideStreet();
    const splits = evenSplits(intersection, 1200);
    expect(splits).toEqual({ 1: 126, 2: 392, 5: 126, 6: 392, 4: 341, 8: 341 });
    intersection.patterns[0]!.splits = splits;
    expect(patternErrors(intersection)).toEqual([]);
  });

  it('handles two-phase', () => {
    const intersection = twoPhase();
    expect(evenSplits(intersection, 700)).toEqual({ 2: 376, 6: 376, 4: 324, 8: 324 });
  });

  it('always sums to the cycle and passes validation once the cycle covers the minimums', () => {
    const intersection = standardEightPhase();
    const minimum = cycleBounds(intersection).minimumWithPedestrians.cycle;
    for (let cycle = 500; cycle <= 1800; cycle += 7) {
      const pattern = intersection.patterns[0]!;
      pattern.cycle = cycle;
      pattern.splits = evenSplits(intersection, cycle);
      const ring1 = [1, 2, 3, 4].reduce((sum, n) => sum + pattern.splits[String(n)]!, 0);
      expect(ring1).toBe(cycle);
      if (cycle >= minimum) {
        expect(patternErrors(intersection)).toEqual([]);
      }
    }
  });

  it('leaves out disabled phases', () => {
    const intersection = standardEightPhase();
    intersection.phases[6]!.enabled = false;
    const splits = evenSplits(intersection, 900);
    expect(splits['7']).toBeUndefined();
    expect(splits['8']).toBe(splits['3']! + splits['4']!);
  });
});
