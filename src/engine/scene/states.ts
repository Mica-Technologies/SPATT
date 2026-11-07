/**
 * What every phase's signals show at a moment of the cycle, from a cycle projection: the vehicle
 * interval (green, yellow, red clearance, red) and the pedestrian interval (walk, pedestrian
 * clearance, don't walk). Times are local time in tenths, 0 ≤ t < cycle, as on the cycle clock.
 */
import type { Tenths } from '../../model';
import { mod, type CycleProjection, type PhaseInterval } from '../projection';
import type { SceneSignalHead } from './scene';

/** `dark`: the phase does not time in this projection, or there is no projection to read. */
export type SceneVehicleSignal = 'green' | 'yellow' | 'redClearance' | 'red' | 'dark';
export type ScenePedestrianSignal = 'walk' | 'pedestrianClearance' | 'dontWalk' | 'dark';

export interface ScenePhaseSignal {
  vehicle: SceneVehicleSignal;
  /** `null` when the phase has no pedestrian service. */
  pedestrian: ScenePedestrianSignal | null;
}

export type HeadStates = ReadonlyMap<number, ScenePhaseSignal>;

const DARK: ScenePhaseSignal = { vehicle: 'dark', pedestrian: 'dark' };

function signalOf(interval: PhaseInterval, t: Tenths): ScenePhaseSignal {
  const vehicle: SceneVehicleSignal =
    t >= interval.greenStart && t < interval.yellowStart
      ? 'green'
      : t >= interval.yellowStart && t < interval.redClearStart
        ? 'yellow'
        : t >= interval.redClearStart && t < interval.splitEnd
          ? 'redClearance'
          : 'red';
  if (interval.walkEnd === null || interval.pedestrianClearanceEnd === null) {
    return { vehicle, pedestrian: null };
  }
  // A pedestrian interval longer than the split is cut at the split's end, as in the diagram.
  const walkEnd = Math.min(interval.walkEnd, interval.splitEnd);
  const clearanceEnd = Math.min(interval.pedestrianClearanceEnd, interval.splitEnd);
  const pedestrian: ScenePedestrianSignal = t >= interval.greenStart && t < walkEnd ? 'walk' : t >= walkEnd && t < clearanceEnd ? 'pedestrianClearance' : 'dontWalk';
  return { vehicle, pedestrian };
}

/**
 * Every projected phase's signals at local time `localTime` (wrapped into the cycle). Phases the
 * projection does not time are absent; `signalFor` reads them as dark.
 */
export function headStatesAt(projection: CycleProjection, localTime: Tenths): HeadStates {
  const t = mod(localTime + projection.localZero, projection.cycle);
  const states = new Map<number, ScenePhaseSignal>();
  for (const interval of projection.rings.flat()) {
    states.set(interval.phase, signalOf(interval, t));
  }
  return states;
}

/** A phase's signals, dark when it has none at this moment (or `states` is `null`). */
export function signalFor(states: HeadStates | null, phase: number): ScenePhaseSignal {
  return states?.get(phase) ?? DARK;
}

const PED_RANK: Record<ScenePedestrianSignal, number> = { walk: 3, pedestrianClearance: 2, dontWalk: 1, dark: 0 };

/** What one head shows: a vehicle head its phase's vehicle signal, a pedestrian head the most permissive of its phases' pedestrian signals. */
export function headSignal(head: SceneSignalHead, states: HeadStates | null): SceneVehicleSignal | ScenePedestrianSignal {
  if (head.kind === 'vehicle') {
    return signalFor(states, head.phases[0] ?? 0).vehicle;
  }
  let best: ScenePedestrianSignal = 'dark';
  for (const phase of head.phases) {
    const signal = signalFor(states, phase).pedestrian ?? 'dark';
    if (PED_RANK[signal] > PED_RANK[best]) best = signal;
  }
  return best;
}

/** A short key that changes only when some signal changes, for skipping redraws. */
export function statesKey(states: HeadStates | null): string {
  if (!states) return 'dark';
  return [...states.entries()]
    .sort(([a], [b]) => a - b)
    .map(([phase, s]) => `${phase}:${s.vehicle}:${s.pedestrian ?? ''}`)
    .join(',');
}

export const VEHICLE_SIGNAL_LABEL: Record<SceneVehicleSignal, string> = {
  green: 'green',
  yellow: 'yellow',
  redClearance: 'red clearance',
  red: 'red',
  dark: 'dark',
};

export const PEDESTRIAN_SIGNAL_LABEL: Record<ScenePedestrianSignal, string> = {
  walk: 'walk',
  pedestrianClearance: 'pedestrian clearance',
  dontWalk: "don't walk",
  dark: 'dark',
};
