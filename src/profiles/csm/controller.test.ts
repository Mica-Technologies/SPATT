import { describe, expect, it } from 'vitest';
import { NemaController, simulate, type SimulationSettings } from '../../engine';
import { newLaneGroup, standardEightPhase, twoPhase, type Intersection } from '../../model';
import { CsmController, csmControllerFor, effectivePassage } from './controller';
import { CSM_FORMAT, CSM_FORMAT_VERSION, type CsmPattern, type CsmPhase, type CsmPlan } from './format';

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

const csmPhase = (number: number, barrier: number, more: Partial<CsmPhase> = {}): CsmPhase => ({
  number, enabled: true, barrier,
  minGreen: 100, passage: 40, maxGreen: 1200, maxGreen2: 0, yellow: 80, redClear: 40,
  addedInitial: 0, maxInitial: 0, minGap: 0, timeBeforeReduce: 0, timeToReduce: 0,
  recall: 'NONE', pedRecall: false, restInWalk: false, dualEntry: false, conditionalService: false, lockCall: false,
  ...more,
});

const csmPlan = (phases: CsmPhase[], rings: [number[], number[]], pattern: Partial<CsmPattern> = {}): CsmPlan => ({
  format: CSM_FORMAT, formatVersion: CSM_FORMAT_VERSION,
  phases,
  rings,
  patterns: [{ slot: 0, mode: 'FREE', cycle: 1800, offset: 0, coordinatedPhases: [], splits: {}, ...pattern }],
  schedule: { enabled: false, startHours: [0, 0, 0, 0] },
});

/** The Z01 and T03 T junctions of CoordinatedDualEntryFreezeReproTest: every phase on MAX recall. */
function tJunction(withLag7: boolean, splits: Record<string, number>): CsmPlan {
  const max = (n: number, barrier: number, dualEntry: boolean, minGreen: number, pedRecall: boolean, more: Partial<CsmPhase> = {}) =>
    csmPhase(n, barrier, { recall: 'MAXIMUM', dualEntry, minGreen, pedRecall, delayedGreen: 60, maxGreen: 1200, yellow: 80, redClear: 40, ...more });
  const phases = [
    csmPhase(1, 0, { enabled: false }),
    csmPhase(2, 0, { enabled: false }),
    max(3, 1, false, 100, false, { walk: 140, pedClear: 220, passage: 40, movement: 'PROTECTED_LEFT' }),
    max(4, 1, true, 140, true),
    csmPhase(5, 0, { enabled: false }),
    max(6, 0, true, 200, true),
    withLag7 ? max(7, 1, false, 100, false, { movement: 'PROTECTED_LEFT' }) : csmPhase(7, 1, { enabled: false }),
    max(8, 1, true, 140, true),
  ];
  return csmPlan(phases, [[1, 2, 3, 4], [6, 5, 8, 7]], { mode: 'COORDINATED', cycle: 1800, offset: 457, coordinatedPhases: [4, 8], splits });
}
const z01 = () => tJunction(true, { 2: 800, 3: 240, 4: 760, 6: 800, 7: 240, 8: 760 });
const t03 = () => tJunction(false, { 3: 240, 4: 760, 6: 800, 8: 1000 });

/** The longest single green of any phase, in ticks, with no detector demand. */
function longestGreen(controller: CsmController, t0: number, ticks: number): number {
  const since = new Map<number, number>();
  let worst = 0;
  for (let t = t0; t <= t0 + ticks; t++) {
    controller.step({ tick: t, presence: new Set(), actuations: new Set(), pedestrianPresses: new Set() });
    for (const n of [1, 2, 3, 4, 5, 6, 7, 8]) {
      if (controller.signal(n).vehicle !== 'green') since.delete(n);
      else {
        if (!since.has(n)) since.set(n, t);
        worst = Math.max(worst, t - since.get(n)!);
      }
    }
  }
  return worst;
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

  it('runs maximum recall to max green against a waiting phase, as the NEMA controller does', () => {
    // RingBarrierStateTest.maxRecallRunsToMax: the green extends on its own recall. The max timer
    // starts on the first engine run that sees the waiting call, one run (0.1 s) after the green.
    const i = twoPhase();
    for (const p of i.phases) p.recall = 'maximum';
    const result = simulate(i, settings(null), csm(i, null));
    expect(result.phases.map((p) => [p.phase, Math.round(p.green.mean!), p.terminations['max-out'] > 0, p.terminations['gap-out']])).toEqual([
      [2, 35, true, 0],
      [4, 25, true, 0],
      [6, 35, true, 0],
      [8, 25, true, 0],
    ]);
    expect(result.cycle.mean!).toBeCloseTo(simulate(i, settings(null), new NemaController(i, { patternId: null })).cycle.mean!, 0);
  });

  it('never holds a dual-entry coordinated phase on maximum recall green for good', () => {
    // CoordinatedDualEntryFreezeReproTest (CSM issue #275, plan Z01): with every phase on MAX
    // recall, a coordinated phase dual-entered beside a lag left could not end once the left cleared.
    for (let t0 = 0; t0 < 1800; t0 += 46) {
      const longest = longestGreen(new CsmController(z01()), t0, 1800 * 6);
      expect(longest, `cold start at tick ${t0}`).toBeLessThan(1800 * 2);
    }
  });

  it('serves the left a coordinated green yielded for, even while another barrier calls', () => {
    // CoordinatedDualEntryFreezeReproTest T03: phase 4 yields for lead left 3, which sits behind it
    // in ring 1; the ring wraps to 3 rather than sitting dark beside 8.
    for (let t0 = 0; t0 < 1800; t0 += 46) {
      const controller = new CsmController(t03());
      let dark = 0;
      let worst = 0;
      for (let t = t0; t <= t0 + 1800 * 6; t++) {
        controller.step({ tick: t, presence: new Set(), actuations: new Set(), pedestrianPresses: new Set() });
        const up = (n: number) => controller.signal(n).vehicle !== 'red';
        const ring1Dark = ![3, 4].some(up);
        dark = ring1Dark && controller.signal(8).vehicle === 'green' ? dark + 1 : 0;
        worst = Math.max(worst, dark);
      }
      // Before the fix ring 1 sat dark for 879 ticks beside 8, until its yield point.
      expect(worst, `cold start at tick ${t0}`).toBeLessThan(600);
    }
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
