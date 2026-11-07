import { describe, expect, it } from 'vitest';
import { leadLagEightPhase, standardEightPhase, type Intersection } from '../../model';
import { projectCycle, type CycleProjection } from '../projection';
import { buildScene } from './scene';
import { headSignal, headStatesAt, signalFor, statesKey } from './states';

function projected(intersection: Intersection): CycleProjection {
  const result = projectCycle(intersection, intersection.patterns[0]!.id);
  if (!result.ok) throw new Error(result.issues.map((i) => i.message).join('; '));
  return result.projection;
}

describe('headStatesAt — standard eight-phase, local zero at begin of coordinated green (sequence 15 s)', () => {
  // Phase 2: green 15–44 s, yellow 44–48, red clearance 48–50 (sequence time); walk 7 s, ped clearance 18 s.
  const p = projected(standardEightPhase());
  const at = (local: number, phase: number) => signalFor(headStatesAt(p, local), phase);

  it('starts the cycle with the coordinated phases green and walking', () => {
    expect(at(0, 2)).toEqual({ vehicle: 'green', pedestrian: 'walk' });
    expect(at(0, 6)).toEqual({ vehicle: 'green', pedestrian: 'walk' });
    expect(at(0, 1).vehicle).toBe('red');
    expect(at(0, 4)).toEqual({ vehicle: 'red', pedestrian: 'dontWalk' });
  });

  it('steps phase 2 through its intervals at their boundaries', () => {
    expect(at(69, 2).pedestrian).toBe('walk');
    expect(at(70, 2).pedestrian).toBe('pedestrianClearance');
    expect(at(249, 2).pedestrian).toBe('pedestrianClearance');
    expect(at(250, 2).pedestrian).toBe('dontWalk');
    expect(at(289, 2).vehicle).toBe('green');
    expect(at(290, 2).vehicle).toBe('yellow');
    expect(at(330, 2).vehicle).toBe('redClearance');
    expect(at(350, 2).vehicle).toBe('red');
    expect(at(350, 3).vehicle).toBe('green');
  });

  it('wraps local time into the cycle', () => {
    // Local 80 s is sequence 5 s: phase 1 green.
    expect(at(800, 1).vehicle).toBe('green');
    expect(at(800 + 900, 1).vehicle).toBe('green');
    expect(at(-100, 1).vehicle).toBe('green');
  });

  it('has no pedestrian signal for a phase without pedestrian service', () => {
    expect(at(800, 1).pedestrian).toBeNull();
  });

  it('reads phases it does not time, and a missing projection, as dark', () => {
    expect(signalFor(headStatesAt(p, 0), 12)).toEqual({ vehicle: 'dark', pedestrian: 'dark' });
    expect(signalFor(null, 2)).toEqual({ vehicle: 'dark', pedestrian: 'dark' });
  });

  it('follows the pattern sequence: lagging phase 1 times after phase 2', () => {
    const lagging = projected(leadLagEightPhase());
    // Phase 2 now starts the sequence at 0 and is the coordinated reference; phase 1 runs 35–50 s.
    expect(signalFor(headStatesAt(lagging, 0), 2).vehicle).toBe('green');
    expect(signalFor(headStatesAt(lagging, 360), 1).vehicle).toBe('green');
    expect(signalFor(headStatesAt(lagging, 360), 5).vehicle).toBe('red');
  });

  it('gives each head its signal, and a key that changes only with the signals', () => {
    const scene = buildScene(standardEightPhase());
    const states = headStatesAt(p, 0);
    const eb = scene.heads.find((h) => h.kind === 'vehicle' && h.phases[0] === 2)!;
    const ebLeft = scene.heads.find((h) => h.kind === 'vehicle' && h.phases[0] === 5)!;
    const crossing = scene.heads.find((h) => h.kind === 'pedestrian' && h.phases.includes(2))!;
    expect(headSignal(eb, states)).toBe('green');
    expect(headSignal(ebLeft, states)).toBe('red');
    expect(headSignal(crossing, states)).toBe('walk');
    expect(headSignal(eb, null)).toBe('dark');
    expect(statesKey(headStatesAt(p, 10))).toBe(statesKey(states));
    expect(statesKey(headStatesAt(p, 70))).not.toBe(statesKey(states));
    expect(statesKey(null)).toBe('dark');
  });
});
