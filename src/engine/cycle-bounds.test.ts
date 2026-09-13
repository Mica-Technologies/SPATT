import { describe, expect, it } from 'vitest';
import { splitPhaseSideStreet, standardEightPhase } from '../model';
import { cycleBounds } from './cycle-bounds';

describe('cycleBounds', () => {
  it('computes minimum, pedestrian and maximum cycles for the split-phase intersection', () => {
    // Worked by hand (s):
    //   Phase 1: min 5 + 3.5 + 1.5 = 10; max 20 + 5 = 25; no pedestrians
    //   Phase 2: min 10 + 4 + 2 = 16; with pedestrians max(10, 7 + 18) + 6 = 31; max 40 + 6 = 46
    //   Phases 4, 8: min 16; with pedestrians max(10, 7 + 14) + 6 = 27; max 25 + 6 = 31
    //   Group 1 (both rings 1 + 2 / 5 + 6): min 26, peds 41, max 71; groups 2 and 3 ring 1 only.
    const bounds = cycleBounds(splitPhaseSideStreet());
    expect(bounds.minimum.groups.map((g) => g.rings)).toEqual([[260, 260], [160, 0], [160, 0]]);
    expect(bounds.minimum.cycle).toBe(580);
    expect(bounds.minimumWithPedestrians.cycle).toBe(950);
    expect(bounds.maximum.cycle).toBe(1330);
  });

  it('holds a barrier group for its slowest ring', () => {
    const intersection = standardEightPhase();
    intersection.phases.find((p) => p.number === 5)!.minGreen = 80; // ring 2 group 1: 13 + 16 = 29 s
    const group = cycleBounds(intersection).minimum.groups[0]!;
    expect(group.rings).toEqual([260, 290]);
    expect(group.total).toBe(290);
  });

  it('uses Max 2 where programmed when asked', () => {
    const intersection = standardEightPhase();
    intersection.phases.find((p) => p.number === 2)!.maxGreen2 = 600; // +20 s over Max 1 in ring 1
    expect(cycleBounds(intersection, true).maximum.cycle - cycleBounds(intersection).maximum.cycle).toBe(200);
  });

  it('ignores disabled phases', () => {
    const intersection = standardEightPhase();
    for (const n of [3, 7]) intersection.phases.find((p) => p.number === n)!.enabled = false;
    expect(cycleBounds(intersection).minimum.groups[1]!.rings).toEqual([160, 160]);
  });
});
