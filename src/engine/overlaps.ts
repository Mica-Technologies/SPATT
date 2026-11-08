/**
 * Overlap signals from their included phases, over a timeline of phase signals. Shared by the
 * intersection view (a cycle projection) and the simulator (its trace), which differ only in their
 * time unit.
 *
 * - **Normal**: green while any included phase is green, and through the change from one included
 *   phase to the next (an included phase starting within the clearance, and red+amber, of the one
 *   ending).
 * - **Minus green-yellow**: as normal, but not green while a modifier phase is green or yellow.
 *
 * When the overlap's green ends with its included phases, it runs its trail green; then yellow and
 * red clearance, the overlap's own trail times or, where 0, those of the phase it ended with.
 * Simplification: a green cut short by a modifier phase clears with yellow and red at once.
 */
import type { Intersection, Overlap, Phase } from '../model';

export type OverlapSignal = 'green' | 'yellow' | 'redClearance';

/** A span of a phase's signal; only green and yellow spans are read. */
export interface PhaseSignalSpan {
  phase: number;
  signal: string;
  start: number;
  end: number;
}

export interface OverlapSpan {
  overlap: string;
  signal: OverlapSignal;
  start: number;
  end: number;
}

export interface OverlapTiming {
  phases: readonly Phase[];
  /** Red+amber before every vehicle green, tenths. */
  redAmber: number;
  /** Time units per tenth of a second: 1 for projections, 2 for simulator ticks. */
  unit: number;
}

export const overlapTimingOf = (intersection: Pick<Intersection, 'phases' | 'redAmber'>, unit: number): OverlapTiming => ({ phases: intersection.phases, redAmber: intersection.redAmber, unit });

interface Piece {
  start: number;
  end: number;
  /** The included phase whose green ended the piece. */
  phase: number;
  /** Whether a modifier phase cut it short (no trail green). */
  cut: boolean;
}

/** The overlap's signal spans, sorted by start. A disabled overlap or one with no included phases has none. */
export function overlapSpans(overlap: Overlap, spans: readonly PhaseSignalSpan[], timing: OverlapTiming): OverlapSpan[] {
  if (!overlap.enabled || overlap.includedPhases.length === 0) return [];
  const byNumber = new Map(timing.phases.map((p) => [p.number, p]));
  const included = new Set(overlap.includedPhases);
  const clearance = (n: number) => {
    const p = byNumber.get(n);
    return p ? (p.yellow + p.redClear + timing.redAmber) * timing.unit : 0;
  };

  // Included greens, merged across the change from one included phase to the next.
  const greens = spans.filter((s) => s.signal === 'green' && included.has(s.phase)).sort((a, b) => a.start - b.start || a.end - b.end);
  const merged: Piece[] = [];
  for (const g of greens) {
    const last = merged[merged.length - 1];
    if (last && g.start <= last.end + clearance(last.phase)) {
      if (g.end >= last.end) {
        last.end = g.end;
        last.phase = g.phase;
      }
    } else {
      merged.push({ start: g.start, end: g.end, phase: g.phase, cut: false });
    }
  }

  // Minus green-yellow: take out the time a modifier phase is green or yellow.
  let pieces = merged;
  if (overlap.type === 'minusGreenYellow' && overlap.modifierPhases.length > 0) {
    const modifiers = new Set(overlap.modifierPhases);
    const blocks = spans.filter((s) => (s.signal === 'green' || s.signal === 'yellow') && modifiers.has(s.phase)).sort((a, b) => a.start - b.start);
    pieces = [];
    for (const piece of merged) {
      let start = piece.start;
      for (const b of blocks) {
        if (b.end <= start || b.start >= piece.end) continue;
        if (b.start > start) pieces.push({ start, end: b.start, phase: piece.phase, cut: true });
        start = Math.max(start, b.end);
        if (start >= piece.end) break;
      }
      if (start < piece.end) pieces.push({ ...piece, start });
    }
  }

  const out: OverlapSpan[] = [];
  pieces.forEach((piece, k) => {
    const phase = byNumber.get(piece.phase);
    const next = pieces[k + 1]?.start ?? Number.POSITIVE_INFINITY;
    const greenEnd = Math.min(next, piece.end + (piece.cut ? 0 : overlap.trailGreen * timing.unit));
    const yellowEnd = Math.min(next, greenEnd + (overlap.trailYellow || (phase?.yellow ?? 0)) * timing.unit);
    const redEnd = Math.min(next, yellowEnd + (overlap.trailRedClear || (phase?.redClear ?? 0)) * timing.unit);
    out.push({ overlap: overlap.id, signal: 'green', start: piece.start, end: greenEnd });
    if (yellowEnd > greenEnd) out.push({ overlap: overlap.id, signal: 'yellow', start: greenEnd, end: yellowEnd });
    if (redEnd > yellowEnd) out.push({ overlap: overlap.id, signal: 'redClearance', start: yellowEnd, end: redEnd });
  });
  return out;
}

/** Every enabled overlap's spans, sorted by start. */
export function allOverlapSpans(overlaps: readonly Overlap[], spans: readonly PhaseSignalSpan[], timing: OverlapTiming): OverlapSpan[] {
  return overlaps.flatMap((o) => overlapSpans(o, spans, timing)).sort((a, b) => a.start - b.start || a.overlap.localeCompare(b.overlap));
}

/** What an overlap shows at `t`: its span's signal, or red. */
export function overlapSignalAt(spans: readonly OverlapSpan[], overlap: string, t: number): OverlapSignal | 'red' {
  return spans.find((s) => s.overlap === overlap && s.start <= t && s.end > t)?.signal ?? 'red';
}
