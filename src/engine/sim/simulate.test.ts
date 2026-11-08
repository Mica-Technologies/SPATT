import { describe, expect, it } from 'vitest';
import { newLaneGroup, setExclusions, standardEightPhase, twoPhase, type Intersection } from '../../model';
import { analyzePattern } from '../capacity';
import { NemaController } from './nema';
import { simulate, type SimulationSettings } from './simulate';

const settings = (patternId: string | null, more: Partial<SimulationSettings> = {}): SimulationSettings => ({ patternId, volumeSetId: 'am', durationSeconds: 3600, warmUpSeconds: 300, seed: 1, pedestrianCallsPerHour: {}, ...more });
const run = (i: Intersection, s: SimulationSettings) => simulate(i, s, new NemaController(i, { patternId: s.patternId }));

/** The two-phase template with the AM count from capacity.test.ts (EB 1000, SB 400, WB 800, NB 250 + 50 right). */
function counted(): Intersection {
  const i = twoPhase();
  const phase = (n: number) => i.phases.find((p) => p.number === n)!;
  i.laneGroups.push(
    { ...newLaneGroup('eb', phase(2)), lanes: 2, heavyVehiclesPercent: 0 },
    { ...newLaneGroup('sb', phase(4)), heavyVehiclesPercent: 0 },
    { ...newLaneGroup('wb', phase(6)), lanes: 2, heavyVehiclesPercent: 0 },
    { ...newLaneGroup('nb', phase(8)), movements: { left: false, through: true, right: true }, heavyVehiclesPercent: 0 },
  );
  i.volumeSets.push({ id: 'am', name: 'AM', peakHourFactor: 1, volumes: { eb: { left: 0, through: 1000, right: 0 }, sb: { left: 0, through: 400, right: 0 }, wb: { left: 0, through: 800, right: 0 }, nb: { left: 0, through: 250, right: 50 } } });
  i.patterns[0]!.volumeSetId = 'am';
  return i;
}

describe('NEMA controller without traffic', () => {
  it('runs free on minimum recall: every phase gaps out at its minimum green', () => {
    // Two-phase: 10 s minimum green + 4 s yellow + 2 s red, twice: 32 s.
    const i = twoPhase();
    for (const p of i.phases) p.recall = 'minimum';
    const result = run(i, settings(null));
    expect(result.cycle).toMatchObject({ mean: 32, min: 32, max: 32 });
    expect(result.phases.map((p) => [p.phase, p.green.mean, p.terminations['gap-out'] > 0, p.terminations['max-out']])).toEqual([
      [2, 10, true, 0],
      [4, 10, true, 0],
      [6, 10, true, 0],
      [8, 10, true, 0],
    ]);
  });

  it('runs free on maximum recall: every phase maxes out', () => {
    // Max 1: 35 s main street, 25 s side street; 35 + 6 + 25 + 6 = 72 s.
    const i = twoPhase();
    for (const p of i.phases) p.recall = 'maximum';
    const result = run(i, settings(null));
    expect(result.cycle.mean).toBe(72);
    expect(result.phases.map((p) => [p.green.mean, p.terminations['max-out'] > 0])).toEqual([
      [35, true],
      [25, true],
      [35, true],
      [25, true],
    ]);
  });

  it('holds the coordinated cycle: the side street gaps out early and its unused time goes back to the main street', () => {
    // 70 s: the coordinated phases yield 34 s after the start of their green; the side street, on
    // minimum recall, takes 10 s + 6 s, so the main street returns early and holds green for 48 s.
    const i = twoPhase();
    for (const n of [4, 8]) i.phases.find((p) => p.number === n)!.recall = 'minimum';
    const result = run(i, settings('all-day'));
    expect(result.cycle).toMatchObject({ mean: 70, min: 70, max: 70 });
    const byPhase = Object.fromEntries(result.phases.map((p) => [p.phase, p]));
    expect(byPhase[2]!.green).toMatchObject({ mean: 48, min: 48, max: 48 });
    expect(byPhase[2]!.terminations.yield).toBeGreaterThan(0);
    expect(byPhase[4]!.green.mean).toBe(10);
    expect(byPhase[4]!.servedShare).toBe(1);
  });

  it('forces off a side street that would run long, at its scheduled force-off', () => {
    // Side street on maximum recall (Max 1 25 s): forced off at its 24 s split green instead.
    const i = twoPhase();
    for (const n of [4, 8]) i.phases.find((p) => p.number === n)!.recall = 'maximum';
    const result = run(i, settings('all-day'));
    const side = result.phases.find((p) => p.phase === 4)!;
    expect(side.green.mean).toBe(24);
    expect(side.terminations['force-off']).toBe(side.green.count);
  });
});

describe('simulated traffic', () => {
  it('repeats exactly for a seed', () => {
    const a = run(counted(), settings('all-day', { seed: 5 }));
    const b = run(counted(), settings('all-day', { seed: 5 }));
    expect(a).toEqual(b);
  });

  it('matches HCM delay for pretimed operation, averaged over a few seeds', () => {
    // Every phase on maximum recall under the 70 s pattern runs pretimed: 34 s and 24 s of green.
    const i = counted();
    for (const p of i.phases) p.recall = 'maximum';
    const hcm = analyzePattern(i, 'all-day');
    if (!hcm.ok) throw new Error(hcm.reason);
    const seeds = [1, 2, 3, 4];
    const delays = seeds.map((seed) => run(i, settings('all-day', { seed })).meanDelay!);
    const mean = delays.reduce((a, b) => a + b, 0) / seeds.length;
    // HCM 15.9 s/veh; a point queue has no deceleration delay, so allow 10 %.
    expect(Math.abs(mean - hcm.delay!) / hcm.delay!).toBeLessThan(0.1);
    const first = run(i, settings('all-day', { seed: 1 }));
    expect(first.cycle.mean).toBe(70);
    for (const lane of first.laneGroups) expect(lane.finalQueue).toBeLessThan(25);
  });

  it('arrives at the counted rate and serves pedestrian calls', () => {
    const result = run(counted(), settings('all-day', { durationSeconds: 7200, pedestrianCallsPerHour: { 4: 30 } }));
    const eb = result.laneGroups.find((l) => l.laneGroupId === 'eb')!;
    // 2000 expected in two hours; a Poisson count within 4 standard deviations (±180).
    expect(Math.abs(eb.arrivals - 2000)).toBeLessThan(180);
    const side = result.phases.find((p) => p.phase === 4)!;
    expect(side.walks).toBeGreaterThan(20);
    // A phase serving a walk runs at least walk + pedestrian clearance (7 + 12 s).
    expect(side.green.max).toBeGreaterThanOrEqual(19);
    expect(result.trace.spans.some((s) => s.phase === 4 && s.signal === 'walk')).toBe(true);
    expect(result.trace.queues['eb']!.length).toBe(7500);
  });
});

describe('vehicle and pedestrian detail', () => {
  const detailed = (more: Partial<SimulationSettings> = {}) => settings('all-day', { durationSeconds: 1800, pedestrianCallsPerHour: { 4: 40 }, detail: { seconds: 2100, limit: 100_000 }, ...more });

  it('leaves the default trace and every statistic unchanged', () => {
    const plain = run(counted(), settings('all-day', { durationSeconds: 1800, pedestrianCallsPerHour: { 4: 40 } }));
    const withDetail = run(counted(), detailed());
    expect(plain.trace.vehicles).toBeUndefined();
    const { vehicles, pedestrians, detailUntil, ...trace } = withDetail.trace;
    expect(vehicles!.length).toBeGreaterThan(0);
    expect(pedestrians!.length).toBeGreaterThan(0);
    expect(detailUntil).toBe(withDetail.ticks);
    expect({ ...withDetail, trace }).toEqual(plain);
  });

  it('records every vehicle: departures after the warm-up equal those served, queues match', () => {
    const result = run(counted(), detailed());
    const vehicles = result.trace.vehicles!;
    for (const lane of result.laneGroups) {
      const mine = vehicles.filter((v) => v.laneGroupId === lane.laneGroupId);
      expect(mine.filter((v) => v.arrive >= result.warmUpTicks).length).toBe(lane.arrivals);
      expect(mine.filter((v) => v.arrive >= result.warmUpTicks && v.depart !== null).length).toBe(lane.departures);
      expect(mine.filter((v) => v.depart === null).length).toBe(lane.finalQueue);
      // Point queue: first come, first served, and never before arriving.
      const departed = mine.filter((v) => v.depart !== null);
      for (let k = 1; k < departed.length; k++) expect(departed[k]!.depart!).toBeGreaterThanOrEqual(departed[k - 1]!.depart!);
      for (const v of departed) expect(v.depart!).toBeGreaterThanOrEqual(v.arrive);
      // The sampled queue at second s is the vehicles arrived and not yet gone.
      const s = 900;
      const t = s * 20;
      expect(mine.filter((v) => v.arrive <= t && (v.depart === null || v.depart > t)).length).toBe(result.trace.queues[lane.laneGroupId]![s]);
    }
    // Movements follow the count: the north approach's 50 rights out of 300.
    const nb = vehicles.filter((v) => v.laneGroupId === 'nb');
    const rights = nb.filter((v) => v.movement === 'right').length / nb.length;
    expect(rights).toBeGreaterThan(0.08);
    expect(rights).toBeLessThan(0.26);
    expect(vehicles.filter((v) => v.laneGroupId === 'eb').every((v) => v.movement === 'through')).toBe(true);
  });

  it('serves every press with the next walk, and crosses by the end of its clearance', () => {
    const result = run(counted(), detailed());
    const walks = result.trace.spans.filter((s) => s.phase === 4 && s.signal === 'walk');
    const clearances = result.trace.spans.filter((s) => s.phase === 4 && s.signal === 'clearance');
    const served = result.trace.pedestrians!.filter((p) => p.start !== null);
    expect(served.length).toBeGreaterThan(5);
    for (const p of served) {
      expect(p.phase).toBe(4);
      expect(p.start!).toBeGreaterThanOrEqual(p.press);
      const walk = walks.find((w) => w.start <= p.start! && w.end > p.start!)!;
      expect(walk).toBeDefined();
      // Pressed during the walk, or waiting since before it.
      expect(p.press >= walk.start || p.start === walk.start).toBe(true);
      const clearance = clearances.find((c) => c.start === walk.end);
      expect(p.end).toBe(clearance ? clearance.end : walk.end);
    }
  });

  it('repeats exactly for a seed and differs for another', () => {
    const a = run(counted(), detailed({ seed: 3 }));
    expect(run(counted(), detailed({ seed: 3 })).trace).toEqual(a.trace);
    expect(run(counted(), detailed({ seed: 4 })).trace.vehicles).not.toEqual(a.trace.vehicles);
  });

  it('keeps to the window and the limit', () => {
    const windowed = run(counted(), detailed({ detail: { seconds: 120, limit: 100_000 } }));
    expect(windowed.trace.detailUntil).toBe(2400);
    expect(windowed.trace.vehicles!.every((v) => v.arrive < 2400)).toBe(true);
    expect(windowed.trace.pedestrians!.every((p) => p.press < 2400)).toBe(true);
    const capped = run(counted(), detailed({ detail: { seconds: 2100, limit: 50 } }));
    expect(capped.trace.vehicles).toHaveLength(50);
    expect(capped.trace.vehicles!.every((v) => v.arrive < capped.trace.detailUntil!)).toBe(true);
    expect(capped.trace.detailUntil!).toBeLessThan(capped.ticks);
  });
});

describe('NEMA controller with red+amber and green flash', () => {
  it('runs red+amber before each green and takes the green flash out of it', () => {
    // Two-phase on minimum recall: 2 s red+amber + 10 s green (its last 3 s flashing) + 4 + 2, twice.
    const i = twoPhase();
    for (const p of i.phases) p.recall = 'minimum';
    i.redAmber = 20;
    i.greenFlash = 30;
    const result = run(i, settings(null));
    expect(result.cycle).toMatchObject({ mean: 36, min: 36, max: 36 });
    expect(result.phases.every((p) => p.green.mean === 10)).toBe(true);
  });

  it('still holds the coordinated cycle, with the force-off and yield moved for the flash', () => {
    const i = twoPhase();
    for (const n of [4, 8]) i.phases.find((p) => p.number === n)!.recall = 'minimum';
    i.redAmber = 20;
    i.greenFlash = 30;
    expect(run(i, settings('all-day')).cycle).toMatchObject({ mean: 70, min: 70, max: 70 });
  });
});

describe('NEMA controller with phase exclusions', () => {
  /** Every phase called, free, for `ticks`: whether 1 and 5 were each served, and ever up together. */
  function lefts(i: Intersection, ticks = 8000) {
    const controller = new NemaController(i, { patternId: null });
    const all = new Set(i.phases.map((p) => p.number));
    const up = (n: number) => controller.signal(n).vehicle !== 'red';
    let served1 = false;
    let served5 = false;
    let together = false;
    for (let t = 0; t < ticks; t++) {
      controller.step({ tick: t, presence: all, actuations: new Set(), pedestrianPresses: new Set() });
      served1 ||= up(1);
      served5 ||= up(5);
      together ||= up(1) && up(5);
    }
    return { served1, served5, together };
  }

  it('runs the two lefts together without an exclusion, as the rings allow', () => {
    expect(lefts(standardEightPhase()).together).toBe(true);
  });

  it('keeps excluded lefts apart, on either side of the pair, and still serves both', () => {
    for (const lister of [1, 5]) {
      const i = standardEightPhase();
      i.phases.find((p) => p.number === lister)!.exclusions = [lister === 1 ? 5 : 1];
      expect(lefts(i)).toEqual({ served1: true, served5: true, together: false });
    }
  });

  it('keeps them apart with a lead-lag order too', () => {
    const i = standardEightPhase();
    setExclusions(i, 1, [5]);
    i.rings[1]!.groups[0] = [6, 5];
    expect(lefts(i)).toEqual({ served1: true, served5: true, together: false });
  });
});
