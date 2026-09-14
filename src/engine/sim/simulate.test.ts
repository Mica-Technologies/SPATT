import { describe, expect, it } from 'vitest';
import { newLaneGroup, twoPhase, type Intersection } from '../../model';
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
