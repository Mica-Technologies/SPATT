/**
 * Corridor progression: where each intersection's through phases are green on the shared clock,
 * and the green band a vehicle travelling at the progression speed can ride through every signal
 * in each direction.
 *
 * Times are tenths of a second on the system clock (mod the common cycle). Travel times come from
 * distances and speeds and are generally fractional; bandwidths are rounded to the tenth.
 */
import { intersect, longestRun, normalize, shift, type Span } from './circular';
import { projectCycle, systemSpans, type CycleProjection } from './projection';
import type { Corridor, CorridorPlan, Intersection, Project, Tenths } from '../model';

export type Direction = 'outbound' | 'inbound';

export interface StopTiming {
  intersectionId: string;
  name: string;
  /** Metres from the first stop along the corridor. */
  position: number;
  /** The plan's coordinated pattern here, projected; `null` if the stop is not timed by the plan. */
  projection: CycleProjection | null;
  /** Why the stop is not timed, when `projection` is null. */
  reason: 'not-in-plan' | 'unknown-pattern' | 'free' | 'invalid' | null;
  /** System-time spans (on this stop's own cycle) when the direction's through phases are green. */
  green: Record<Direction, Span[]>;
}

export interface Band {
  /** Green band width, tenths; 0 when no vehicle gets through; `null` when not computable. */
  bandwidth: Tenths | null;
  /** Bandwidth / cycle. */
  efficiency: number | null;
  /** When the band leaves its first stop (outbound: the first stop; inbound: the last), system time. */
  start: number | null;
  /** Travel time (tenths) from the band's first stop to each stop, in stop order. */
  arrival: number[];
}

export interface Progression {
  /** The cycle every timed stop shares, or `null` when they differ (or none is timed). */
  cycle: Tenths | null;
  stops: StopTiming[];
  bands: Record<Direction, Band>;
}

/** Offsets (tenths, in each pattern's own reference) to use instead of the patterns' own. */
export type OffsetOverrides = Readonly<Record<string, Tenths>>;

function withOffset(intersection: Intersection, patternId: string, offset: Tenths | undefined): Intersection {
  if (offset === undefined) return intersection;
  return { ...intersection, patterns: intersection.patterns.map((p) => (p.id === patternId ? { ...p, offset } : p)) };
}

function greenSpans(projection: CycleProjection, phases: readonly number[]): Span[] {
  const wanted = new Set(phases);
  const spans = projection.rings.flat().filter((i) => wanted.has(i.phase)).flatMap((i) => systemSpans(projection, i.greenStart, i.yellowStart));
  return normalize(spans, projection.cycle);
}

/** Cumulative travel times (tenths) from the first stop, for one direction's speeds. */
function travelFromFirst(corridor: Corridor, direction: Direction): number[] {
  let elapsed = 0;
  return corridor.stops.map((stop, k) => {
    if (k > 0) {
      const speed = stop.speed[direction];
      elapsed += speed > 0 ? (stop.distance / speed) * 10 : Number.POSITIVE_INFINITY;
    }
    return elapsed;
  });
}

export function analyzeProgression(project: Project, corridor: Corridor, plan: CorridorPlan, overrides: OffsetOverrides = {}): Progression {
  const intersections = new Map(project.intersections.map((i) => [i.id, i]));
  let position = 0;
  const stops: StopTiming[] = corridor.stops.map((stop, k) => {
    if (k > 0) position += stop.distance;
    const intersection = intersections.get(stop.intersectionId);
    const base: StopTiming = { intersectionId: stop.intersectionId, name: intersection?.name ?? 'Missing intersection', position, projection: null, reason: null, green: { outbound: [], inbound: [] } };
    const patternId = plan.patterns[stop.intersectionId] ?? null;
    if (!intersection || patternId === null) return { ...base, reason: 'not-in-plan' };
    const pattern = intersection.patterns.find((p) => p.id === patternId);
    if (!pattern) return { ...base, reason: 'unknown-pattern' };
    if (pattern.mode !== 'coordinated') return { ...base, reason: 'free' };
    const result = projectCycle(withOffset(intersection, patternId, overrides[stop.intersectionId]), patternId);
    if (!result.ok) return { ...base, reason: 'invalid' };
    return { ...base, projection: result.projection, green: { outbound: greenSpans(result.projection, stop.outboundPhases), inbound: greenSpans(result.projection, stop.inboundPhases) } };
  });

  const cycles = new Set(stops.flatMap((s) => (s.projection ? [s.projection.cycle] : [])));
  const cycle = cycles.size === 1 ? [...cycles][0]! : null;

  const band = (direction: Direction): Band => {
    const fromFirst = travelFromFirst(corridor, direction);
    const last = fromFirst.at(-1) ?? 0;
    // Outbound starts at the first stop; inbound at the last, travelling back.
    const arrival = direction === 'outbound' ? fromFirst : fromFirst.map((t) => last - t);
    const empty: Band = { bandwidth: null, efficiency: null, start: null, arrival };
    const timed = corridor.stops.flatMap((stop, k) => {
      const timing = stops[k]!;
      return timing.projection && stop[direction === 'outbound' ? 'outboundPhases' : 'inboundPhases'].length > 0 ? [{ k, green: timing.green[direction] }] : [];
    });
    if (cycle === null || timed.length === 0 || arrival.some((t) => !Number.isFinite(t))) return empty;
    let band: Span[] = [[0, cycle]];
    for (const { k, green } of timed) {
      band = intersect(band, shift(green, -arrival[k]!, cycle));
    }
    const run = longestRun(band, cycle);
    const bandwidth = run ? Math.round(run.length) : 0;
    return { bandwidth, efficiency: bandwidth / cycle, start: run ? run.start : null, arrival };
  };

  return { cycle, stops, bands: { outbound: band('outbound'), inbound: band('inbound') } };
}
