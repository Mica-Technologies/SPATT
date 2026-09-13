/**
 * Clearance interval estimates, as commonly given in the ITE Traffic Engineering Handbook and
 * the MUTCD. These are starting points for engineering judgement, not design values.
 *
 * Results are tenths of a second, rounded up so a calculated minimum is never undercut.
 */
import type { Tenths } from '../model';

export type UnitSystem = 'us' | 'metric';

const MPH_TO_FPS = 5280 / 3600;
const KMH_TO_MPS = 1000 / 3600;

export const CLEARANCE_DEFAULTS = {
  us: { perceptionReaction: 1.0, deceleration: 10.0, gravity: 32.2, vehicleLength: 20, walkingSpeed: 3.5, pushbuttonWalkingSpeed: 3.0 },
  metric: { perceptionReaction: 1.0, deceleration: 3.05, gravity: 9.81, vehicleLength: 6, walkingSpeed: 1.07, pushbuttonWalkingSpeed: 0.91 },
} as const;

/** Rounds seconds up to the next tenth, tolerating floating-point noise just above a tenth. */
export function ceilTenths(seconds: number): Tenths {
  return Math.ceil(Math.round(seconds * 1e6) / 1e5);
}

function speedInUnitsPerSecond(speed: number, units: UnitSystem): number {
  return speed * (units === 'us' ? MPH_TO_FPS : KMH_TO_MPS);
}

export interface YellowInput {
  /** mph (US) or km/h (metric). */
  approachSpeed: number;
  /** Percent, uphill positive. */
  gradePercent?: number;
  units: UnitSystem;
  perceptionReaction?: number;
  deceleration?: number;
}

/** Kinematic yellow change interval: Y = t + v / (2a + 2Gg). */
export function yellowChange(input: YellowInput): Tenths {
  const d = CLEARANCE_DEFAULTS[input.units];
  const v = speedInUnitsPerSecond(input.approachSpeed, input.units);
  const t = input.perceptionReaction ?? d.perceptionReaction;
  const a = input.deceleration ?? d.deceleration;
  const grade = (input.gradePercent ?? 0) / 100;
  const denominator = 2 * a + 2 * grade * d.gravity;
  if (v <= 0 || denominator <= 0) {
    throw new RangeError('Yellow change needs a positive speed and an effective deceleration above zero');
  }
  return ceilTenths(t + v / denominator);
}

export interface RedClearanceInput {
  approachSpeed: number;
  /** Stop line to the far side of the last conflicting lane, ft or m. */
  intersectionWidth: number;
  vehicleLength?: number;
  units: UnitSystem;
}

/** Red clearance interval: R = (W + L) / v. */
export function redClearance(input: RedClearanceInput): Tenths {
  const v = speedInUnitsPerSecond(input.approachSpeed, input.units);
  if (v <= 0) {
    throw new RangeError('Red clearance needs a positive speed');
  }
  const length = input.vehicleLength ?? CLEARANCE_DEFAULTS[input.units].vehicleLength;
  return ceilTenths((input.intersectionWidth + length) / v);
}

export interface PedestrianClearanceInput {
  /** Curb to the far side of the travelled way, ft or m. */
  crossingDistance: number;
  walkingSpeed?: number;
  units: UnitSystem;
}

/** Pedestrian clearance (flashing DON'T WALK): distance / walking speed (3.5 ft/s default). */
export function pedestrianClearance(input: PedestrianClearanceInput): Tenths {
  const speed = input.walkingSpeed ?? CLEARANCE_DEFAULTS[input.units].walkingSpeed;
  if (speed <= 0) {
    throw new RangeError('Walking speed must be positive');
  }
  return ceilTenths(input.crossingDistance / speed);
}

/**
 * MUTCD 4I.06's second check: walk plus pedestrian clearance must also let a pedestrian who
 * starts at the pushbutton (typically 6 ft / 1.8 m behind the curb) cross at 3.0 ft/s.
 * Returns that minimum total.
 */
export function pedestrianTotalMinimum(input: { crossingDistance: number; pushbuttonSetback?: number; units: UnitSystem }): Tenths {
  const d = CLEARANCE_DEFAULTS[input.units];
  const setback = input.pushbuttonSetback ?? (input.units === 'us' ? 6 : 1.8);
  return ceilTenths((input.crossingDistance + setback) / d.pushbuttonWalkingSpeed);
}
