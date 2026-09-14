import { describe, expect, it } from 'vitest';
import { newLaneGroup } from './capacity';
import { addPhase, nextPhaseNumber, randomId, removePhase, uniqueName } from './edits';
import { leadLagEightPhase, standardEightPhase, twoPhase } from './templates';
import { validateIntersection } from './validate';

describe('phase edits', () => {
  it('finds the lowest free phase number', () => {
    expect(nextPhaseNumber(twoPhase())).toBe(1);
    expect(nextPhaseNumber(standardEightPhase())).toBe(9);
  });

  it('adds a phase in number order', () => {
    const intersection = twoPhase();
    addPhase(intersection, 3);
    expect(intersection.phases.map((p) => p.number)).toEqual([2, 3, 4, 6, 8]);
    expect(intersection.phases[1]!.movement.kind).toBe('left');
    expect(() => addPhase(intersection, 3)).toThrow();
  });

  it('removes a phase and every reference to it', () => {
    const intersection = leadLagEightPhase();
    intersection.overlaps.push({ id: 'A', label: '', enabled: true, type: 'normal', includedPhases: [1, 2], modifierPhases: [1], trailGreen: 0, trailYellow: 0, trailRedClear: 0 });
    intersection.preempts.push({ number: 1, label: '', enabled: true, kind: 'railroad', trackClearancePhases: [1], trackClearance: 0, dwellPhases: [1, 2], minDwell: 0, exitPhases: [1] });
    intersection.laneGroups.push(newLaneGroup('l1', intersection.phases[0]!), newLaneGroup('t2', intersection.phases[1]!));
    intersection.volumeSets.push({ id: 'am', name: 'AM', peakHourFactor: 1, volumes: { l1: { left: 100, through: 0, right: 0 }, t2: { left: 0, through: 500, right: 0 } } });
    removePhase(intersection, 1);

    const pattern = intersection.patterns[0]!;
    expect(intersection.phases.map((p) => p.number)).not.toContain(1);
    expect(intersection.rings[0]!.groups[0]).toEqual([2]);
    expect(pattern.sequence![0]!.groups[0]).toEqual([2]);
    expect(pattern.splits['1']).toBeUndefined();
    expect(intersection.overlaps[0]).toMatchObject({ includedPhases: [2], modifierPhases: [] });
    expect(intersection.preempts[0]).toMatchObject({ trackClearancePhases: [], dwellPhases: [2], exitPhases: [] });
    expect(intersection.laneGroups.map((g) => g.id)).toEqual(['t2']);
    expect(Object.keys(intersection.volumeSets[0]!.volumes)).toEqual(['t2']);
    // The only problems left are timing ones (barrier group 1 is now unbalanced), not dangling references.
    expect(validateIntersection(intersection).map((i) => i.code).filter((c) => c.includes('unknown'))).toEqual([]);
  });

  it('removes a coordinated phase from the pattern', () => {
    const intersection = standardEightPhase();
    removePhase(intersection, 6);
    expect(intersection.patterns[0]!.coordinatedPhases).toEqual([2]);
  });
});

describe('names and ids', () => {
  it('makes a unique name', () => {
    expect(uniqueName('Main', [])).toBe('Main');
    expect(uniqueName('Main', ['Main', 'Main (2)'])).toBe('Main (3)');
  });

  it('makes a prefixed id', () => {
    expect(randomId('i', () => 'ABCDEF12-3456')).toBe('i-abcdef12');
  });
});
