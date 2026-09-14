import { describe, expect, it } from 'vitest';
import { emptyProject, newCorridorPlan, newCorridorStop, standardEightPhase, twoPhase, type Project } from '../model';
import { analyzeProgression } from './progression';
import { evaluate, leadLagOrders, optimizeOffsets, prepareOptimization } from './optimize';

/** Stops 300 m apart at 10 m/s (30 s of travel), each two-phase: 70 s cycle, 34 s of green. */
function corridor(count: number): Project {
  const project = emptyProject('Opt', 'p-opt', new Date('2026-09-14T00:00:00.000Z'));
  const intersections = Array.from({ length: count }, (_, k) => {
    const i = twoPhase(`s${k}`);
    i.name = `S${k}`;
    return i;
  });
  project.intersections.push(...intersections);
  const stops = intersections.map((i, k) => newCorridorStop(i, 'E', k === 0));
  stops.slice(1).forEach((s) => {
    s.distance = 300;
    s.speed = { outbound: 10, inbound: 10 };
  });
  project.corridors.push({ id: 'c', name: 'C', outbound: 'E', stops, plans: [newCorridorPlan('plan', 'Plan', intersections)] });
  return project;
}

const prepare = (project: Project) => {
  const prepared = prepareOptimization(project, project.corridors[0]!, project.corridors[0]!.plans[0]!);
  if (!prepared.ok) throw new Error(prepared.reason);
  return prepared;
};

describe('prepareOptimization', () => {
  it('matches analyzeProgression for any offsets', () => {
    const project = corridor(3);
    const prepared = prepare(project);
    const plan = project.corridors[0]!.plans[0]!;
    for (const offsets of [[0, 300, 600], [0, 150, 420], [100, 0, 690]]) {
      const expected = analyzeProgression(project, project.corridors[0]!, plan, { s0: offsets[0]!, s1: offsets[1]!, s2: offsets[2]! }).bands;
      expect(evaluate(prepared, offsets, 'weighted').bandwidth).toEqual({ outbound: expected.outbound.bandwidth, inbound: expected.inbound.bandwidth });
    }
  });

  it('explains when there is nothing to optimize', () => {
    const project = corridor(2);
    project.corridors[0]!.plans[0]!.patterns['s1'] = null;
    expect(prepareOptimization(project, project.corridors[0]!, project.corridors[0]!.plans[0]!)).toEqual({ ok: false, reason: 'too-few-intersections' });
  });
});

describe('optimizeOffsets', () => {
  // Two stops, B's offset o (s): outbound band = 34 − |o − 30|, inbound = 34 − |o − 40|
  // (inbound needs B's green to start 30 s before A's, i.e. at −30 ≡ 40 s). Between 30 and 40 the
  // sum is a constant 58 s; the balanced optimum is 35 s, with 29 s each way.
  it('finds the best offsets exhaustively (hand-worked two-stop case)', () => {
    const prepared = prepare(corridor(2));
    const weighted = optimizeOffsets(prepared, { objective: 'weighted' });
    expect(weighted.method).toBe('exhaustive');
    expect(weighted.bandwidth.outbound + weighted.bandwidth.inbound).toBe(580);
    // Ties in the sum go to the most even bands: 35 s.
    expect(weighted.offsets).toEqual([0, 350]);
    expect(weighted.current.bandwidth).toEqual({ outbound: 40, inbound: 40 });
    expect(weighted.evaluations).toBe(71);

    const balanced = optimizeOffsets(prepared, { objective: 'balanced' });
    expect(balanced).toMatchObject({ offsets: [0, 350], bandwidth: { outbound: 290, inbound: 290 } });
  });

  it('follows the direction weights', () => {
    const project = corridor(2);
    project.corridors[0]!.plans[0]!.weights = { outbound: 2, inbound: 1 };
    // 2(34 − |o − 30|) + (34 − |o − 40|) peaks at o = 30: 68 + 24.
    expect(optimizeOffsets(prepare(project), { objective: 'weighted' })).toMatchObject({ offsets: [0, 300], bandwidth: { outbound: 340, inbound: 240 } });
  });

  it('searches larger corridors by coordinate descent and never does worse than the current offsets', () => {
    const project = corridor(6);
    const prepared = prepare(project);
    const result = optimizeOffsets(prepared, { objective: 'weighted', restarts: 6, seed: 7 });
    expect(result.method).toBe('coordinate-descent');
    expect(result.score).toBeGreaterThanOrEqual(result.current.score);
    // A progression at 30 s per link exists outbound (offsets 0, 30, 60, 90 ≡ 20, 50 s): it is found.
    expect(result.bandwidth.outbound + result.bandwidth.inbound).toBeGreaterThanOrEqual(evaluate(prepared, [0, 300, 600, 200, 500, 100], 'weighted').bandwidth.outbound);
    expect(optimizeOffsets(prepared, { objective: 'weighted', restarts: 6, seed: 7 }).offsets).toEqual(result.offsets);
  });
});

describe('lead/lag search', () => {
  /** Two standard eight-phase intersections 300 m apart at 10 m/s (30 s), EB on phase 2, WB on 6, 90 s. */
  function eightPhaseCorridor(): Project {
    const project = emptyProject('Lead lag', 'p-ll', new Date('2026-09-14T00:00:00.000Z'));
    const intersections = ['a', 'b'].map((id) => {
      const i = standardEightPhase(id);
      i.name = id.toUpperCase();
      return i;
    });
    project.intersections.push(...intersections);
    const stops = intersections.map((i, k) => newCorridorStop(i, 'E', k === 0));
    stops[1]!.distance = 300;
    stops[1]!.speed = { outbound: 10, inbound: 10 };
    project.corridors.push({ id: 'c', name: 'C', outbound: 'E', stops, plans: [newCorridorPlan('plan', 'Plan', intersections)] });
    return project;
  }

  it('lists the orders that swap a left turn with the coordinated phase beside it', () => {
    const orders = leadLagOrders(standardEightPhase(), 'am-peak');
    expect(orders.map((o) => [o.sequence?.map((r) => r.groups[0]) ?? null, o.lefts])).toEqual([
      [null, [{ phase: 1, leads: true }, { phase: 5, leads: true }]],
      [[[2, 1], [5, 6]], [{ phase: 1, leads: false }, { phase: 5, leads: true }]],
      [[[1, 2], [6, 5]], [{ phase: 1, leads: true }, { phase: 5, leads: false }]],
      [[[2, 1], [6, 5]], [{ phase: 1, leads: false }, { phase: 5, leads: false }]],
    ]);
  });

  // Phases 2 and 6 are green 29 s. With both lefts leading everywhere they start together, so the
  // two directions' bands pull B's offset opposite ways: one full 29 s band at best. With 5 lagging
  // at A (6 starts 15 s before 2) and 1 lagging at B (2 starts 15 s before 6), EB leaves A 15 s into
  // the cycle and WB leaves B 15 s after its EB green: both 29 s bands fit.
  it('finds a lead/lag pattern that fits both bands', () => {
    const project = eightPhaseCorridor();
    const corridor = project.corridors[0]!;
    const plan = corridor.plans[0]!;
    const plain = prepareOptimization(project, corridor, plan);
    if (!plain.ok) throw new Error(plain.reason);
    const without = optimizeOffsets(plain, { objective: 'weighted' });
    expect(without.bandwidth.outbound + without.bandwidth.inbound).toBe(290);

    const prepared = prepareOptimization(project, corridor, plan, { leadLag: true });
    if (!prepared.ok) throw new Error(prepared.reason);
    expect(prepared.stops.map((s) => s.variants.length)).toEqual([4, 4]);
    const result = optimizeOffsets(prepared, { objective: 'weighted' });
    expect(result.method).toBe('exhaustive');
    expect(result.bandwidth).toEqual({ outbound: 290, inbound: 290 });

    // Writing the chosen orders and offsets back gives the same bands.
    prepared.stops.forEach((stop, k) => {
      const pattern = project.intersections.find((i) => i.id === stop.intersectionId)!.patterns[0]!;
      pattern.sequence = stop.variants[result.variants[k]!]!.sequence;
      pattern.offset = result.offsets[k]!;
    });
    const check = analyzeProgression(project, corridor, plan);
    expect([check.bands.outbound.bandwidth, check.bands.inbound.bandwidth]).toEqual([290, 290]);
  });
});
