import { describe, expect, it } from 'vitest';
import type { SimulationResult } from '../../../engine';
import { indexSpans } from './spanIndex';

type Span = SimulationResult['trace']['spans'][number];

const span = (phase: number, start: number, end: number, signal: Span['signal'] = 'green'): Span => ({ phase, signal, start, end });

describe('indexSpans', () => {
  // Mixed lengths, including spans that cross several 600-tick buckets.
  const spans: Span[] = [span(2, 0, 400), span(4, 0, 2000, 'walk'), span(1, 400, 500, 'yellow'), span(6, 550, 1300), span(8, 1300, 1310), span(3, 2500, 4000)];
  const naive = (from: number, to: number) => spans.filter((s) => s.end > from && s.start < to);
  const index = indexSpans(spans);

  it('returns the same spans as a full scan, once each and in start order', () => {
    for (const [from, to] of [[0, 100], [450, 700], [599, 601], [1200, 1300], [1300, 1301], [0, 5000], [2100, 2400], [3900, 9000]] as const) {
      expect(index.between(from, to)).toEqual(naive(from, to));
    }
  });

  it('finds the spans covering a tick', () => {
    expect(index.at(0).map((s) => s.phase)).toEqual([2, 4]);
    expect(index.at(1300).map((s) => s.phase)).toEqual([4, 8]);
    expect(index.at(2200)).toEqual([]);
  });
});
