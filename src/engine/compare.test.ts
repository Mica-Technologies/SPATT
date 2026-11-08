import { describe, expect, it } from 'vitest';
import { leadLagEightPhase, newLaneGroup, standardEightPhase, twoPhase, type Intersection } from '../model';
import { comparePlans, matchIntersectionByName } from './compare';

const fieldOf = (result: ReturnType<typeof comparePlans>, phase: number, key: string) => result.phases.find((p) => p.phase === phase)!.fields.find((f) => f.key === key)!;

function withCount(intersection: Intersection): Intersection {
  intersection.laneGroups = intersection.phases.map((p) => newLaneGroup(`lg-${p.number}`, p));
  intersection.volumeSets = [
    {
      id: 'am',
      name: 'AM peak',
      peakHourFactor: 0.92,
      volumes: Object.fromEntries(intersection.laneGroups.map((g) => [g.id, { left: g.movements.left ? 120 : 0, through: g.movements.through ? 600 : 0, right: 0 }])),
    },
  ];
  for (const p of intersection.patterns) p.volumeSetId = 'am';
  return intersection;
}

describe('comparePlans', () => {
  it('finds nothing to report when a pattern is compared with itself', () => {
    const i = standardEightPhase();
    const result = comparePlans({ intersection: i, patternId: 'am-peak' }, { intersection: i, patternId: 'am-peak' });
    expect(result.changeCount).toBe(0);
    expect(result.phases).toHaveLength(8);
    expect(result.phases.every((p) => !p.changed)).toBe(true);
  });

  it('reports cycle, offset, coordinated phase and split differences between two patterns', () => {
    const i = standardEightPhase();
    const pm = structuredClone(i.patterns[0]!);
    pm.id = 'pm';
    pm.cycle = 1000;
    pm.offset = 150;
    pm.coordinatedPhases = [2];
    pm.splits['2'] = 450;
    pm.splits['6'] = 450;
    i.patterns.push(pm);
    const result = comparePlans({ intersection: i, patternId: 'am-peak' }, { intersection: i, patternId: 'pm' });
    const pattern = Object.fromEntries(result.pattern.map((f) => [f.key, f]));
    expect(pattern.cycle).toMatchObject({ a: 900, b: 1000, changed: true, delta: 100 });
    expect(pattern.offset).toMatchObject({ a: 0, b: 150, delta: 150 });
    expect(pattern.coordinatedPhases).toMatchObject({ a: '2, 6', b: '2', changed: true });
    expect(pattern.mode!.changed).toBe(false);
    expect(fieldOf(result, 2, 'split')).toMatchObject({ a: 350, b: 450, delta: 100, changed: true });
    expect(fieldOf(result, 4, 'split').changed).toBe(false);
    expect(result.changeCount).toBe(5);
  });

  it('reports phase timing, recall and pedestrian differences across projects', () => {
    const a = standardEightPhase();
    const b = standardEightPhase();
    const p4 = b.phases.find((p) => p.number === 4)!;
    p4.minGreen = 120;
    p4.passage = 25;
    p4.maxGreen1 = 350;
    p4.yellow = 45;
    p4.redClear = 25;
    p4.recall = 'minimum';
    p4.pedestrian.walk = 80;
    p4.pedestrian.clearance = 160;
    p4.pedestrian.recall = true;
    const result = comparePlans({ intersection: a, patternId: 'am-peak' }, { intersection: b, patternId: 'am-peak' });
    const phase4 = result.phases.find((p) => p.phase === 4)!;
    expect(phase4.changed).toBe(true);
    expect(phase4.fields.filter((f) => f.changed).map((f) => f.key)).toEqual(['minGreen', 'passage', 'maxGreen1', 'yellow', 'redClear', 'recall', 'walk', 'pedClear', 'pedRecall']);
    expect(fieldOf(result, 4, 'recall')).toMatchObject({ a: 'None', b: 'Min' });
    expect(fieldOf(result, 4, 'pedRecall')).toMatchObject({ a: false, b: true, delta: null });
    expect(result.phases.filter((p) => p.changed).map((p) => p.phase)).toEqual([4]);
  });

  it('reports a lead-lag swap in the phase order and per phase', () => {
    const a = standardEightPhase();
    const b = leadLagEightPhase();
    const result = comparePlans({ intersection: a, patternId: 'am-peak' }, { intersection: b, patternId: 'pm-peak-lead-lag' });
    expect(result.rings[0]).toMatchObject({ a: '1 2 | 3 4', b: '2 1 | 3 4', changed: true });
    expect(result.rings[1]!.changed).toBe(false);
    expect(fieldOf(result, 1, 'order')).toMatchObject({ a: 'Lead', b: 'Lag' });
    expect(fieldOf(result, 2, 'order')).toMatchObject({ a: 'Lag', b: 'Lead' });
  });

  it('lists phases on one side only and leaves their other side empty', () => {
    const a = standardEightPhase();
    const b = twoPhase();
    b.patterns[0]!.id = 'am-peak';
    const result = comparePlans({ intersection: a, patternId: 'am-peak' }, { intersection: b, patternId: 'am-peak' });
    const phase1 = result.phases.find((p) => p.phase === 1)!;
    expect(phase1).toMatchObject({ inA: true, inB: false, changed: true });
    expect(fieldOf(result, 1, 'minGreen')).toMatchObject({ a: 50, b: null, delta: null });
  });

  it('gives B’s offset against A’s reference when the references differ', () => {
    const i = standardEightPhase();
    const lag = structuredClone(i.patterns[0]!);
    lag.id = 'lag';
    lag.offsetReference = 'beginCoordYellow';
    lag.offset = 290; // the end of phase 2's 29 s green: the same timing as A's offset 0
    i.patterns.push(lag);
    const result = comparePlans({ intersection: i, patternId: 'am-peak' }, { intersection: i, patternId: 'lag' });
    const asA = result.pattern.find((f) => f.key === 'offsetAsA')!;
    expect(asA).toMatchObject({ a: 0, b: 0, changed: false });
    expect(result.pattern.find((f) => f.key === 'offsetReference')!.changed).toBe(true);
  });

  it('sets delay, v/c and LOS side by side when both patterns have a count', () => {
    const i = withCount(standardEightPhase());
    const longer = structuredClone(i.patterns[0]!);
    longer.id = 'longer';
    longer.cycle = 1100;
    longer.splits = { ...longer.splits, 2: 450, 6: 450, 4: 380, 8: 380 };
    i.patterns.push(longer);
    const result = comparePlans({ intersection: i, patternId: 'am-peak' }, { intersection: i, patternId: 'longer' });
    expect(result.capacity).not.toBeNull();
    expect(result.capacity!.countA).toBe('AM peak');
    expect(result.capacity!.laneGroups).toHaveLength(8);
    const thru = result.capacity!.laneGroups.find((g) => g.key === 'lg-2')!;
    expect(thru.a!.volumeToCapacity).toBeGreaterThan(thru.b!.volumeToCapacity!);
    expect(result.capacity!.overall.a!.delay).not.toBeNull();
    expect(result.capacity!.overall.b!.los).toMatch(/^[A-F]$/);
  });

  it('matches lane groups by phase and label across projects, and says why there is no analysis', () => {
    const a = withCount(standardEightPhase());
    const b = withCount(standardEightPhase());
    for (const g of b.laneGroups) g.id = `other-${g.id}`;
    b.volumeSets[0]!.volumes = Object.fromEntries(Object.entries(b.volumeSets[0]!.volumes).map(([k, v]) => [`other-${k}`, v]));
    const both = comparePlans({ intersection: a, patternId: 'am-peak' }, { intersection: b, patternId: 'am-peak' });
    expect(both.capacity!.laneGroups).toHaveLength(8);
    expect(both.capacity!.laneGroups.every((g) => g.a && g.b)).toBe(true);

    const none = comparePlans({ intersection: a, patternId: 'am-peak' }, { intersection: standardEightPhase(), patternId: 'am-peak' });
    expect(none.capacity).toBeNull();
    expect(none.capacityReasons).toEqual({ a: null, b: 'The pattern is not linked to a count.' });
  });
});

describe('matchIntersectionByName', () => {
  it('ignores case and spacing', () => {
    const list = [{ name: 'Elm St & 3rd Ave' }, { name: 'Main St  &  Side St' }];
    expect(matchIntersectionByName('main st & side st', list)).toBe(list[1]);
    expect(matchIntersectionByName('Oak', list)).toBeNull();
  });
});
