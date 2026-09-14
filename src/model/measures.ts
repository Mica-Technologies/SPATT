/**
 * Distances and speeds. The model stores metres and metres per second; the project's units only
 * decide how they are shown and entered. CSM units treat one block as one metre.
 */
import type { Approach, LengthUnit, SpeedUnit } from './schema';

const METRES_PER: Record<LengthUnit, number> = { ft: 0.3048, m: 1, block: 1 };
const METRES_PER_SECOND_PER: Record<SpeedUnit, number> = { mph: 0.44704, 'km/h': 1 / 3.6, 'block/s': 1 };

export const LENGTH_LABEL: Record<LengthUnit, string> = { ft: 'ft', m: 'm', block: 'blocks' };
export const SPEED_LABEL: Record<SpeedUnit, string> = { mph: 'mph', 'km/h': 'km/h', 'block/s': 'blocks/s' };

export const toMetres = (value: number, unit: LengthUnit): number => value * METRES_PER[unit];
export const fromMetres = (metres: number, unit: LengthUnit): number => metres / METRES_PER[unit];
export const toMetresPerSecond = (value: number, unit: SpeedUnit): number => value * METRES_PER_SECOND_PER[unit];
export const fromMetresPerSecond = (mps: number, unit: SpeedUnit): number => mps / METRES_PER_SECOND_PER[unit];

/** A length or speed for display, to one decimal place (whole numbers when that is exact). */
export function formatMeasure(value: number): string {
  const rounded = Math.round(value * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

const OPPOSITE: Record<Approach, Approach> = { N: 'S', NE: 'SW', E: 'W', SE: 'NW', S: 'N', SW: 'NE', W: 'E', NW: 'SE' };

/** The reverse direction of travel. */
export const oppositeDirection = (direction: Approach): Approach => OPPOSITE[direction];

/** The project's unit systems, as offered in settings. */
export const UNIT_SYSTEMS: { label: string; length: LengthUnit; speed: SpeedUnit }[] = [
  { label: 'US customary (ft, mph)', length: 'ft', speed: 'mph' },
  { label: 'Metric (m, km/h)', length: 'm', speed: 'km/h' },
  { label: 'CSM (blocks, blocks/s)', length: 'block', speed: 'block/s' },
];
