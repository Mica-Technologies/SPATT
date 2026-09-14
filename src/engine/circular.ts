/**
 * Sets of time spans on one cycle, treated as a circle: `[from, to)` with `0 ≤ from < to ≤ cycle`.
 * Values may be fractional tenths (travel times rarely land on a tenth); callers round results.
 */

export type Span = [number, number];

const EPSILON = 1e-9;

/** Sorted, non-overlapping spans; touching spans are merged. */
export function normalize(spans: readonly Span[], cycle: number): Span[] {
  const clipped = spans
    .map(([a, b]): Span => [Math.max(0, a), Math.min(cycle, b)])
    .filter(([a, b]) => b - a > EPSILON)
    .sort((x, y) => x[0] - y[0]);
  const out: Span[] = [];
  for (const span of clipped) {
    const last = out.at(-1);
    if (last && span[0] <= last[1] + EPSILON) {
      last[1] = Math.max(last[1], span[1]);
    } else {
      out.push([span[0], span[1]]);
    }
  }
  return out;
}

/** Every span moved by `by` around the circle, split where it crosses the cycle's end. */
export function shift(spans: readonly Span[], by: number, cycle: number): Span[] {
  const moved: Span[] = [];
  for (const [a, b] of spans) {
    const length = b - a;
    if (length >= cycle - EPSILON) {
      return [[0, cycle]];
    }
    const from = (((a + by) % cycle) + cycle) % cycle;
    const to = from + length;
    if (to <= cycle + EPSILON) {
      moved.push([from, Math.min(to, cycle)]);
    } else {
      moved.push([from, cycle], [0, to - cycle]);
    }
  }
  return normalize(moved, cycle);
}

/** The spans common to both sets (both normalized). */
export function intersect(a: readonly Span[], b: readonly Span[]): Span[] {
  const out: Span[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    const from = Math.max(a[i]![0], b[j]![0]);
    const to = Math.min(a[i]![1], b[j]![1]);
    if (to - from > EPSILON) {
      out.push([from, to]);
    }
    if (a[i]![1] < b[j]![1]) i++;
    else j++;
  }
  return out;
}

/**
 * The longest unbroken stretch of a normalized set, counting a span that ends at the cycle's end
 * and one that starts at 0 as one. `start` is where it begins (0 ≤ start < cycle); `null` when
 * the set is empty.
 */
export function longestRun(spans: readonly Span[], cycle: number): { start: number; length: number } | null {
  if (spans.length === 0) {
    return null;
  }
  const runs = spans.map(([a, b]) => ({ start: a, length: b - a }));
  const first = spans[0]!;
  const last = spans.at(-1)!;
  if (spans.length > 1 && first[0] <= EPSILON && last[1] >= cycle - EPSILON) {
    runs.push({ start: last[0], length: last[1] - last[0] + first[1] - first[0] });
  }
  return runs.reduce((best, run) => (run.length > best.length + EPSILON ? run : best));
}
