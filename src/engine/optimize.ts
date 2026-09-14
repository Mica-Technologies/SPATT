/**
 * Offset optimization for a corridor timing plan: the offsets that give the best progression
 * bands, searched in whole seconds, and optionally the order of each intersection's left turns
 * next to its coordinated phases (lead or lag).
 *
 * A pattern's offset only moves its greens along the system clock, so the greens are computed once
 * at offset 0 (`prepareOptimization`), per phase order, and every trial offset is a shift. The first
 * timed intersection keeps its offset: moving every offset together changes no band.
 *
 * Each intersection's choice is a (phase order, offset) pair. The search is exhaustive when the
 * combinations are few (up to four timed intersections without lead/lag, or at most
 * `EXHAUSTIVE_LIMIT` combinations with it), and otherwise coordinate descent (the best choice for
 * one intersection at a time until nothing improves) from the current timing and from seeded random
 * starts; the best result wins.
 */
import { intersect, longestRun, shift, type Span } from './circular';
import { analyzeProgression, type Direction } from './progression';
import { projectCycle } from './projection';
import { effectiveSequence, type Corridor, type CorridorPlan, type Intersection, type Phase, type Project, type Ring, type Tenths } from '../model';

/** Lead/lag searches stay exhaustive up to this many combinations. */
export const EXHAUSTIVE_LIMIT = 500_000;

/** One phase order an intersection can run in the search. */
export interface PreparedVariant {
  /** The pattern's sequence for this order (`null`: the intersection's own ring order). */
  sequence: Ring[] | null;
  /** Greens at offset 0, in system time. */
  green: Record<Direction, Span[]>;
  /** Left-turn phases beside the coordinated phases, and whether each runs before (leads) or after (lags). */
  lefts: { phase: number; leads: boolean }[];
}

export interface PreparedStop {
  intersectionId: string;
  name: string;
  /** Phase orders to try; the first is the pattern's current order. */
  variants: PreparedVariant[];
  /** Whether this stop takes part in each direction's band. */
  inBand: Record<Direction, boolean>;
  /** Travel time (tenths) from each direction's band start to this stop. */
  arrival: Record<Direction, number>;
  currentOffset: Tenths;
}

export type Prepared = { ok: true; cycle: Tenths; stops: PreparedStop[]; weights: Record<Direction, number>; leadLag: boolean } | { ok: false; reason: 'cycle-mismatch' | 'too-few-intersections' | 'no-bands' };

export interface PrepareOptions {
  /** Also try each left turn beside the coordinated phases leading and lagging. */
  leadLag?: boolean;
}

function sameOrder(a: readonly Ring[], b: readonly Ring[]): boolean {
  return a.length === b.length && a.every((ring, r) => ring.groups.length === b[r]!.groups.length && ring.groups.every((g, k) => g.join() === b[r]!.groups[k]!.join()));
}

/**
 * The pattern's current order first, then every other order that swaps a left turn and the
 * coordinated phase next to it, within the coordinated phases' barrier group (up to one swap per ring).
 */
export function leadLagOrders(intersection: Intersection, patternId: string): { sequence: Ring[] | null; lefts: PreparedVariant['lefts'] }[] {
  const pattern = intersection.patterns.find((p) => p.id === patternId);
  if (!pattern) return [];
  const phases = new Map<number, Phase>(intersection.phases.map((p) => [p.number, p]));
  const enabled = (n: number) => phases.get(n)?.enabled === true;
  const base = effectiveSequence(pattern, intersection.rings);
  const coordinated = new Set(pattern.coordinatedPhases);
  const group = base[0]?.groups.findIndex((_, g) => base.some((ring) => (ring.groups[g] ?? []).some((n) => coordinated.has(n)))) ?? -1;

  // Rings whose coordinated group is exactly a left turn and a coordinated phase.
  const swappable = base.flatMap((ring, r) => {
    const list = (ring.groups[group] ?? []).filter(enabled);
    const left = list.find((n) => phases.get(n)!.movement.kind === 'left');
    return list.length === 2 && left !== undefined && list.some((n) => coordinated.has(n)) ? [{ r, left }] : [];
  });
  const orders: { sequence: Ring[] | null; lefts: PreparedVariant['lefts'] }[] = [];
  for (let mask = 0; mask < 1 << swappable.length; mask++) {
    const sequence = structuredClone(base);
    swappable.forEach(({ r }, bit) => {
      if (mask & (1 << bit)) {
        const g = sequence[r]!.groups[group]!;
        const at = g.map((n, i) => (enabled(n) ? i : -1)).filter((i) => i >= 0);
        [g[at[0]!], g[at[1]!]] = [g[at[1]!]!, g[at[0]!]!];
      }
    });
    const lefts = swappable.map(({ r, left }) => {
      const g = sequence[r]!.groups[group]!.filter(enabled);
      return { phase: left, leads: g[0] === left };
    });
    orders.push({ sequence: sameOrder(sequence, intersection.rings) ? null : sequence, lefts });
  }
  return orders;
}

export function prepareOptimization(project: Project, corridor: Corridor, plan: CorridorPlan, options: PrepareOptions = {}): Prepared {
  const leadLag = options.leadLag ?? false;
  const current = analyzeProgression(project, corridor, plan);
  if (current.cycle === null) {
    return { ok: false, reason: current.stops.some((s) => s.projection) ? 'cycle-mismatch' : 'too-few-intersections' };
  }
  const zeros = Object.fromEntries(corridor.stops.map((s) => [s.intersectionId, 0]));
  const atZero = analyzeProgression(project, corridor, plan, zeros);
  const intersections = new Map(project.intersections.map((i) => [i.id, i]));
  const stops: PreparedStop[] = [];
  corridor.stops.forEach((stop, k) => {
    const timing = atZero.stops[k]!;
    const now = current.stops[k]!;
    if (!timing.projection || !now.projection) return;
    const intersection = intersections.get(stop.intersectionId)!;
    const patternId = plan.patterns[stop.intersectionId]!;
    const orders = leadLag ? leadLagOrders(intersection, patternId) : [];
    const variants: PreparedVariant[] = [{ sequence: intersection.patterns.find((p) => p.id === patternId)!.sequence, green: timing.green, lefts: orders[0]?.lefts ?? [] }];
    for (const order of orders.slice(1)) {
      const changed: Intersection = { ...intersection, patterns: intersection.patterns.map((p) => (p.id === patternId ? { ...p, sequence: order.sequence } : p)) };
      if (!projectCycle(changed, patternId).ok) continue;
      const trial: Project = { ...project, intersections: project.intersections.map((i) => (i.id === intersection.id ? changed : i)) };
      variants.push({ sequence: order.sequence, green: analyzeProgression(trial, corridor, plan, zeros).stops[k]!.green, lefts: order.lefts });
    }
    stops.push({
      intersectionId: stop.intersectionId,
      name: timing.name,
      variants,
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
  return { ok: true, cycle: current.cycle, stops, weights: plan.weights, leadLag };
}

export type Objective = 'weighted' | 'balanced';

export interface Evaluation {
  offsets: Tenths[];
  /** Per stop, the index of its variant (phase order). */
  variants: number[];
  bandwidth: Record<Direction, Tenths>;
  score: number;
}

type ReadyPrepared = Extract<Prepared, { ok: true }>;

function bandwidth(prepared: ReadyPrepared, offsets: readonly number[], variants: readonly number[], direction: Direction): number {
  let band: Span[] = [[0, prepared.cycle]];
  let any = false;
  prepared.stops.forEach((stop, k) => {
    if (!stop.inBand[direction] || !Number.isFinite(stop.arrival[direction])) return;
    any = true;
    band = intersect(band, shift(stop.variants[variants[k] ?? 0]!.green[direction], offsets[k]! - stop.arrival[direction], prepared.cycle));
  });
  if (!any) return 0;
  return Math.round(longestRun(band, prepared.cycle)?.length ?? 0);
}

/**
 * The score compared between candidates. `weighted`: weight × bandwidth summed over directions,
 * ties broken towards equal bands. `balanced`: the narrower band first, then the weighted sum.
 */
export function evaluate(prepared: ReadyPrepared, offsets: readonly number[], objective: Objective, variants: readonly number[] = []): Evaluation {
  const chosen = prepared.stops.map((_, k) => variants[k] ?? 0);
  const out = bandwidth(prepared, offsets, chosen, 'outbound');
  const inb = bandwidth(prepared, offsets, chosen, 'inbound');
  const weighted = prepared.weights.outbound * out + prepared.weights.inbound * inb;
  const score = objective === 'weighted' ? weighted * 1e4 - Math.abs(out - inb) : Math.min(out, inb) * 1e6 + weighted;
  return { offsets: [...offsets], variants: chosen, bandwidth: { outbound: out, inbound: inb }, score };
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

/** A stop's choice: [variant index, offset]. */
type Choice = readonly [number, number];

export function optimizeOffsets(prepared: ReadyPrepared, options: OptimizeOptions): OptimizeResult {
  const { objective, step = 10, restarts = 24, seed = 1, onProgress } = options;
  const { cycle, stops } = prepared;
  const offsetsToTry = Array.from({ length: Math.ceil(cycle / step) }, (_, i) => i * step);
  // The first stop keeps its offset; every stop may take any of its phase orders.
  const choices: Choice[][] = stops.map((stop, k) => stop.variants.flatMap((_, v) => (k === 0 ? [[v, stop.currentOffset] as const] : offsetsToTry.map((o) => [v, o] as const))));
  const current = evaluate(prepared, stops.map((s) => s.currentOffset), objective);
  let best = current;
  let evaluations = 1;
  const consider = (picked: readonly Choice[]) => {
    const result = evaluate(
      prepared,
      picked.map((c) => c[1]),
      objective,
      picked.map((c) => c[0]),
    );
    evaluations++;
    if (result.score > best.score) best = result;
    return result;
  };

  const combinations = choices.reduce((product, list) => product * list.length, 1);
  if (prepared.leadLag ? combinations <= EXHAUSTIVE_LIMIT : stops.length <= 4) {
    const picked = choices.map((list) => list[0]!);
    for (let n = 0; n < combinations; n++) {
      let rest = n;
      for (let k = 0; k < stops.length; k++) {
        picked[k] = choices[k]![rest % choices[k]!.length]!;
        rest = Math.floor(rest / choices[k]!.length);
      }
      consider(picked);
      if (onProgress && n % 5000 === 0) onProgress(n / combinations);
    }
    onProgress?.(1);
    return { ...best, method: 'exhaustive', evaluations, current };
  }

  const next = random(seed);
  const currentChoice: Choice[] = stops.map((s) => [0, s.currentOffset]);
  const starts = [currentChoice, ...Array.from({ length: restarts }, () => choices.map((list, k) => (list.length === 1 ? currentChoice[k]! : list[Math.floor(next() * list.length)]!)))];
  starts.forEach((start, r) => {
    let picked = [...start];
    let point = evaluate(
      prepared,
      picked.map((c) => c[1]),
      objective,
      picked.map((c) => c[0]),
    );
    evaluations++;
    let improved = true;
    while (improved) {
      improved = false;
      for (let k = 0; k < stops.length; k++) {
        if (choices[k]!.length === 1) continue;
        for (const choice of choices[k]!) {
          if (choice[0] === picked[k]![0] && choice[1] === picked[k]![1]) continue;
          const trial = [...picked];
          trial[k] = choice;
          const result = consider(trial);
          if (result.score > point.score) {
            point = result;
            picked = trial;
            improved = true;
          }
        }
      }
    }
    onProgress?.((r + 1) / starts.length);
  });
  return { ...best, method: 'coordinate-descent', evaluations, current };
}
