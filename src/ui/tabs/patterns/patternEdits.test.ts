import { describe, expect, it } from 'vitest';
import { leadLagEightPhase, splitPhaseSideStreet, standardEightPhase, twoPhase, validateIntersection } from '../../../model';
import {
  createPattern,
  defaultCoordinatedPhases,
  deletePattern,
  duplicatePattern,
  newPatternCycle,
  nextPatternId,
  swapSequencePhases,
  toggleCoordinatedPhase,
} from './patternEdits';

describe('pattern edits', () => {
  it('creates a valid coordinated pattern with a unique id and name', () => {
    // Standard eight-phase minimum with pedestrians is 78 s → 80 s.
    const intersection = standardEightPhase();
    const pattern = createPattern(intersection);
    expect(pattern).toMatchObject({ id: 'pattern-1', name: 'Pattern 2', mode: 'coordinated', cycle: 800, coordinatedPhases: [2, 6], sequence: null });
    intersection.patterns.push(pattern);
    expect(validateIntersection(intersection).filter((i) => i.severity === 'error')).toEqual([]);
    expect(nextPatternId(intersection)).toBe('pattern-2');
  });

  it('starts at 60 s for a small intersection', () => {
    const intersection = twoPhase();
    intersection.phases.forEach((p) => (p.pedestrian.enabled = false));
    expect(newPatternCycle(intersection)).toBe(600);
  });

  it('picks the main-street through movements to coordinate', () => {
    expect(defaultCoordinatedPhases(splitPhaseSideStreet())).toEqual([2, 6]);
    expect(defaultCoordinatedPhases(twoPhase())).toEqual([2, 6]);
  });

  it('duplicates after the source and deletes to Free in the schedule', () => {
    const intersection = standardEightPhase();
    const copyId = duplicatePattern(intersection, 'am-peak');
    expect(intersection.patterns.map((p) => [p.id, p.name])).toEqual([
      ['am-peak', 'AM Peak'],
      ['pattern-1', 'AM Peak (2)'],
    ]);
    expect(copyId).toBe('pattern-1');

    expect(deletePattern(intersection, 'am-peak')).toBe('pattern-1');
    expect(intersection.schedule.map((e) => e.patternId)).toEqual([null, null]);
    expect(deletePattern(intersection, 'pattern-1')).toBeNull();
  });

  it('swaps phase order and returns to the base sequence', () => {
    const intersection = standardEightPhase();
    swapSequencePhases(intersection, 'am-peak', 0, 1, 2);
    expect(intersection.patterns[0]!.sequence).toEqual([{ groups: [[2, 1], [3, 4]] }, { groups: [[5, 6], [7, 8]] }]);
    swapSequencePhases(intersection, 'am-peak', 0, 2, 1);
    expect(intersection.patterns[0]!.sequence).toBeNull();

    const leadLag = leadLagEightPhase();
    swapSequencePhases(leadLag, 'pm-peak-lead-lag', 0, 2, 1);
    expect(leadLag.patterns[0]!.sequence).toBeNull();
  });

  it('replaces conflicting coordinated phases', () => {
    const intersection = standardEightPhase();
    toggleCoordinatedPhase(intersection, 'am-peak', 1); // same ring as 2
    expect(intersection.patterns[0]!.coordinatedPhases).toEqual([1, 6]);
    toggleCoordinatedPhase(intersection, 'am-peak', 4); // other barrier group
    expect(intersection.patterns[0]!.coordinatedPhases).toEqual([4]);
    toggleCoordinatedPhase(intersection, 'am-peak', 8);
    toggleCoordinatedPhase(intersection, 'am-peak', 4);
    expect(intersection.patterns[0]!.coordinatedPhases).toEqual([8]);
  });
});
