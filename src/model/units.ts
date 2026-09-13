/**
 * Time units.
 *
 * Every duration in the model is an integer number of tenths of a second. Controllers program
 * at 0.1 s, integers keep cycle sums exact, and a tenth converts exactly to CSM's 20 Hz ticks.
 */

/** An integer count of tenths of a second. */
export type Tenths = number;

export const TICKS_PER_SECOND = 20;
const TICKS_PER_TENTH = TICKS_PER_SECOND / 10;

/** Seconds (as typed by a user) to tenths, rounded to the nearest tenth. */
export function secondsToTenths(seconds: number): Tenths {
  if (!Number.isFinite(seconds)) {
    throw new RangeError(`Not a finite number of seconds: ${seconds}`);
  }
  return Math.round(seconds * 10);
}

export function tenthsToSeconds(tenths: Tenths): number {
  return tenths / 10;
}

/** Tenths to Minecraft ticks; always exact. */
export function tenthsToTicks(tenths: Tenths): number {
  return tenths * TICKS_PER_TENTH;
}

/**
 * Ticks to tenths. A tick is 0.05 s, so an odd tick count has no exact tenth; `exact` is false
 * then and the value is rounded half up.
 */
export function ticksToTenths(ticks: number): { tenths: Tenths; exact: boolean } {
  return { tenths: Math.round(ticks / TICKS_PER_TENTH), exact: ticks % TICKS_PER_TENTH === 0 };
}

/** Formats tenths as seconds with one decimal, e.g. 45 → "4.5". */
export function formatSeconds(tenths: Tenths): string {
  return (tenths / 10).toFixed(1);
}
