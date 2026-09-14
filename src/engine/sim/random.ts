/** Seeded randomness for repeatable simulations and searches. */

/** A small seeded generator (mulberry32): uniform numbers in [0, 1). */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Time to the next event of a Poisson process with `perHour` events an hour, in ticks (Infinity at rate 0). */
export function nextArrivalTicks(random: () => number, perHour: number, ticksPerSecond: number): number {
  if (perHour <= 0) return Number.POSITIVE_INFINITY;
  // 1 − random() is in (0, 1], so the log is finite.
  return (-Math.log(1 - random()) * 3600 * ticksPerSecond) / perHour;
}
