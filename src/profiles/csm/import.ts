/**
 * CSM ASC-3 plan → a new SPATT intersection.
 *
 * Ticks become tenths (an odd tick count has no exact tenth: it rounds and is reported). Barrier
 * numbers become barrier groups in running order from the barrier of ring 1's first enabled phase,
 * which is also where the controller's offset is measured, so each coordinated pattern's offset
 * is first taken as `firstPhaseStart` and then converted to the reference asked for. Controller
 * values SPATT does not model go into `extensions.csm`, so exporting the intersection again gives
 * them back.
 */
import { convertOffset, projectCycle } from '../../engine';
import { error, ticksToTenths, warning, type Intersection, type Issue, type MovementKind, type OffsetReference, type Pattern, type Phase, type ScheduleEntry, type VehicleRecall } from '../../model';
import { CSM_SLOT_NAMES, csmPlanSchema, type CsmPhase, type CsmPlan } from './format';
import type { CsmIntersectionExtension, CsmPhaseExtension } from './export';

const RECALL: Record<CsmPhase['recall'], VehicleRecall> = { NONE: 'none', MINIMUM: 'minimum', MAXIMUM: 'maximum', PEDESTRIAN: 'none', SOFT: 'soft' };
const KIND: Record<NonNullable<CsmPhase['movement']>, MovementKind> = { THROUGH: 'through', LEFT: 'left', PROTECTED_LEFT: 'left', RIGHT: 'right', PED: 'pedestrian' };

export interface CsmImportOptions {
  id: string;
  /** The offset reference the imported patterns should use. */
  offsetReference?: OffsetReference;
}

export type CsmImportResult = { ok: true; intersection: Intersection; issues: Issue[] } | { ok: false; issues: Issue[] };

/** Parses plan text (or an already-parsed value) and converts it. */
export function importCsm(input: string | unknown, options: CsmImportOptions): CsmImportResult {
  let raw: unknown = input;
  if (typeof input === 'string') {
    try {
      raw = JSON.parse(input);
    } catch (cause) {
      return { ok: false, issues: [error('csm.invalid-json', `Not valid JSON: ${(cause as Error).message}`, [])] };
    }
  }
  const parsed = csmPlanSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      issues: parsed.error.issues.map((issue) => error('csm.invalid-plan', `Not a CSM ASC-3 plan SPATT can read: ${issue.message}${issue.path.length > 0 ? ` (at ${issue.path.join('.')})` : ''}`, issue.path.map((p) => (typeof p === 'symbol' ? String(p) : p)))),
    };
  }
  return convertPlan(parsed.data, options);
}

function convertPlan(plan: CsmPlan, options: CsmImportOptions): CsmImportResult {
  const issues: Issue[] = [];
  const tenths = (ticks: number, path: Issue['path']): number => {
    const { tenths: value, exact } = ticksToTenths(ticks);
    if (!exact) {
      issues.push(warning('csm.odd-ticks', `${ticks} ticks is not a whole tenth of a second; rounded to ${(value / 10).toFixed(1)} s`, path));
    }
    return value;
  };

  const numbers = new Set(plan.phases.map((p) => p.number));
  if (numbers.size !== plan.phases.length) {
    return { ok: false, issues: [error('csm.duplicate-phase', 'The plan lists a phase more than once', ['phases'])] };
  }
  for (const [r, ring] of plan.rings.entries()) {
    const unknown = ring.filter((n) => !numbers.has(n));
    if (unknown.length > 0) {
      return { ok: false, issues: [error('csm.unknown-phase', `Ring ${r + 1} lists phase ${unknown.join(', ')}, which the plan does not define`, ['rings', r])] };
    }
  }

  const phases: Phase[] = [...plan.phases]
    .sort((a, b) => a.number - b.number)
    .map((csm, index) => {
      const at = (field: string): Issue['path'] => ['phases', index, field];
      const pedestrianService = csm.hasPedestrianSignals ?? (csm.walk !== undefined && csm.pedClear !== undefined && csm.walk > 0 && csm.pedClear > 0);
      const ext: CsmPhaseExtension = {};
      for (const key of ['movement', 'circuit', 'flash', 'delayedGreen', 'bikeMinGreen', 'permissivePhase'] as const) {
        if (csm[key] !== undefined) (ext as Record<string, unknown>)[key] = csm[key];
      }
      if (!pedestrianService) {
        if (csm.walk !== undefined) ext.walk = csm.walk;
        if (csm.pedClear !== undefined) ext.pedClear = csm.pedClear;
      }
      const phase: Phase = {
        number: csm.number,
        label: csm.label ?? `Phase ${csm.number}`,
        enabled: csm.enabled,
        movement: { approach: null, kind: csm.movement ? KIND[csm.movement] : 'through' },
        minGreen: tenths(csm.minGreen, at('minGreen')),
        passage: tenths(csm.passage, at('passage')),
        maxGreen1: tenths(csm.maxGreen, at('maxGreen')),
        maxGreen2: tenths(csm.maxGreen2, at('maxGreen2')),
        yellow: tenths(csm.yellow, at('yellow')),
        redClear: tenths(csm.redClear, at('redClear')),
        volumeDensity: {
          addedInitialPerActuation: tenths(csm.addedInitial, at('addedInitial')),
          maxInitial: tenths(csm.maxInitial, at('maxInitial')),
          timeBeforeReduction: tenths(csm.timeBeforeReduce, at('timeBeforeReduce')),
          timeToReduce: tenths(csm.timeToReduce, at('timeToReduce')),
          minGap: tenths(csm.minGap, at('minGap')),
        },
        recall: RECALL[csm.recall],
        pedestrian: {
          enabled: pedestrianService,
          walk: pedestrianService && csm.walk !== undefined ? tenths(csm.walk, at('walk')) : 0,
          clearance: pedestrianService && csm.pedClear !== undefined ? tenths(csm.pedClear, at('pedClear')) : 0,
          recall: csm.pedRecall || csm.recall === 'PEDESTRIAN',
          restInWalk: csm.restInWalk,
        },
        lockingDetector: csm.lockCall,
        dualEntry: csm.dualEntry,
        conditionalService: csm.conditionalService,
      };
      if (Object.keys(ext).length > 0) phase.extensions = { csm: ext };
      return phase;
    });

  // Barrier groups in running order, starting at the barrier of ring 1's first enabled phase.
  const barrierOf = new Map(plan.phases.map((p) => [p.number, p.barrier]));
  const enabled = new Set(plan.phases.filter((p) => p.enabled).map((p) => p.number));
  const barriers = [...new Set(plan.rings.flat().map((n) => barrierOf.get(n)!))].sort((a, b) => a - b);
  const firstPhase = plan.rings[0].find((n) => enabled.has(n));
  const start = firstPhase === undefined ? 0 : Math.max(0, barriers.indexOf(barrierOf.get(firstPhase)!));
  const order = [...barriers.slice(start), ...barriers.slice(0, start)];
  const rings = plan.rings.map((ring) => ({ groups: (order.length > 0 ? order : [0]).map((b) => ring.filter((n) => barrierOf.get(n) === b)) }));

  // Patterns, and the schedule that selects them.
  const listed = [...plan.patterns].sort((a, b) => a.slot - b.slot);
  const patterns: Pattern[] = [];
  const schedule: ScheduleEntry[] = [];
  const hasMax2 = phases.some((p) => p.enabled && p.maxGreen2 > 0);
  const toPattern = (csm: CsmPlan['patterns'][number]): Pattern => {
    const at = (field: string): Issue['path'] => ['patterns', csm.slot, field];
    const coordinated = csm.mode === 'COORDINATED';
    const splits: Record<string, number> = {};
    for (const [n, ticks] of Object.entries(csm.splits)) {
      if (numbers.has(Number(n))) splits[n] = tenths(ticks, ['patterns', csm.slot, 'splits', n]);
    }
    if (coordinated) {
      const missing = phases.filter((p) => p.enabled && splits[String(p.number)] === undefined).map((p) => p.number);
      if (missing.length > 0) {
        issues.push(warning('csm.even-share-splits', `Pattern slot ${csm.slot + 1}: phases ${missing.join(', ')} have no split (the controller shares the cycle evenly); enter their splits in SPATT`, at('splits')));
      }
    }
    return {
      id: `csm-slot-${csm.slot}`,
      name: csm.name ?? CSM_SLOT_NAMES[csm.slot] ?? `Slot ${csm.slot + 1}`,
      mode: coordinated ? 'coordinated' : 'free',
      cycle: tenths(csm.cycle, at('cycle')),
      offset: tenths(csm.offset, at('offset')) % Math.max(1, ticksToTenths(csm.cycle).tenths),
      offsetReference: 'firstPhaseStart',
      coordinatedPhases: csm.coordinatedPhases.filter((n) => numbers.has(n)),
      splits,
      sequence: null,
      maxGreen: coordinated && hasMax2 ? 'max2' : 'max1',
      forceOffMode: 'fixed',
    };
  };

  if (plan.schedule.enabled) {
    const seenHours = new Set<number>();
    for (const slot of [0, 1, 2, 3]) {
      const hour = plan.schedule.startHours[slot]!;
      if (seenHours.has(hour)) continue; // a lower slot starts at the same hour, so this one never runs
      seenHours.add(hour);
      const csm = listed.find((p) => p.slot === slot);
      if (!csm) {
        issues.push(warning('csm.slot-missing', `Slot ${slot + 1} starts at ${hour}:00 but the plan does not include it, so SPATT leaves it out of the schedule`, ['schedule', 'startHours', slot]));
        continue;
      }
      if (csm.mode === 'FREE') {
        schedule.push({ startMinute: hour * 60, patternId: null });
      } else {
        const pattern = toPattern(csm);
        patterns.push(pattern);
        schedule.push({ startMinute: hour * 60, patternId: pattern.id });
      }
    }
    schedule.sort((a, b) => a.startMinute - b.startMinute);
  } else {
    patterns.push(...listed.map(toPattern));
  }

  const extension: CsmIntersectionExtension = {};
  if (plan.overlaps) extension.overlaps = plan.overlaps;
  if (plan.preempts) extension.preempts = plan.preempts;
  if (plan.priority) extension.priority = plan.priority;

  const intersection: Intersection = {
    id: options.id,
    name: plan.name ?? 'CSM controller',
    notes: '',
    phases,
    rings,
    overlaps: [],
    preempts: [],
    patterns,
    schedule,
    ...(Object.keys(extension).length > 0 ? { extensions: { csm: extension } } : {}),
  };

  const reference = options.offsetReference ?? 'firstPhaseStart';
  if (reference !== 'firstPhaseStart') {
    for (const pattern of intersection.patterns) {
      if (pattern.mode !== 'coordinated') continue;
      const projection = projectCycle(intersection, pattern.id);
      if (projection.ok) {
        pattern.offset = convertOffset(projection.projection, reference);
        pattern.offsetReference = reference;
      } else {
        issues.push(warning('csm.offset-kept', `Pattern "${pattern.name}" has problems, so its offset stays measured to the start of the ring sequence`, ['patterns', intersection.patterns.indexOf(pattern), 'offsetReference']));
      }
    }
  }
  return { ok: true, intersection, issues };
}
