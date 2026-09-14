import { describe, expect, it } from 'vitest';
import { emptyProject, newCorridorPlan, newCorridorStop, twoPhase, type Project } from '../model';
import { analyzeProgression } from './progression';

/**
 * Two two-phase intersections, A then B, 300 m apart at 10 m/s both ways (30 s of travel).
 * Each runs 70 s: phase 2 (EB) and phase 6 (WB) are green 0–34 s of their split (40 s split,
 * 4 s yellow, 2 s red clear), with the offset measured to the start of that green.
 */
function corridor(offsetB: number): Project {
  const project = emptyProject('Two', 'p-two', new Date('2026-09-14T00:00:00.000Z'));
  const a = twoPhase('a');
  a.name = 'A';
  const b = twoPhase('b');
  b.name = 'B';
  b.patterns[0]!.offset = offsetB;
  project.intersections.push(a, b);
  const stops = [newCorridorStop(a, 'E', true), newCorridorStop(b, 'E', false)];
  stops[1]!.distance = 300;
  stops[1]!.speed = { outbound: 10, inbound: 10 };
  project.corridors.push({ id: 'c', name: 'C', outbound: 'E', stops, plans: [newCorridorPlan('plan', 'Plan', [a, b])] });
  return project;
}

const analyze = (project: Project, overrides = {}) => analyzeProgression(project, project.corridors[0]!, project.corridors[0]!.plans[0]!, overrides);

describe('analyzeProgression', () => {
  it('lays out stops and their through-phase greens on the system clock', () => {
    const result = analyze(corridor(300));
    expect(result.cycle).toBe(700);
    expect(result.stops.map((s) => [s.name, s.position])).toEqual([['A', 0], ['B', 300]]);
    expect(result.stops[0]!.green).toEqual({ outbound: [[0, 340]], inbound: [[0, 340]] });
    expect(result.stops[1]!.green.outbound).toEqual([[300, 640]]);
  });

  it('finds the band each way (B offset 30 s = the travel time)', () => {
    const { bands } = analyze(corridor(300));
    // Outbound: leave A at τ ∈ [0, 34), reach B at τ + 30 ∈ [30, 64): all of A's green, 34 s.
    expect(bands.outbound).toMatchObject({ bandwidth: 340, start: 0, arrival: [0, 300] });
    expect(bands.outbound.efficiency).toBeCloseTo(340 / 700);
    // Inbound: leave B at τ ∈ [30, 64), reach A at τ + 30 ∈ [60, 94) = [60, 70) ∪ [0, 24);
    // A is green [0, 34) (i.e. 70–104), so departures 40–64 s get through: 24 s.
    expect(bands.inbound).toMatchObject({ bandwidth: 240, start: 400, arrival: [300, 0] });
  });

  it('narrows as the offset moves away from the travel time, across the cycle end', () => {
    // B offset 60 s: B green [60, 70) ∪ [0, 24). Outbound needs τ + 30 in it: τ ∈ [30, 64),
    // and τ ∈ [0, 34) at A, so 30–34 s: 4 s.
    expect(analyze(corridor(600)).bands.outbound).toMatchObject({ bandwidth: 40, start: 300 });
  });

  it('uses offset overrides without changing the project', () => {
    const project = corridor(0);
    expect(analyze(project).bands.outbound.bandwidth).toBe(40); // τ ∈ [0, 34) and τ + 30 ∈ [0, 34)
    expect(analyze(project, { b: 300 }).bands.outbound.bandwidth).toBe(340);
    expect(project.intersections[1]!.patterns[0]!.offset).toBe(0);
  });

  it('computes no band when the timed stops run different cycles', () => {
    const project = corridor(300);
    const b = project.intersections[1]!.patterns[0]!;
    b.cycle = 800;
    b.splits = { 2: 450, 4: 350, 6: 450, 8: 350 };
    const result = analyze(project);
    expect(result.cycle).toBeNull();
    expect(result.bands.outbound).toMatchObject({ bandwidth: null, efficiency: null });
    expect(result.stops[1]!.projection?.cycle).toBe(800);
  });

  it('leaves out stops not timed by the plan, and a direction with no through phases', () => {
    const project = corridor(300);
    project.corridors[0]!.plans[0]!.patterns['b'] = null;
    project.corridors[0]!.stops[0]!.inboundPhases = [];
    const result = analyze(project);
    expect(result.stops[1]).toMatchObject({ projection: null, reason: 'not-in-plan' });
    expect(result.bands.outbound.bandwidth).toBe(340); // A alone
    expect(result.bands.inbound.bandwidth).toBeNull(); // A has no inbound phases, B is not timed
  });
});
