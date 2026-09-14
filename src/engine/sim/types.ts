/**
 * Shared types for the signal simulator: what a controller behaviour sees each step (detector and
 * pushbutton inputs) and what it shows (each phase's signal).
 *
 * The simulator steps in controller ticks of 1/20 s, so a CSM controller can be followed tick for
 * tick; one tenth of a second (the model's unit) is two ticks.
 */
export const TICKS_PER_SECOND = 20;
export const TICKS_PER_TENTH = 2;

/** What a phase's vehicle signal shows. `dark`: the phase is not timing (red). */
export type VehicleSignal = 'green' | 'yellow' | 'red';
/** What a phase's pedestrian signal shows. */
export type PedestrianSignal = 'walk' | 'clearance' | 'dont-walk';

/** Why a phase's green ended. */
export type Termination = 'gap-out' | 'max-out' | 'force-off' | 'yield' | 'barrier';

export interface ControllerInputs {
  /** Tick number, from 0. */
  tick: number;
  /** Phases whose stop-bar detectors are occupied this tick (a queue or an arriving vehicle). */
  presence: ReadonlySet<number>;
  /** Phases whose detectors saw a new vehicle this tick (arrival or discharge over the detector). */
  actuations: ReadonlySet<number>;
  /** Vehicles waiting per phase (summed over its lane groups), for controllers that count them. */
  queues?: ReadonlyMap<number, number>;
  /** Phases whose pushbutton was pressed this tick. */
  pedestrianPresses: ReadonlySet<number>;
}

export interface PhaseSignal {
  vehicle: VehicleSignal;
  pedestrian: PedestrianSignal;
}

/** A controller behaviour: steps one tick and reports every phase's signal. */
export interface ControllerModel {
  readonly name: string;
  step(inputs: ControllerInputs): void;
  signal(phase: number): PhaseSignal;
  /** Terminations since the last call, drained by the simulator for its statistics. */
  drainTerminations(): { phase: number; reason: Termination; tick: number }[];
}
