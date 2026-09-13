/**
 * Semantic validation: does a (schema-valid) intersection describe a plan a controller can run?
 *
 * Errors are plans a controller would reject or run wrongly. Warnings are legal but unusual
 * values worth a second look. Every rule has a stable code and a test in validate.test.ts.
 */
import { error, warning, type Issue } from './issues';
import type { Intersection, Pattern, Phase, Ring } from './schema';
import { formatSeconds, type Tenths } from './units';

const s = formatSeconds;

/** Yellow change range that does not draw a warning, per common practice (3–6 s). */
export const YELLOW_TYPICAL_MIN: Tenths = 30;
export const YELLOW_TYPICAL_MAX: Tenths = 60;
export const RED_CLEAR_TYPICAL_MAX: Tenths = 60;
/** MUTCD 4I.06: walk is normally at least 7 s (4 s where pedestrian volumes are low). */
export const WALK_TYPICAL_MIN: Tenths = 70;
export const CYCLE_TYPICAL_MAX: Tenths = 3000;

export function validateIntersection(intersection: Intersection): Issue[] {
  const issues: Issue[] = [];
  const phases = new Map<number, Phase>();

  intersection.phases.forEach((phase, index) => {
    if (phases.has(phase.number)) {
      issues.push(error('phase.duplicate-number', `Phase ${phase.number} is defined more than once`, ['phases', index, 'number']));
    } else {
      phases.set(phase.number, phase);
    }
    issues.push(...validatePhaseTiming(phase, ['phases', index]));
  });

  issues.push(...validateRings(intersection.rings, phases, ['rings']));
  const structureOk = !issues.some((i) => i.severity === 'error' && (i.code.startsWith('ring.') || i.code.startsWith('barrier.')));

  intersection.overlaps.forEach((overlap, index) => {
    const path = ['overlaps', index];
    if (intersection.overlaps.findIndex((o) => o.id === overlap.id) !== index) {
      issues.push(error('overlap.duplicate-id', `Overlap ${overlap.id} is defined more than once`, [...path, 'id']));
    }
    if (overlap.enabled && overlap.includedPhases.length === 0) {
      issues.push(error('overlap.no-included-phases', `Overlap ${overlap.id} has no included phases`, [...path, 'includedPhases']));
    }
    for (const field of ['includedPhases', 'modifierPhases'] as const) {
      for (const n of overlap[field]) {
        if (!phases.has(n)) {
          issues.push(error('overlap.unknown-phase', `Overlap ${overlap.id} refers to phase ${n}, which is not defined`, [...path, field]));
        }
      }
    }
  });

  intersection.preempts.forEach((preempt, index) => {
    for (const field of ['trackClearancePhases', 'dwellPhases', 'exitPhases'] as const) {
      for (const n of preempt[field]) {
        if (!phases.has(n)) {
          issues.push(error('preempt.unknown-phase', `Preempt ${preempt.number} refers to phase ${n}, which is not defined`, ['preempts', index, field]));
        }
      }
    }
  });

  const patternIds = new Set<string>();
  intersection.patterns.forEach((pattern, index) => {
    const path = ['patterns', index];
    if (patternIds.has(pattern.id)) {
      issues.push(error('pattern.duplicate-id', `Pattern id "${pattern.id}" is used more than once`, [...path, 'id']));
    }
    patternIds.add(pattern.id);
    if (structureOk) {
      issues.push(...validatePattern(pattern, intersection.rings, phases, path));
    }
  });

  const starts = new Set<number>();
  intersection.schedule.forEach((entry, index) => {
    const path = ['schedule', index];
    if (starts.has(entry.startMinute)) {
      issues.push(error('schedule.duplicate-start', `Two schedule entries start at ${formatClock(entry.startMinute)}`, [...path, 'startMinute']));
    }
    starts.add(entry.startMinute);
    if (entry.patternId !== null && !patternIds.has(entry.patternId)) {
      issues.push(error('schedule.unknown-pattern', `Schedule entry at ${formatClock(entry.startMinute)} uses a pattern that does not exist`, [...path, 'patternId']));
    }
  });

  return issues;
}

function validatePhaseTiming(phase: Phase, path: (string | number)[]): Issue[] {
  const issues: Issue[] = [];
  const n = phase.number;
  if (!phase.enabled) {
    return issues;
  }
  const vehicular = phase.movement.kind !== 'pedestrian';

  if (vehicular) {
    if (phase.maxGreen1 < phase.minGreen) {
      issues.push(error('phase.max-below-min', `Phase ${n}: Max 1 (${s(phase.maxGreen1)} s) is shorter than minimum green (${s(phase.minGreen)} s)`, [...path, 'maxGreen1']));
    }
    if (phase.maxGreen2 > 0 && phase.maxGreen2 < phase.minGreen) {
      issues.push(error('phase.max-below-min', `Phase ${n}: Max 2 (${s(phase.maxGreen2)} s) is shorter than minimum green (${s(phase.minGreen)} s)`, [...path, 'maxGreen2']));
    }
    if (phase.yellow === 0) {
      issues.push(error('phase.no-yellow', `Phase ${n} serves vehicles but has no yellow change interval`, [...path, 'yellow']));
    } else if (phase.yellow < YELLOW_TYPICAL_MIN || phase.yellow > YELLOW_TYPICAL_MAX) {
      issues.push(warning('phase.yellow-range', `Phase ${n}: yellow of ${s(phase.yellow)} s is outside the usual 3.0–6.0 s`, [...path, 'yellow']));
    }
    if (phase.redClear > RED_CLEAR_TYPICAL_MAX) {
      issues.push(warning('phase.red-clear-range', `Phase ${n}: red clearance of ${s(phase.redClear)} s is unusually long`, [...path, 'redClear']));
    }
  }

  const ped = phase.pedestrian;
  if (ped.enabled) {
    if (ped.walk === 0 || ped.clearance === 0) {
      issues.push(error('phase.ped-incomplete', `Phase ${n} has pedestrian service but no walk or clearance time`, [...path, 'pedestrian']));
    } else if (ped.walk < WALK_TYPICAL_MIN) {
      issues.push(warning('phase.walk-short', `Phase ${n}: walk of ${s(ped.walk)} s is below the usual 7 s minimum`, [...path, 'pedestrian', 'walk']));
    }
  } else if (!vehicular) {
    issues.push(error('phase.ped-incomplete', `Phase ${n} is a pedestrian phase with pedestrian service turned off`, [...path, 'pedestrian', 'enabled']));
  }
  return issues;
}

function validateRings(rings: Ring[], phases: Map<number, Phase>, path: (string | number)[]): Issue[] {
  const issues: Issue[] = [];
  const groupCount = rings[0]?.groups.length ?? 0;
  const seen = new Map<number, string>();

  if (groupCount === 0) {
    issues.push(error('barrier.no-groups', 'The ring structure has no barrier groups', path));
  }

  rings.forEach((ring, r) => {
    if (ring.groups.length !== groupCount) {
      issues.push(error('barrier.group-count-mismatch', `Ring ${r + 1} has ${ring.groups.length} barrier groups; ring 1 has ${groupCount}`, [...path, r, 'groups']));
    }
    ring.groups.forEach((group, g) => {
      group.forEach((n, i) => {
        const where = `ring ${r + 1}, barrier group ${g + 1}`;
        const previous = seen.get(n);
        if (previous !== undefined) {
          issues.push(error('ring.phase-repeated', `Phase ${n} appears in ${previous} and in ${where}`, [...path, r, 'groups', g, i]));
        } else {
          seen.set(n, where);
        }
        if (!phases.has(n)) {
          issues.push(error('ring.unknown-phase', `${capitalize(where)} lists phase ${n}, which is not defined`, [...path, r, 'groups', g, i]));
        }
      });
    });
  });

  for (let g = 0; g < groupCount; g++) {
    const active = rings.flatMap((ring) => ring.groups[g] ?? []).filter((n) => phases.get(n)?.enabled);
    if (active.length === 0) {
      issues.push(error('barrier.empty-group', `Barrier group ${g + 1} has no enabled phases in any ring`, [...path]));
    }
  }

  for (const [n, phase] of phases) {
    if (phase.enabled && !seen.has(n)) {
      issues.push(error('ring.phase-unassigned', `Phase ${n} is enabled but not placed in any ring`, [...path]));
    }
  }
  return issues;
}

/** The phase order a pattern runs: its own sequence if it has one, else the intersection's rings. */
export function effectiveSequence(pattern: Pattern, rings: Ring[]): Ring[] {
  return pattern.sequence ?? rings;
}

function validatePattern(pattern: Pattern, rings: Ring[], phases: Map<number, Phase>, path: (string | number)[]): Issue[] {
  const issues: Issue[] = [];
  const name = `Pattern "${pattern.name}"`;

  if (pattern.sequence !== null && !sameMembership(pattern.sequence, rings)) {
    issues.push(error('pattern.sequence-membership', `${name}: its phase sequence moves phases between rings or barrier groups; only the order within a group may change`, [...path, 'sequence']));
    return issues;
  }
  if (pattern.mode === 'free') {
    return issues;
  }

  const sequence = effectiveSequence(pattern, rings);
  const enabled = (n: number) => phases.get(n)?.enabled === true;
  const split = (n: number): Tenths => pattern.splits[String(n)] ?? 0;

  if (pattern.cycle === 0) {
    issues.push(error('pattern.cycle-missing', `${name} is coordinated but has no cycle length`, [...path, 'cycle']));
    return issues;
  }
  if (pattern.cycle > CYCLE_TYPICAL_MAX) {
    issues.push(warning('pattern.cycle-long', `${name}: a ${s(pattern.cycle)} s cycle is unusually long`, [...path, 'cycle']));
  }
  if (pattern.offset >= pattern.cycle) {
    issues.push(error('pattern.offset-range', `${name}: offset ${s(pattern.offset)} s must be less than the ${s(pattern.cycle)} s cycle`, [...path, 'offset']));
  }

  // Coordinated phases: at least one, enabled, one per ring, all in one barrier group.
  if (pattern.coordinatedPhases.length === 0) {
    issues.push(error('pattern.coord-missing', `${name} is coordinated but has no coordinated phase`, [...path, 'coordinatedPhases']));
  }
  const coordRings = new Set<number>();
  const coordGroups = new Set<number>();
  for (const n of pattern.coordinatedPhases) {
    const location = locate(sequence, n);
    if (!location || !enabled(n)) {
      issues.push(error('pattern.coord-invalid', `${name}: coordinated phase ${n} is not an enabled phase in the ring structure`, [...path, 'coordinatedPhases']));
      continue;
    }
    if (coordRings.has(location.ring)) {
      issues.push(error('pattern.coord-same-ring', `${name}: two coordinated phases are in ring ${location.ring + 1}`, [...path, 'coordinatedPhases']));
    }
    coordRings.add(location.ring);
    coordGroups.add(location.group);
  }
  if (coordGroups.size > 1) {
    issues.push(error('pattern.coord-different-barriers', `${name}: coordinated phases must be in the same barrier group`, [...path, 'coordinatedPhases']));
  }

  // Splits per phase.
  for (const [n, phase] of phases) {
    const value = split(n);
    const splitPath = [...path, 'splits', String(n)];
    if (!phase.enabled) {
      if (value > 0) {
        issues.push(warning('pattern.split-for-disabled-phase', `${name}: phase ${n} is disabled, so its ${s(value)} s split is ignored`, splitPath));
      }
      continue;
    }
    if (!locate(sequence, n)) {
      continue; // reported as ring.phase-unassigned
    }
    if (value === 0) {
      issues.push(error('pattern.split-missing', `${name}: phase ${n} has no split`, splitPath));
      continue;
    }
    const clearance = phase.yellow + phase.redClear;
    const vehicleMinimum = phase.movement.kind === 'pedestrian' ? clearance : phase.minGreen + clearance;
    if (value < vehicleMinimum) {
      issues.push(error('pattern.split-below-minimum', `${name}: phase ${n} split of ${s(value)} s is shorter than minimum green + yellow + red clear (${s(vehicleMinimum)} s)`, splitPath));
    }
    const ped = phase.pedestrian;
    if (ped.enabled) {
      const pedMinimum = ped.walk + ped.clearance + clearance;
      if (value < pedMinimum) {
        const message = `${name}: phase ${n} split of ${s(value)} s is shorter than walk + pedestrian clearance + yellow + red clear (${s(pedMinimum)} s)`;
        issues.push(ped.recall ? error('pattern.split-below-pedestrian', message, splitPath) : warning('pattern.split-below-pedestrian', `${message}; the pedestrian interval cannot be served in coordination`, splitPath));
      }
    }
  }

  // Rings reach every barrier together, and the barrier groups fill the cycle. A ring with no
  // enabled phase in a group waits at the barrier for that group, so it does not take part in
  // that group's comparison (split phasing leaves ring 2 empty on the side street).
  const groupCount = sequence[0]?.groups.length ?? 0;
  let cycleTotal = 0;
  for (let g = 0; g < groupCount; g++) {
    const totals = sequence
      .map((ring, r) => ({ r, phases: (ring.groups[g] ?? []).filter(enabled) }))
      .filter(({ phases: p }) => p.length > 0)
      .map(({ r, phases: p }) => ({ r, total: p.reduce((sum, n) => sum + split(n), 0) }));
    const first = totals[0];
    if (!first) {
      continue;
    }
    cycleTotal += first.total;
    const mismatch = totals.find((t) => t.total !== first.total);
    if (mismatch) {
      issues.push(error('pattern.barrier-misaligned', `${name}: in barrier group ${g + 1}, ring ${first.r + 1} splits total ${s(first.total)} s but ring ${mismatch.r + 1} totals ${s(mismatch.total)} s, so the rings would not reach the barrier together`, [...path, 'splits']));
    }
  }
  if (cycleTotal !== pattern.cycle) {
    issues.push(error('pattern.cycle-sum', `${name}: splits total ${s(cycleTotal)} s across the barrier groups, not the ${s(pattern.cycle)} s cycle`, [...path, 'splits']));
  }
  return issues;
}

function locate(rings: Ring[], phase: number): { ring: number; group: number } | undefined {
  for (let r = 0; r < rings.length; r++) {
    const groups = rings[r]?.groups ?? [];
    for (let g = 0; g < groups.length; g++) {
      if (groups[g]?.includes(phase)) {
        return { ring: r, group: g };
      }
    }
  }
  return undefined;
}

function sameMembership(a: Ring[], b: Ring[]): boolean {
  if (a.length !== b.length) {
    return false;
  }
  return a.every((ring, r) => {
    const other = b[r];
    if (!other || ring.groups.length !== other.groups.length) {
      return false;
    }
    return ring.groups.every((group, g) => {
      const otherGroup = other.groups[g] ?? [];
      return group.length === otherGroup.length && [...group].sort((x, y) => x - y).join() === [...otherGroup].sort((x, y) => x - y).join();
    });
  });
}

function formatClock(minute: number): string {
  return `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}
