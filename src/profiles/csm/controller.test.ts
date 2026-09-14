import { describe, expect, it } from 'vitest';
import { NemaController, simulate, type SimulationSettings } from '../../engine';
import { newLaneGroup, standardEightPhase, twoPhase, type Intersection } from '../../model';
import { csmControllerFor, effectivePassage } from './controller';

const settings = (patternId: string | null, more: Partial<SimulationSettings> = {}): SimulationSettings => ({ patternId, volumeSetId: 'am', durationSeconds: 3600, warmUpSeconds: 300, seed: 1, pedestrianCallsPerHour: {}, ...more });

function csm(i: Intersection, patternId: string | null) {
  const result = csmControllerFor(i, patternId);
  if (!result.ok) throw new Error(result.message);
  return result.controller;
}

/** Every vehicle phase with its own lane group: 100 veh/h of lefts, 500 veh/h through. */
function counted(i: Intersection): Intersection {
  for (const p of i.phases) if (p.movement.kind !== 'pedestrian') i.laneGroups.push({ ...newLaneGroup(`g${p.number}`, p), heavyVehiclesPercent: 0 });
  i.volumeSets.push({ id: 'am', name: 'AM', peakHourFactor: 1, volumes: Object.fromEntries(i.laneGroups.map((g) => [g.id, { left: g.movements.left ? 100 : 0, through: g.movements.through ? 500 : 0, right: 0 }])) });
  return i;
}

describe('effectivePassage', () => {
  it('reduces the passage linearly with truncating integer division', () => {
    // Passage 60, minimum gap 20, reduction from 100 ticks over 50: (40 × 25) / 50 = 20 → 40; (40 × 37) / 50 = 29.6 → 29 → 31.
    expect([0, 100, 125, 137, 150, 400].map((t) => effectivePassage(60, 20, 100, 50, t))).toEqual([60, 60, 40, 31, 20, 20]);
    expect(effectivePassage(60, 0, 100, 50, 400)).toBe(60);
  });
});

describe('CSM ASC-3 controller', () => {
  it('runs free on minimum recall like any controller: 32 s for two phases', () => {
    const i = twoPhase();
    for (const p of i.phases) p.recall = 'minimum';
    const result = simulate(i, settings(null), csm(i, null));
    expect(result.cycle).toMatchObject({ mean: 32, min: 32, max: 32 });
    expect(result.phases.every((p) => p.green.mean === 10)).toBe(true);
  });

  it('treats maximum recall as minimum recall, as the mod does', () => {
    const i = twoPhase();
    for (const p of i.phases) p.recall = 'maximum';
    expect(simulate(i, settings(null), csm(i, null)).cycle.mean).toBe(32);
    expect(simulate(i, settings(null), new NemaController(i, { patternId: null })).cycle.mean).toBe(72);
  });

  it('holds the 90 s background cycle, returning to the main street between a short left and its through', () => {
    // Every side phase on minimum recall, no traffic. The side-street lefts (3, 7) gap out at their
    // 5 s minimum before the throughs' (4, 8) windows open, so their calls are not yet accepted and
    // the rings go back to 2 and 6 for their 10 s minimum green, which then yield early for the
    // opening window. Every phase is still served once in each 90 s cycle.
    const i = standardEightPhase();
    for (const p of i.phases) if (![2, 6].includes(p.number)) p.recall = 'minimum';
    const result = simulate(i, settings('am-peak'), csm(i, 'am-peak'));
    const starts = (n: number) => result.trace.spans.filter((s) => s.phase === n && s.signal === 'green' && s.start >= result.warmUpTicks).map((s) => s.start);
    for (const n of [1, 3, 4, 5, 7, 8]) {
      const gaps = starts(n).slice(1).map((t, k) => t - starts(n)[k]!);
      expect(new Set(gaps)).toEqual(new Set([1800]));
    }
    const main = result.phases.find((p) => p.phase === 2)!;
    expect([main.green.min, main.green.max]).toEqual([10, 32]);
    expect(main.terminations.yield).toBe(2 * starts(4).length);
  });

  it('returns to the main street when a side through phase has no accepted call as its barrier starts', () => {
    // A left turn that gaps out before the side-street through's window opens leaves its barrier
    // with no accepted call, so the rings go back to the coordinated phases, which yield again when
    // the window opens: extra, short main-street greens that the NEMA controller does not have.
    const i = counted(standardEightPhase());
    const csmRun = simulate(i, settings('am-peak'), csm(i, 'am-peak'));
    const nemaRun = simulate(i, settings('am-peak'), new NemaController(i, { patternId: 'am-peak' }));
    expect(nemaRun.cycle).toMatchObject({ min: 90, max: 90 });
    expect(csmRun.cycle.min!).toBeLessThan(90);
    expect(csmRun.phases.find((p) => p.phase === 2)!.green.min!).toBeLessThan(nemaRun.phases.find((p) => p.phase === 2)!.green.min!);
  });

  it('explains a plan the controller cannot run', () => {
    const i = standardEightPhase();
    i.phases.push({ ...structuredClone(i.phases[0]!), number: 9, label: 'Extra' });
    i.rings[0]!.groups[0]!.push(9);
    const result = csmControllerFor(i, 'am-peak');
    expect(result.ok).toBe(false);
  });
});
