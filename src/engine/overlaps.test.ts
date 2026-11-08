import { describe, expect, it } from 'vitest';
import { newLaneGroup, standardEightPhase, twoPhase, type Intersection, type Overlap } from '../model';
import { overlapSignalAt, overlapSpans, type PhaseSignalSpan } from './overlaps';
import { projectCycle } from './projection';
import { buildScene, headSignal, headStatesAt, overlapStatesAt, signalFor } from './scene';
import { NemaController, simulate } from './sim';

const overlap = (more: Partial<Overlap> = {}): Overlap => ({
  id: 'A',
  label: '',
  enabled: true,
  type: 'normal',
  includedPhases: [2, 3],
  modifierPhases: [],
  trailGreen: 0,
  trailYellow: 0,
  trailRedClear: 0,
  ...more,
});

/** Phase 2 green 0–300, yellow 300–340, red 340–360; phase 3 green 360–500, yellow 500–540 (tenths). */
const spans: PhaseSignalSpan[] = [
  { phase: 2, signal: 'green', start: 0, end: 300 },
  { phase: 2, signal: 'yellow', start: 300, end: 340 },
  { phase: 3, signal: 'green', start: 360, end: 500 },
  { phase: 3, signal: 'yellow', start: 500, end: 540 },
  { phase: 5, signal: 'green', start: 100, end: 150 },
  { phase: 5, signal: 'yellow', start: 150, end: 190 },
];
const timing = { phases: standardEightPhase().phases.map((p) => ({ ...p, yellow: 40, redClear: 20 })), redAmber: 0, unit: 1 };
const shape = (list: ReturnType<typeof overlapSpans>) => list.map((s) => [s.signal, s.start, s.end]);

describe('overlapSpans', () => {
  it('stays green through the change between included phases, then clears with the last one', () => {
    expect(shape(overlapSpans(overlap(), spans, timing))).toEqual([
      ['green', 0, 500],
      ['yellow', 500, 540],
      ['redClearance', 540, 560],
    ]);
  });

  it('clears between included phases that are not back to back', () => {
    const apart = spans.map((s) => (s.phase === 3 ? { ...s, start: s.start + 100, end: s.end + 100 } : s));
    expect(shape(overlapSpans(overlap(), apart, timing)).slice(0, 3)).toEqual([
      ['green', 0, 300],
      ['yellow', 300, 340],
      ['redClearance', 340, 360],
    ]);
  });

  it('runs its trail green and its own trail clearance times', () => {
    expect(shape(overlapSpans(overlap({ includedPhases: [3], trailGreen: 30, trailYellow: 35, trailRedClear: 15 }), spans, timing))).toEqual([
      ['green', 360, 530],
      ['yellow', 530, 565],
      ['redClearance', 565, 580],
    ]);
  });

  it('drops out while a modifier phase is green or yellow (minus green-yellow)', () => {
    const list = overlapSpans(overlap({ type: 'minusGreenYellow', modifierPhases: [5] }), spans, timing);
    expect(shape(list).slice(0, 4)).toEqual([
      ['green', 0, 100],
      ['yellow', 100, 140],
      ['redClearance', 140, 160],
      ['green', 190, 500],
    ]);
    expect(overlapSignalAt(list, 'A', 170)).toBe('red');
    expect(overlapSignalAt(list, 'A', 200)).toBe('green');
  });

  it('shows nothing when disabled or empty', () => {
    expect(overlapSpans(overlap({ enabled: false }), spans, timing)).toEqual([]);
    expect(overlapSpans(overlap({ includedPhases: [] }), spans, timing)).toEqual([]);
  });
});

describe('overlaps in the intersection view and the simulator', () => {
  /** Standard eight-phase with the usual northbound right-turn overlap: phases 8 and 1. */
  function withOverlap(): Intersection {
    const i = standardEightPhase();
    i.overlaps = [overlap({ includedPhases: [8, 1] })];
    return i;
  }

  it('reads an overlap from the projection, through the cycle', () => {
    const i = withOverlap();
    const result = projectCycle(i, i.patterns[0]!.id);
    if (!result.ok) throw new Error('no projection');
    const p = result.projection;
    for (let t = 0; t < p.cycle; t += 5) {
      const states = headStatesAt(p, t);
      const shown = overlapStatesAt(p, i, t).get('A');
      const phase8 = signalFor(states, 8).vehicle;
      const phase1 = signalFor(states, 1).vehicle;
      const clearing = [phase8, phase1].some((s) => s === 'yellow' || s === 'redClearance');
      if (phase8 === 'green' || phase1 === 'green') expect(shown).toBe('green');
      else if (!clearing) expect(shown).toBe('red');
    }
    // Phase 8 hands over to phase 1 across the barrier: the overlap stays green through 8's clearance.
    const handover = Array.from({ length: p.cycle }, (_, t) => t).find((t) => signalFor(headStatesAt(p, t), 8).vehicle === 'yellow' && signalFor(headStatesAt(p, t + 60), 1).vehicle === 'green');
    if (handover !== undefined) expect(overlapStatesAt(p, i, handover).get('A')).toBe('green');
  });

  it('gives the overlap a right-turn head on the approach of its through phase', () => {
    const i = withOverlap();
    const scene = buildScene(i);
    const head = scene.heads.find((h) => h.overlap === 'A')!;
    expect(head).toMatchObject({ kind: 'vehicle', leg: 'S', movement: 'right', phases: [8, 1] });
    const pole = scene.poles.find((p) => p.heads.includes(head.id))!;
    expect(pole.heads).toContain('S-8');
    const result = projectCycle(i, i.patterns[0]!.id);
    if (!result.ok) throw new Error('no projection');
    const states = headStatesAt(result.projection, 0);
    expect(headSignal(head, states, new Map([['A', 'yellow']]))).toBe('yellow');
    expect(headSignal(head, null, new Map([['A', 'green']]))).toBe('dark');
  });

  it('says so when an overlap has no placed phase', () => {
    const i = withOverlap();
    i.overlaps.push(overlap({ id: 'B', includedPhases: [12] }));
    expect(buildScene(i).assumptions.some((a) => a.includes('Overlap B'))).toBe(true);
  });

  it('adds overlap spans to the simulator trace only when there are overlaps', () => {
    const plain = twoPhase();
    plain.laneGroups.push(newLaneGroup('eb', plain.phases.find((p) => p.number === 2)!));
    plain.volumeSets.push({ id: 'am', name: 'AM', peakHourFactor: 1, volumes: { eb: { left: 0, through: 600, right: 0 } } });
    const settings = { patternId: 'all-day', volumeSetId: 'am', durationSeconds: 600, warmUpSeconds: 0, seed: 1, pedestrianCallsPerHour: {} };
    const before = simulate(plain, settings, new NemaController(plain, { patternId: 'all-day' }));
    expect(before.trace.overlaps).toBeUndefined();
    const i = structuredClone(plain);
    i.overlaps = [overlap({ includedPhases: [2] })];
    const result = simulate(i, settings, new NemaController(i, { patternId: 'all-day' }));
    const greens = (list: { signal: string; start: number; end: number }[]) => list.filter((s) => s.signal === 'green').map((s) => [s.start, s.end]);
    expect(greens(result.trace.overlaps!)).toEqual(greens(result.trace.spans.filter((s) => s.phase === 2)));
    expect(result.trace.overlaps!.some((s) => s.signal === 'yellow')).toBe(true);
  });
});
