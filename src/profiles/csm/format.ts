/**
 * The CSM ASC-3 timing-plan JSON (`csm-asc3-plan`, format version 1): what SPATT exports for, and
 * imports from, the City Super Mod's Advanced signal controller.
 *
 * The format is **CSM-native**: every duration is in game ticks (20 per second), names follow the
 * controller's own fields and enum constants, and the offset is measured the controller's way
 * (to the start of its first barrier group). All conversion from SPATT's model happens in this
 * profile, so the mod's side stays a plain serializer of its `tcAdv` NBT.
 *
 * **Absent means keep.** Optional fields describe controller hardware or settings SPATT does not
 * model (a phase's signal circuit, its flash override, overlaps, preempts...). When the controller
 * imports a plan, it keeps its own value for every optional field the plan leaves out, and every
 * pattern slot the plan does not list. A plan made in SPATT can be dropped onto a wired controller.
 *
 * The frozen JSON Schema is `docs/profiles/csm-asc3-plan.schema.json`, generated from this file.
 */
import { z } from 'zod';

export const CSM_FORMAT = 'csm-asc3-plan';
export const CSM_FORMAT_VERSION = 1;

/** Every controller time value is clamped to 0..12000 ticks (600 s) by the mod. */
export const CSM_MAX_TICKS = 12_000;
export const CSM_PHASE_COUNT = 8;
export const CSM_SLOT_COUNT = 4;
/** `TrafficTimeOfDaySchedule.SLOT_NAMES`. */
export const CSM_SLOT_NAMES = ['AM Peak', 'Midday', 'PM Peak', 'Night'] as const;
/** A client-to-server custom payload in Minecraft 1.12.2 is capped at 32767 bytes. */
export const CSM_PACKET_LIMIT_BYTES = 32_767;

const ticks = z.number().int().min(0).max(CSM_MAX_TICKS);
const phaseNumber = z.number().int().min(1).max(CSM_PHASE_COUNT);
const phaseList = z.array(phaseNumber);
/** Opaque controller data SPATT carries without interpreting (overlaps, preempts, priority). */
const opaque = z.record(z.string(), z.unknown());

export const csmRecallSchema = z.enum(['NONE', 'MINIMUM', 'MAXIMUM', 'PEDESTRIAN', 'SOFT']);
export const csmMovementSchema = z.enum(['THROUGH', 'LEFT', 'PROTECTED_LEFT', 'RIGHT', 'PED']);
export const csmFlashSchema = z.enum(['AUTO', 'YELLOW', 'RED', 'DARK']);
export const csmModeSchema = z.enum(['FREE', 'COORDINATED']);

export const csmPhaseSchema = z.object({
  number: phaseNumber,
  enabled: z.boolean(),
  /** Barrier group, 0-based, in the order the groups run from local zero. */
  barrier: z.number().int().min(0).max(CSM_PHASE_COUNT - 1),
  minGreen: ticks,
  passage: ticks,
  maxGreen: ticks,
  /** 0 = no Max 2. The controller uses Max 2 whenever the running pattern is coordinated. */
  maxGreen2: ticks,
  yellow: ticks,
  redClear: ticks,
  addedInitial: ticks,
  maxInitial: ticks,
  minGap: ticks,
  timeBeforeReduce: ticks,
  timeToReduce: ticks,
  recall: csmRecallSchema,
  pedRecall: z.boolean(),
  restInWalk: z.boolean(),
  dualEntry: z.boolean(),
  conditionalService: z.boolean(),
  lockCall: z.boolean(),
  // Optional: absent = the controller keeps its own value.
  walk: ticks.optional(),
  pedClear: ticks.optional(),
  movement: csmMovementSchema.optional(),
  /** 0-based signal circuit; -1 = none. */
  circuit: z.number().int().min(-1).optional(),
  flash: csmFlashSchema.optional(),
  delayedGreen: ticks.optional(),
  bikeMinGreen: ticks.optional(),
  /** Flashing-yellow-arrow permissive phase; 0 = protected only. */
  permissivePhase: z.number().int().min(0).max(CSM_PHASE_COUNT).optional(),
  // Informational: written by the controller's export, ignored by its import.
  /** Whether the phase's circuit has pedestrian signals. */
  hasPedestrianSignals: z.boolean().optional(),
  /** A human label (SPATT's); the controller has none and ignores it. */
  label: z.string().max(80).optional(),
});
export type CsmPhase = z.infer<typeof csmPhaseSchema>;

export const csmPatternSchema = z.object({
  slot: z.number().int().min(0).max(CSM_SLOT_COUNT - 1),
  mode: csmModeSchema,
  cycle: z.number().int().min(1).max(CSM_MAX_TICKS),
  /** Ticks from world-clock zero (mod cycle) to the start of the first barrier group. */
  offset: ticks,
  coordinatedPhases: phaseList,
  /** Split per phase number, in ticks; phases left out get the controller's even share. */
  splits: z.record(z.string().regex(/^[1-8]$/), ticks),
  /** A human name (SPATT's); the controller has none and ignores it. */
  name: z.string().max(80).optional(),
});
export type CsmPattern = z.infer<typeof csmPatternSchema>;

export const csmPlanSchema = z.object({
  format: z.literal(CSM_FORMAT),
  formatVersion: z.literal(CSM_FORMAT_VERSION),
  /** What wrote the plan, e.g. `SPATT` or `CSM`. Informational. */
  generator: z.string().max(120).optional(),
  /** Intersection or controller name. Informational. */
  name: z.string().max(120).optional(),
  /** The controller's phases. Phases it has but the plan does not list are disabled. */
  phases: z.array(csmPhaseSchema).max(CSM_PHASE_COUNT),
  /** Ring 1 and ring 2 phase sequences (lead/lag is the order). */
  rings: z.tuple([phaseList, phaseList]),
  /** Pattern slots; slots not listed keep the controller's own. */
  patterns: z.array(csmPatternSchema).max(CSM_SLOT_COUNT),
  /** Time-of-day selection: the slot whose start hour most recently passed runs. */
  schedule: z.object({
    enabled: z.boolean(),
    /** Start hour (0-23) of slots 0..3. */
    startHours: z.tuple([z.number().int().min(0).max(23), z.number().int().min(0).max(23), z.number().int().min(0).max(23), z.number().int().min(0).max(23)]),
  }),
  // Optional, carried verbatim; absent = the controller keeps its own.
  overlaps: z.array(opaque).optional(),
  preempts: z.array(opaque).optional(),
  priority: opaque.optional(),
});
export type CsmPlan = z.infer<typeof csmPlanSchema>;

/** The JSON Schema of the format, as committed to `docs/profiles/csm-asc3-plan.schema.json`. */
export function csmPlanJsonSchema(): Record<string, unknown> {
  return {
    $id: 'https://mica-technologies.github.io/SPATT/profiles/csm-asc3-plan.schema.json',
    title: 'CSM ASC-3 timing plan',
    description: 'A traffic signal timing plan for the City Super Mod ASC-3 controller, in game ticks. Optional fields left out keep the controller’s own values on import.',
    ...z.toJSONSchema(csmPlanSchema, { target: 'draft-2020-12', io: 'input' }),
  };
}
