/**
 * SPATT intersection → CSM ASC-3 plan.
 *
 * `checkCsm` lists what the controller cannot express (errors block export) and what it expresses
 * differently (warnings). `exportCsm` refuses a plan with errors, from either that check or
 * SPATT's own validation, and otherwise converts: tenths become ticks exactly, splits need no
 * rounding (validation already guarantees the rings meet at every barrier and fill the cycle),
 * barrier groups become barrier numbers in running order, and every offset is re-measured to the
 * controller's reference, the start of the barrier group holding ring 1's first phase.
 */
import { convertOffset, mod, projectCycle } from '../../engine';
import {
  effectiveSequence,
  error,
  hasErrors,
  tenthsToTicks,
  validateIntersection,
  warning,
  type Intersection,
  type Issue,
  type Pattern,
  type Phase,
  type Ring,
  type VehicleRecall,
} from '../../model';
import {
  CSM_FORMAT,
  CSM_FORMAT_VERSION,
  CSM_MAX_TICKS,
  CSM_PACKET_LIMIT_BYTES,
  CSM_PHASE_COUNT,
  csmFlashSchema,
  csmMovementSchema,
  type CsmPattern,
  type CsmPhase,
  type CsmPlan,
} from './format';
import { assignSlots } from './slots';

const RECALL: Record<VehicleRecall, CsmPhase['recall']> = { none: 'NONE', minimum: 'MINIMUM', maximum: 'MAXIMUM', soft: 'SOFT' };

/** What a phase's `extensions.csm` may hold: controller values SPATT does not model. */
export interface CsmPhaseExtension {
  movement?: CsmPhase['movement'];
  circuit?: number;
  flash?: CsmPhase['flash'];
  delayedGreen?: number;
  bikeMinGreen?: number;
  permissivePhase?: number;
  /** Walk and pedestrian clearance ticks of a phase SPATT has no pedestrian service for. */
  walk?: number;
  pedClear?: number;
}

/** What an intersection's `extensions.csm` may hold: controller data carried verbatim. */
export interface CsmIntersectionExtension {
  overlaps?: Record<string, unknown>[];
  preempts?: Record<string, unknown>[];
  priority?: Record<string, unknown>;
}

const isTicks = (v: unknown): v is number => Number.isInteger(v) && (v as number) >= 0 && (v as number) <= CSM_MAX_TICKS;

/** Reads the known keys of `extensions.csm`, dropping anything malformed. */
export function phaseExtension(phase: Phase): CsmPhaseExtension {
  const raw = (phase.extensions?.csm ?? {}) as Record<string, unknown>;
  const out: CsmPhaseExtension = {};
  if (csmMovementSchema.safeParse(raw.movement).success) out.movement = raw.movement as CsmPhaseExtension['movement'];
  if (Number.isInteger(raw.circuit) && (raw.circuit as number) >= -1) out.circuit = raw.circuit as number;
  if (csmFlashSchema.safeParse(raw.flash).success) out.flash = raw.flash as CsmPhaseExtension['flash'];
  for (const key of ['delayedGreen', 'bikeMinGreen', 'walk', 'pedClear'] as const) {
    if (isTicks(raw[key])) out[key] = raw[key];
  }
  if (Number.isInteger(raw.permissivePhase) && (raw.permissivePhase as number) >= 0 && (raw.permissivePhase as number) <= CSM_PHASE_COUNT) out.permissivePhase = raw.permissivePhase as number;
  return out;
}

function intersectionExtension(intersection: Intersection): CsmIntersectionExtension {
  const raw = (intersection.extensions?.csm ?? {}) as Record<string, unknown>;
  const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
  return {
    overlaps: Array.isArray(raw.overlaps) ? raw.overlaps.filter(isObject) : undefined,
    preempts: Array.isArray(raw.preempts) ? raw.preempts.filter(isObject) : undefined,
    priority: isObject(raw.priority) ? raw.priority : undefined,
  };
}

const TIMED_FIELDS = ['minGreen', 'passage', 'maxGreen1', 'maxGreen2', 'yellow', 'redClear'] as const;

/** The one phase order every exported pattern shares, or `null` when they differ. */
function sharedSequence(intersection: Intersection, patterns: Pattern[]): Ring[] | null {
  const sequences = patterns.map((p) => JSON.stringify(effectiveSequence(p, intersection.rings)));
  const first = sequences[0] ?? JSON.stringify(intersection.rings);
  return sequences.every((s) => s === first) ? (JSON.parse(first) as Ring[]) : null;
}

export function checkCsm(intersection: Intersection): Issue[] {
  const slots = assignSlots(intersection);
  const issues = [...slots.issues];
  const exported = slots.slots.flatMap((s) => (s.pattern ? [s.pattern] : []));
  const phases = new Map(intersection.phases.map((p) => [p.number, p]));

  intersection.phases.forEach((phase, index) => {
    if (phase.number > CSM_PHASE_COUNT) {
      issues.push(error('csm.phase-number', `The controller has phases 1 to ${CSM_PHASE_COUNT}; phase ${phase.number} cannot be exported`, ['phases', index, 'number']));
    }
    if (!phase.enabled) return;
    for (const field of TIMED_FIELDS) {
      if (tenthsToTicks(phase[field]) > CSM_MAX_TICKS) {
        issues.push(error('csm.value-too-long', `Phase ${phase.number}: the controller's longest time is 600 s`, ['phases', index, field]));
      }
    }
    if (phase.pedestrian.enabled) {
      for (const field of ['walk', 'clearance'] as const) {
        if (tenthsToTicks(phase.pedestrian[field]) > CSM_MAX_TICKS) {
          issues.push(error('csm.value-too-long', `Phase ${phase.number}: the controller's longest time is 600 s`, ['phases', index, 'pedestrian', field]));
        }
      }
    }
    if (phase.recall === 'maximum') {
      issues.push(warning('csm.max-recall', `Phase ${phase.number}: the controller treats maximum recall like minimum recall`, ['phases', index, 'recall']));
    }
  });

  if (intersection.rings.length > 2) {
    issues.push(error('csm.too-many-rings', `The controller has two rings; this intersection has ${intersection.rings.length}`, ['rings']));
  }
  const sequence = sharedSequence(intersection, exported);
  if (!sequence) {
    issues.push(error('csm.sequence-per-pattern', 'The controller runs one phase order for every pattern; give the exported patterns the same lead/lag order', ['patterns']));
  } else {
    if (!(sequence[0]?.groups.flat() ?? []).some((n) => phases.get(n)?.enabled)) {
      issues.push(error('csm.ring-1-empty', 'The controller times from ring 1, so ring 1 needs an enabled phase', ['rings', 0]));
    }
    const groupCount = sequence[0]?.groups.length ?? 0;
    if (groupCount > 2) {
      issues.push(warning('csm.barrier-groups', `${groupCount} barrier groups run correctly, but the controller's screen labels only barriers A and B, and flash alternates between even and odd groups`, ['rings']));
    }
  }

  intersection.patterns.forEach((pattern, index) => {
    if (!exported.includes(pattern)) return;
    if (tenthsToTicks(pattern.cycle) > CSM_MAX_TICKS) {
      issues.push(error('csm.value-too-long', `Pattern "${pattern.name}": the controller's longest cycle is 600 s`, ['patterns', index, 'cycle']));
    }
    if (pattern.mode !== 'coordinated') return;
    if (pattern.forceOffMode === 'floating') {
      issues.push(warning('csm.floating-force-off', `Pattern "${pattern.name}": the controller only uses fixed force-offs`, ['patterns', index, 'forceOffMode']));
    }
    const max2Phases = intersection.phases.filter((p) => p.enabled && p.maxGreen2 > 0);
    if (pattern.maxGreen === 'max1' && max2Phases.length > 0) {
      issues.push(warning('csm.max2-in-coordination', `Pattern "${pattern.name}" uses Max 1, but the controller uses Max 2 in coordination for phases that have one (${max2Phases.map((p) => p.number).join(', ')})`, ['patterns', index, 'maxGreen']));
    }
  });

  const extension = intersectionExtension(intersection);
  if (intersection.overlaps.length > 0 && !extension.overlaps) {
    issues.push(warning('csm.overlaps-not-exported', 'Overlaps are not exported; set them up on the controller', ['overlaps']));
  }
  if (intersection.preempts.length > 0 && !extension.preempts) {
    issues.push(warning('csm.preempts-not-exported', 'Preempts are not exported; set them up on the controller', ['preempts']));
  }
  return issues;
}

export type CsmExportResult = { ok: true; plan: CsmPlan; text: string; issues: Issue[] } | { ok: false; issues: Issue[] };

export function exportCsm(intersection: Intersection, generator = 'SPATT'): CsmExportResult {
  const validation = validateIntersection(intersection).filter((i) => i.severity === 'error');
  const issues = [...validation, ...checkCsm(intersection)];
  if (hasErrors(issues)) {
    return { ok: false, issues };
  }

  const slots = assignSlots(intersection);
  const exported = slots.slots.flatMap((s) => (s.pattern ? [s.pattern] : []));
  const sequence = sharedSequence(intersection, exported)!;
  const barrierOf = new Map<number, number>();
  sequence.forEach((ring) => ring.groups.forEach((group, g) => group.forEach((n) => barrierOf.set(n, g))));
  const enabled = (n: number) => intersection.phases.some((p) => p.number === n && p.enabled);
  const firstGroup = sequence[0]!.groups.findIndex((group) => group.some(enabled));

  const phases: CsmPhase[] = [...intersection.phases]
    .sort((a, b) => a.number - b.number)
    .map((phase) => {
      const ext = phaseExtension(phase);
      const ped = phase.pedestrian;
      const out: CsmPhase = {
        number: phase.number,
        enabled: phase.enabled && barrierOf.has(phase.number),
        barrier: barrierOf.get(phase.number) ?? 0,
        minGreen: tenthsToTicks(phase.minGreen),
        passage: tenthsToTicks(phase.passage),
        maxGreen: tenthsToTicks(phase.maxGreen1),
        maxGreen2: tenthsToTicks(phase.maxGreen2),
        yellow: tenthsToTicks(phase.yellow),
        redClear: tenthsToTicks(phase.redClear),
        addedInitial: tenthsToTicks(phase.volumeDensity.addedInitialPerActuation),
        maxInitial: tenthsToTicks(phase.volumeDensity.maxInitial),
        minGap: tenthsToTicks(phase.volumeDensity.minGap),
        timeBeforeReduce: tenthsToTicks(phase.volumeDensity.timeBeforeReduction),
        timeToReduce: tenthsToTicks(phase.volumeDensity.timeToReduce),
        recall: RECALL[phase.recall],
        pedRecall: ped.recall,
        restInWalk: ped.restInWalk,
        dualEntry: phase.dualEntry,
        conditionalService: phase.conditionalService,
        lockCall: phase.lockingDetector,
        label: phase.label || undefined,
      };
      if (ped.enabled) {
        out.walk = tenthsToTicks(ped.walk);
        out.pedClear = tenthsToTicks(ped.clearance);
      } else {
        if (ext.walk !== undefined) out.walk = ext.walk;
        if (ext.pedClear !== undefined) out.pedClear = ext.pedClear;
      }
      for (const key of ['movement', 'circuit', 'flash', 'delayedGreen', 'bikeMinGreen', 'permissivePhase'] as const) {
        if (ext[key] !== undefined) (out as Record<string, unknown>)[key] = ext[key];
      }
      return out;
    });

  const patterns: CsmPattern[] = slots.slots.map(({ slot, pattern }) => {
    const splits = (source: Pattern) => Object.fromEntries(Object.entries(source.splits).filter(([n, v]) => v > 0 && Number(n) <= CSM_PHASE_COUNT).map(([n, v]) => [n, tenthsToTicks(v)]));
    if (pattern === null) {
      return { slot, mode: 'FREE', cycle: 1800, offset: 0, coordinatedPhases: [], splits: {} };
    }
    if (pattern.mode !== 'coordinated') {
      const cycle = pattern.cycle > 0 ? tenthsToTicks(pattern.cycle) : 1800;
      return { slot, mode: 'FREE', cycle, offset: Math.min(tenthsToTicks(pattern.offset), cycle - 1), coordinatedPhases: [...pattern.coordinatedPhases], splits: splits(pattern), name: pattern.name };
    }
    const projection = projectCycle(intersection, pattern.id);
    if (!projection.ok) {
      throw new Error(`Pattern "${pattern.name}" passed validation but cannot be projected`);
    }
    const p = projection.projection;
    const groupStart = firstGroup <= 0 ? 0 : p.barriers[firstGroup - 1]!;
    return {
      slot,
      mode: 'COORDINATED',
      cycle: tenthsToTicks(p.cycle),
      offset: tenthsToTicks(mod(convertOffset(p, 'firstPhaseStart') + groupStart, p.cycle)),
      coordinatedPhases: [...pattern.coordinatedPhases],
      splits: splits(pattern),
      name: pattern.name,
    };
  });

  const ext = intersectionExtension(intersection);
  const plan: CsmPlan = {
    format: CSM_FORMAT,
    formatVersion: CSM_FORMAT_VERSION,
    generator,
    name: intersection.name,
    phases,
    rings: [sequence[0]?.groups.flat() ?? [], sequence[1]?.groups.flat() ?? []],
    patterns,
    schedule: { enabled: slots.scheduleEnabled, startHours: slots.startHours },
    ...(ext.overlaps ? { overlaps: ext.overlaps } : {}),
    ...(ext.preempts ? { preempts: ext.preempts } : {}),
    ...(ext.priority ? { priority: ext.priority } : {}),
  };
  const text = `${JSON.stringify(plan, null, 2)}\n`;
  if (new TextEncoder().encode(JSON.stringify(plan)).length > CSM_PACKET_LIMIT_BYTES) {
    issues.push(warning('csm.plan-too-large', 'The plan is larger than one game network packet, so pasting it into the controller needs the file import instead', []));
  }
  return { ok: true, plan, text, issues };
}
