/**
 * Offset optimization for a corridor timing plan: the offsets that give the best progression
 * bands, searched in whole seconds.
 *
 * A pattern's offset only moves its greens along the system clock, so the greens are computed once
 * at offset 0 (`prepareOptimization`) and every trial offset is a shift. The first timed
 * intersection keeps its offset: moving every offset together changes no band.
 *
 * - Up to four timed intersections: every combination (exhaustive).
 * - More: coordinate descent (best offset for one intersection at a time until nothing improves),
 *   from the current offsets and from seeded random starts; the best result wins.
 */
import { intersect, longestRun, shift, type Span } from './circular';
import { analyzeProgression, type Direction } from './progression';
import type { Corridor, CorridorPlan, Project, Tenths } from '../model';

export interface PreparedStop {
  intersectionId: string;
  name: string;
  /** Greens at offset 0, in system time. */
  green: Record<Direction, Span[]>;
  /** Whether this stop takes part in each direction's band. */
  inBand: Record<Direction, boolean>;
  /** Travel time (tenths) from each direction's band start to this stop. */
  arrival: Record<Direction, number>;
  currentOffset: Tenths;
}

export type Prepared = { ok: true; cycle: Tenths; stops: PreparedStop[]; weights: Record<Direction, number> } | { ok: false; reason: 'cycle-mismatch' | 'too-few-intersections' | 'no-bands' };

export function prepareOptimization(project: Project, corridor: Corridor, plan: CorridorPlan): Prepared {
  const current = analyzeProgression(project, corridor, plan);
  if (current.cycle === null) {
    return { ok: false, reason: current.stops.some((s) => s.projection) ? 'cycle-mismatch' : 'too-few-intersections' };
  }
  const zeros = Object.fromEntries(corridor.stops.map((s) => [s.intersectionId, 0]));
  const atZero = analyzeProgression(project, corridor, plan, zeros);
  const stops: PreparedStop[] = [];
  corridor.stops.forEach((stop, k) => {
    const timing = atZero.stops[k]!;
    const now = current.stops[k]!;
    if (!timing.projection || !now.projection) return;
    stops.push({
      intersectionId: stop.intersectionId,
      name: timing.name,
      green: timing.green,
      inBand: { outbound: stop.outboundPhases.length > 0, inbound: stop.inboundPhases.length > 0 },
      arrival: { outbound: atZero.bands.outbound.arrival[k]!, inbound: atZero.bands.inbound.arrival[k]! },
      currentOffset: now.projection.offset,
    });
  });
  if (stops.length < 2) {
    return { ok: false, reason: 'too-few-intersections' };
  }
  if (!stops.some((s) => s.inBand.outbound) && !stops.some((s) => s.inBand.inbound)) {
    return { ok: false, reason: 'no-bands' };
  }
  return { ok: true, cycle: current.cycle, stops, weights: plan.weights };
}

export type Objective = 'weighted' | 'balanced';

export interface Evaluation {
  offsets: Tenths[];
  bandwidth: Record<Direction, Tenths>;
  score: number;
}

function bandwidth(prepared: Extract<Prepared, { ok: true }>, offsets: readonly number[], direction: Direction): number {
  let band: Span[] = [[0, prepared.cycle]];
  let any = false;
  prepared.stops.forEach((stop, k) => {
    if (!stop.inBand[direction] || !Number.isFinite(stop.arrival[direction])) return;
    any = true;
    band = intersect(band, shift(stop.green[direction], offsets[k]! - stop.arrival[direction], prepared.cycle));
  });
  if (!any) return 0;
  return Math.round(longestRun(band, prepared.cycle)?.length ?? 0);
}

/**
 * The score compared between candidates. `weighted`: weight × bandwidth summed over directions,
 * ties broken towards equal bands. `balanced`: the narrower band first, then the weighted sum.
 */
export function evaluate(prepared: Extract<Prepared, { ok: true }>, offsets: readonly number[], objective: Objective): Evaluation {
  const out = bandwidth(prepared, offsets, 'outbound');
  const inb = bandwidth(prepared, offsets, 'inbound');
  const weighted = prepared.weights.outbound * out + prepared.weights.inbound * inb;
  const score = objective === 'weighted' ? weighted * 1e4 - Math.abs(out - inb) : Math.min(out, inb) * 1e6 + weighted;
  return { offsets: [...offsets], bandwidth: { outbound: out, inbound: inb }, score };
}

export interface OptimizeOptions {
  objective: Objective;
  /** Offset step, tenths (default 10: whole seconds). */
  step?: Tenths;
  /** Random starts for coordinate descent (default 24). */
  restarts?: number;
  /** Seed for the random starts, so results repeat. */
  seed?: number;
  /** Called with a fraction (0–1) as the search progresses. */
  onProgress?: (fraction: number) => void;
}

export interface OptimizeResult extends Evaluation {
  method: 'exhaustive' | 'coordinate-descent';
  evaluations: number;
  current: Evaluation;
}

/** A small seeded generator (mulberry32). */
function random(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function optimizeOffsets(prepared: Extract<Prepared, { ok: true }>, options: OptimizeOptions): OptimizeResult {
  const { objective, step = 10, restarts = 24, seed = 1, onProgress } = options;
  const { cycle, stops } = prepared;
  const candidates = Array.from({ length: Math.ceil(cycle / step) }, (_, i) => i * step);
  const current = evaluate(prepared, stops.map((s) => s.currentOffset), objective);
  let best = current;
  let evaluations = 1;
  const consider = (offsets: number[]) => {
    const result = evaluate(prepared, offsets, objective);
    evaluations++;
    if (result.score > best.score) best = result;
    return result;
  };

  if (stops.length <= 4) {
    const free = stops.length - 1;
    const total = candidates.length ** free;
    const offsets = stops.map((s) => s.currentOffset);
    for (let n = 0; n < total; n++) {
      let rest = n;
      for (let k = 1; k <= free; k++) {
        offsets[k] = candidates[rest % candidates.length]!;
        rest = Math.floor(rest / candidates.length);
      }
      consider(offsets);
      if (onProgress && n % 5000 === 0) onProgress(n / total);
    }
    onProgress?.(1);
    return { ...best, method: 'exhaustive', evaluations, current };
  }

  const next = random(seed);
  const starts = [stops.map((s) => s.currentOffset), ...Array.from({ length: restarts }, () => stops.map((s, k) => (k === 0 ? s.currentOffset : candidates[Math.floor(next() * candidates.length)]!)))];
  starts.forEach((start, r) => {
    let point = evaluate(prepared, start, objective);
    evaluations++;
    let improved = true;
    while (improved) {
      improved = false;
      for (let k = 1; k < stops.length; k++) {
        for (const candidate of candidates) {
          if (candidate === point.offsets[k]) continue;
          const trial = [...point.offsets];
          trial[k] = candidate;
          const result = consider(trial);
          if (result.score > point.score) {
            point = result;
            improved = true;
          }
        }
      }
    }
    onProgress?.((r + 1) / starts.length);
  });
  return { ...best, method: 'coordinate-descent', evaluations, current };
}
