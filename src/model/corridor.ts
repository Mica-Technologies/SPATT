/**
 * Corridors: validation, the through-phase suggestion, and the edits that keep corridors
 * consistent when intersections and patterns change.
 */
import { error, warning, type Issue } from './issues';
import { oppositeDirection } from './measures';
import type { Approach, Corridor, CorridorPlan, CorridorStop, Intersection, Project } from './schema';

/** A default link: 300 m at 13.4 m/s (about 30 mph / 48 km/h). */
export const DEFAULT_LINK = { distance: 300, speed: 13.4 } as const;

/**
 * The phases carrying through traffic each way: enabled through phases whose direction of travel
 * is the corridor's outbound direction, and those travelling the opposite way.
 */
export function suggestThroughPhases(intersection: Intersection, outbound: Approach): { outboundPhases: number[]; inboundPhases: number[] } {
  const through = (direction: Approach) =>
    intersection.phases.filter((p) => p.enabled && p.movement.kind === 'through' && p.movement.approach === direction).map((p) => p.number);
  return { outboundPhases: through(outbound), inboundPhases: through(oppositeDirection(outbound)) };
}

export function newCorridorStop(intersection: Intersection, outbound: Approach, first: boolean): CorridorStop {
  return {
    intersectionId: intersection.id,
    distance: first ? 0 : DEFAULT_LINK.distance,
    speed: { outbound: DEFAULT_LINK.speed, inbound: DEFAULT_LINK.speed },
    speedLimit: null,
    ...suggestThroughPhases(intersection, outbound),
  };
}

/** The pattern a new plan picks for an intersection: its first coordinated pattern, if any. */
export function defaultPlanPattern(intersection: Intersection): string | null {
  return intersection.patterns.find((p) => p.mode === 'coordinated')?.id ?? null;
}

export function newCorridorPlan(id: string, name: string, intersections: Intersection[]): CorridorPlan {
  return {
    id,
    name,
    patterns: Object.fromEntries(intersections.map((i) => [i.id, defaultPlanPattern(i)])),
    weights: { outbound: 1, inbound: 1 },
  };
}

export function validateCorridor(corridor: Corridor, project: Project, path: Issue['path']): Issue[] {
  const issues: Issue[] = [];
  const name = `Corridor "${corridor.name}"`;
  const intersections = new Map(project.intersections.map((i) => [i.id, i]));
  const seen = new Set<string>();

  if (corridor.stops.length < 2) {
    issues.push(warning('corridor.too-few-stops', `${name} needs at least two intersections to coordinate`, [...path, 'stops']));
  }
  corridor.stops.forEach((stop, k) => {
    const at = [...path, 'stops', k];
    const intersection = intersections.get(stop.intersectionId);
    if (!intersection) {
      issues.push(error('corridor.unknown-intersection', `${name} refers to an intersection that does not exist`, [...at, 'intersectionId']));
      return;
    }
    if (seen.has(stop.intersectionId)) {
      issues.push(error('corridor.repeated-intersection', `${name} lists ${intersection.name} more than once`, [...at, 'intersectionId']));
    }
    seen.add(stop.intersectionId);
    if (k > 0) {
      if (stop.distance <= 0) {
        issues.push(error('corridor.distance-missing', `${name}: the distance to ${intersection.name} is not set`, [...at, 'distance']));
      }
      for (const direction of ['outbound', 'inbound'] as const) {
        if (stop.speed[direction] <= 0) {
          issues.push(error('corridor.speed-missing', `${name}: the ${direction} speed to ${intersection.name} is not set`, [...at, 'speed', direction]));
        }
      }
    }
    const defined = new Set(intersection.phases.map((p) => p.number));
    for (const key of ['outboundPhases', 'inboundPhases'] as const) {
      const unknown = stop[key].filter((n) => !defined.has(n));
      if (unknown.length > 0) {
        issues.push(error('corridor.unknown-phase', `${name}: ${intersection.name} has no phase ${unknown.join(', ')}`, [...at, key]));
      }
    }
    if (stop.outboundPhases.length === 0 && stop.inboundPhases.length === 0) {
      issues.push(warning('corridor.no-through-phases', `${name}: no through phases are chosen at ${intersection.name}, so it cannot be part of a green band`, [...at, 'outboundPhases']));
    }
  });

  const planIds = new Set<string>();
  corridor.plans.forEach((plan, p) => {
    const at = [...path, 'plans', p];
    const planName = `${name}, plan "${plan.name}"`;
    if (planIds.has(plan.id)) {
      issues.push(error('corridor.plan-duplicate-id', `${planName}: plan id "${plan.id}" is used more than once`, [...at, 'id']));
    }
    planIds.add(plan.id);
    const cycles = new Map<number, string[]>();
    for (const stop of corridor.stops) {
      const intersection = intersections.get(stop.intersectionId);
      if (!intersection) continue;
      const patternId = plan.patterns[stop.intersectionId] ?? null;
      if (patternId === null) {
        issues.push(warning('corridor.plan-missing-intersection', `${planName} leaves ${intersection.name} out`, [...at, 'patterns', stop.intersectionId]));
        continue;
      }
      const pattern = intersection.patterns.find((x) => x.id === patternId);
      if (!pattern) {
        issues.push(error('corridor.plan-unknown-pattern', `${planName} uses a pattern ${intersection.name} does not have`, [...at, 'patterns', stop.intersectionId]));
        continue;
      }
      if (pattern.mode !== 'coordinated') {
        issues.push(warning('corridor.plan-free-pattern', `${planName}: ${intersection.name}'s pattern "${pattern.name}" runs free, so it cannot progress`, [...at, 'patterns', stop.intersectionId]));
        continue;
      }
      cycles.set(pattern.cycle, [...(cycles.get(pattern.cycle) ?? []), intersection.name]);
    }
    if (cycles.size > 1) {
      const list = [...cycles.entries()].map(([cycle, names]) => `${(cycle / 10).toFixed(1)} s (${names.join(', ')})`).join('; ');
      issues.push(warning('corridor.plan-cycle-mismatch', `${planName}: the intersections run different cycles, so the green bands do not repeat together: ${list}`, [...at, 'patterns']));
    }
  });
  return issues;
}

/** Removes an intersection from every corridor (its stops and plan entries). */
export function removeIntersectionFromCorridors(project: Project, intersectionId: string): void {
  for (const corridor of project.corridors) {
    corridor.stops = corridor.stops.filter((s) => s.intersectionId !== intersectionId);
    if (corridor.stops[0]) corridor.stops[0].distance = 0;
    for (const plan of corridor.plans) delete plan.patterns[intersectionId];
  }
}

/** Clears plan entries that point at a deleted pattern. */
export function removePatternFromCorridors(project: Project, intersectionId: string, patternId: string): void {
  for (const plan of project.corridors.flatMap((c) => c.plans)) {
    if (plan.patterns[intersectionId] === patternId) plan.patterns[intersectionId] = null;
  }
}
