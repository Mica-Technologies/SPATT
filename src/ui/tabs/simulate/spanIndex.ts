/**
 * An index over a simulation's signal spans for playback: spans bucketed by time, so drawing a
 * window or asking what shows at the cursor touches only the spans near it instead of all of them.
 */
import type { SimulationResult } from '../../../engine';

type SignalSpan = SimulationResult['trace']['spans'][number];

/** Bucket width in ticks (30 s at 20 ticks a second). */
const BUCKET = 600;

export interface SpanIndex {
  /** Spans overlapping [from, to) ticks, each once, in start order. */
  between(from: number, to: number): SignalSpan[];
  /** Spans covering the tick `at`. */
  at(at: number): SignalSpan[];
}

export function indexSpans(spans: readonly SignalSpan[]): SpanIndex {
  const buckets: number[][] = [];
  spans.forEach((span, k) => {
    const first = Math.floor(span.start / BUCKET);
    const last = Math.floor(Math.max(span.start, span.end - 1) / BUCKET);
    for (let b = first; b <= last; b++) (buckets[b] ??= []).push(k);
  });
  return {
    between(from, to) {
      const out: SignalSpan[] = [];
      const firstBucket = Math.max(0, Math.floor(from / BUCKET));
      const lastBucket = Math.floor(Math.max(from, to - 1) / BUCKET);
      for (let b = firstBucket; b <= lastBucket; b++) {
        for (const k of buckets[b] ?? []) {
          const span = spans[k]!;
          // Report a span from the first bucket of the window it appears in, so it comes once.
          if (Math.max(firstBucket, Math.floor(span.start / BUCKET)) !== b) continue;
          if (span.end > from && span.start < to) out.push(span);
        }
      }
      return out;
    },
    at(at) {
      return (buckets[Math.floor(at / BUCKET)] ?? []).map((k) => spans[k]!).filter((s) => s.start <= at && s.end > at);
    },
  };
}
