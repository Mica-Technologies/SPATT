import { describe, expect, it } from 'vitest';
import { standardEightPhase, validateIntersection } from '../model';
import { shiftCoordinatedGreen } from './green-shift';
import { convertOffset, projectCycle } from './projection';

// Standard eight-phase, 90 s: ring 1 [1 15 s, 2 35 s | 3 12 s, 4 28 s], ring 2 the same with 5-8.
// Minimum splits: lefts 10 s (5 s green + 5 s clearance), throughs 16 s (10 s + 6 s).
describe('shiftCoordinatedGreen', () => {
  it('takes the time from the side street, last phase first, equally in both rings', () => {
    const i = standardEightPhase();
    const result = shiftCoordinatedGreen(i, 'am-peak', 30)!;
    expect(result).toEqual({ applied: 30, offset: 0, splits: { 1: 150, 2: 380, 3: 120, 4: 250, 5: 150, 6: 380, 7: 120, 8: 250 } });
  });

  it('stops at the side street minimums', () => {
    // Phase 4 can give 12 s (to 16 s) and phase 3 2 s (to 10 s): 14 s at most.
    const result = shiftCoordinatedGreen(standardEightPhase(), 'am-peak', 200)!;
    expect(result.applied).toBe(140);
    expect(result.splits).toMatchObject({ 2: 490, 3: 100, 4: 160, 6: 490, 7: 100, 8: 160 });
  });

  it('gives time back to the side street through phases, down to the coordinated minimums', () => {
    expect(shiftCoordinatedGreen(standardEightPhase(), 'am-peak', -50)!.splits).toMatchObject({ 2: 300, 4: 330, 6: 300, 8: 330 });
    expect(shiftCoordinatedGreen(standardEightPhase(), 'am-peak', -300)).toMatchObject({ applied: -190, splits: { 2: 160, 4: 470 } });
  });

  it('keeps coordinated green starting at the same time, converting an offset measured to its end', () => {
    const i = standardEightPhase();
    const pattern = i.patterns[0]!;
    pattern.offsetReference = 'beginCoordYellow';
    pattern.offset = 390; // green starts at 10 s: yellow at 10 + 29 = 39 s
    const result = shiftCoordinatedGreen(i, 'am-peak', 30)!;
    expect(result.offset).toBe(420);
    Object.assign(pattern, { splits: result.splits, offset: result.offset });
    // Phase 4 and 8 at 25 s no longer fit their pedestrian interval (a warning without recall), nothing worse.
    expect(validateIntersection(i).map((x) => x.code)).toEqual(['pattern.split-below-pedestrian', 'pattern.split-below-pedestrian']);
    const projection = projectCycle(i, 'am-peak');
    expect(projection.ok && convertOffset(projection.projection, 'beginCoordGreen')).toBe(100);
  });
});
