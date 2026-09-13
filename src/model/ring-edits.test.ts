import { describe, expect, it } from 'vitest';
import { addPhase } from './edits';
import {
  addBarrierGroup,
  addRing,
  barrierGroupCount,
  indexAfterRemoval,
  locatePhase,
  movePhase,
  reconcileSequences,
  removeBarrierGroup,
  removeRing,
  sameRingMembership,
  unassignedPhases,
  unassignPhase,
} from './ring-edits';
import { MAX_RINGS } from './schema';
import { leadLagEightPhase, splitPhaseSideStreet, standardEightPhase, twoPhase } from './templates';
import { validateIntersection } from './validate';

const groups = (intersection: { rings: { groups: number[][] }[] }) => intersection.rings.map((ring) => ring.groups);
const structureCodes = (intersection: Parameters<typeof validateIntersection>[0]) =>
  validateIntersection(intersection)
    .map((i) => i.code)
    .filter((c) => c.startsWith('ring.') || c.startsWith('barrier.') || c === 'pattern.sequence-membership');

describe('ring queries', () => {
  it('locates a phase', () => {
    const intersection = standardEightPhase();
    expect(locatePhase(intersection.rings, 7)).toEqual({ ring: 1, group: 1, index: 0 });
    expect(locatePhase(intersection.rings, 9)).toBeNull();
  });

  it('lists defined phases that are in no ring', () => {
    const intersection = twoPhase();
    expect(unassignedPhases(intersection)).toEqual([]);
    addPhase(intersection, 5);
    addPhase(intersection, 1);
    expect(unassignedPhases(intersection)).toEqual([1, 5]);
  });

  it('ignores ring entries for undefined phases', () => {
    const intersection = twoPhase();
    intersection.rings[0]!.groups[0]!.push(9);
    expect(unassignedPhases(intersection)).toEqual([]);
  });

  it('counts barrier groups by the largest ring', () => {
    expect(barrierGroupCount(splitPhaseSideStreet().rings)).toBe(3);
    expect(barrierGroupCount([{ groups: [[1]] }, { groups: [[2], [3]] }])).toBe(2);
    expect(barrierGroupCount([])).toBe(0);
  });

  it('compares membership regardless of order within a group', () => {
    const base = standardEightPhase().rings;
    expect(sameRingMembership(leadLagEightPhase().patterns[0]!.sequence!, base)).toBe(true);
    expect(sameRingMembership([{ groups: [[1, 2], [3, 4]] }], base)).toBe(false);
    expect(sameRingMembership([{ groups: [[1, 2], [3]] }, { groups: [[5, 6], [7, 8, 4]] }], base)).toBe(false);
    expect(sameRingMembership([{ groups: [[1, 2]] }, { groups: [[5, 6]] }], base)).toBe(false);
  });
});

describe('indexAfterRemoval', () => {
  const rings = standardEightPhase().rings;

  it('shifts back when the phase is earlier in the same group', () => {
    // Dropping 1 after 2 in [1, 2]: position 2 before removal is 1 after.
    expect(indexAfterRemoval(rings, 1, 0, 0, 2)).toBe(1);
  });

  it('keeps the position when the phase is later, elsewhere or unplaced', () => {
    expect(indexAfterRemoval(rings, 2, 0, 0, 0)).toBe(0);
    expect(indexAfterRemoval(rings, 5, 0, 0, 1)).toBe(1);
    expect(indexAfterRemoval(rings, 9, 0, 0, 2)).toBe(2);
  });
});

describe('movePhase', () => {
  it('reorders within a group and keeps pattern sequences', () => {
    const intersection = leadLagEightPhase();
    const reset = movePhase(intersection, 1, 0, 0, 1);
    expect(groups(intersection)[0]).toEqual([[2, 1], [3, 4]]);
    expect(reset).toEqual([]);
    expect(intersection.patterns[0]!.sequence).not.toBeNull();
  });

  it('moves a phase to another ring and group and resets affected sequences', () => {
    const intersection = leadLagEightPhase();
    const other = structuredClone(intersection.patterns[0]!);
    other.id = 'no-sequence';
    other.sequence = null;
    intersection.patterns.push(other);

    const reset = movePhase(intersection, 1, 1, 1, 0);
    expect(groups(intersection)).toEqual([
      [[2], [3, 4]],
      [[5, 6], [1, 7, 8]],
    ]);
    expect(reset).toEqual(['pm-peak-lead-lag']);
    expect(intersection.patterns[0]!.sequence).toBeNull();
    expect(intersection.patterns[1]!.sequence).toBeNull();
    expect(structureCodes(intersection)).toEqual([]);
  });

  it('places an unassigned phase and clamps the index', () => {
    const intersection = twoPhase();
    addPhase(intersection, 1);
    movePhase(intersection, 1, 0, 0, 99);
    expect(groups(intersection)[0]![0]).toEqual([2, 1]);
    movePhase(intersection, 1, 0, 0, -3);
    expect(groups(intersection)[0]![0]).toEqual([1, 2]);
    expect(unassignedPhases(intersection)).toEqual([]);
  });

  it('removes repeated occurrences of the phase', () => {
    const intersection = twoPhase();
    intersection.rings[1]!.groups[1]!.push(2);
    expect(structureCodes(intersection)).toContain('ring.phase-repeated');
    movePhase(intersection, 2, 0, 1, 0);
    expect(groups(intersection)).toEqual([
      [[], [2, 4]],
      [[6], [8]],
    ]);
    expect(structureCodes(intersection)).not.toContain('ring.phase-repeated');
  });

  it('equalizes ragged rings before moving', () => {
    const intersection = twoPhase();
    intersection.rings[1]!.groups = [[6]];
    movePhase(intersection, 8, 1, 1, 0);
    expect(groups(intersection)[1]).toEqual([[6], [8]]);
  });

  it('rejects undefined phases and missing cells', () => {
    const intersection = twoPhase();
    expect(() => movePhase(intersection, 9, 0, 0, 0)).toThrow();
    expect(() => movePhase(intersection, 2, 2, 0, 0)).toThrow();
    expect(() => movePhase(intersection, 2, 0, 5, 0)).toThrow();
    expect(groups(intersection)).toEqual(groups(twoPhase()));
  });
});

describe('unassignPhase', () => {
  it('takes a phase out of every ring and resets sequences that listed it', () => {
    const intersection = leadLagEightPhase();
    const reset = unassignPhase(intersection, 2);
    expect(groups(intersection)[0]).toEqual([[1], [3, 4]]);
    expect(unassignedPhases(intersection)).toEqual([2]);
    expect(reset).toEqual(['pm-peak-lead-lag']);
    expect(structureCodes(intersection)).toEqual(['ring.phase-unassigned']);
  });

  it('removes undefined phases too', () => {
    const intersection = twoPhase();
    intersection.rings[0]!.groups[0]!.push(12);
    unassignPhase(intersection, 12);
    expect(groups(intersection)[0]).toEqual([[2], [4]]);
  });
});

describe('rings', () => {
  it('adds an empty ring with matching groups, up to the maximum', () => {
    const intersection = splitPhaseSideStreet();
    addRing(intersection);
    expect(groups(intersection)[2]).toEqual([[], [], []]);
    addRing(intersection);
    expect(intersection.rings).toHaveLength(MAX_RINGS);
    expect(() => addRing(intersection)).toThrow();
  });

  it('resets sequences when the ring count changes', () => {
    const intersection = leadLagEightPhase();
    expect(addRing(intersection)).toEqual(['pm-peak-lead-lag']);
    expect(intersection.patterns[0]!.sequence).toBeNull();
    expect(structureCodes(intersection)).toEqual([]);
  });

  it('gives a ring to a structure with no groups one group', () => {
    const intersection = twoPhase();
    intersection.rings = [{ groups: [] }];
    addRing(intersection);
    expect(groups(intersection)).toEqual([[[]], [[]]]);
  });

  it('removes a ring and leaves its phases unassigned', () => {
    const intersection = leadLagEightPhase();
    const reset = removeRing(intersection, 0);
    expect(groups(intersection)).toEqual([[[5, 6], [7, 8]]]);
    expect(unassignedPhases(intersection)).toEqual([1, 2, 3, 4]);
    expect(reset).toEqual(['pm-peak-lead-lag']);
  });

  it('keeps at least one ring', () => {
    const intersection = twoPhase();
    removeRing(intersection, 1);
    expect(() => removeRing(intersection, 0)).toThrow();
    expect(() => removeRing(twoPhase(), 4)).toThrow();
  });
});

describe('barrier groups', () => {
  it('appends an empty group to every ring', () => {
    const intersection = leadLagEightPhase();
    const reset = addBarrierGroup(intersection);
    expect(groups(intersection)).toEqual([
      [[1, 2], [3, 4], []],
      [[5, 6], [7, 8], []],
    ]);
    expect(reset).toEqual(['pm-peak-lead-lag']);
    expect(structureCodes(intersection)).toEqual(['barrier.empty-group']);
  });

  it('pads ragged rings before appending', () => {
    const intersection = twoPhase();
    intersection.rings[1]!.groups = [[6, 8]];
    expect(structureCodes(intersection)).toContain('barrier.group-count-mismatch');
    addBarrierGroup(intersection);
    expect(groups(intersection)).toEqual([
      [[2], [4], []],
      [[6, 8], [], []],
    ]);
  });

  it('removes a group from every ring and leaves its phases unassigned', () => {
    const intersection = splitPhaseSideStreet();
    const reset = removeBarrierGroup(intersection, 1);
    expect(groups(intersection)).toEqual([
      [[1, 2], [8]],
      [[5, 6], []],
    ]);
    expect(unassignedPhases(intersection)).toEqual([4]);
    expect(reset).toEqual([]);
  });

  it('keeps at least one group and rejects missing ones', () => {
    const intersection = twoPhase();
    expect(() => removeBarrierGroup(intersection, 2)).toThrow();
    removeBarrierGroup(intersection, 1);
    expect(() => removeBarrierGroup(intersection, 0)).toThrow();
  });
});

describe('reconcileSequences', () => {
  it('only resets sequences that no longer match', () => {
    const intersection = leadLagEightPhase();
    expect(reconcileSequences(intersection)).toEqual([]);
    intersection.rings[0]!.groups[0] = [1];
    expect(reconcileSequences(intersection)).toEqual(['pm-peak-lead-lag']);
    expect(intersection.patterns[0]!.sequence).toBeNull();
  });
});
