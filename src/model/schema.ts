/**
 * The SPATT project file format, as Zod schemas and the types inferred from them.
 *
 * The schemas check shape and ranges only. Whether a plan makes sense (rings reaching a barrier
 * together, splits long enough for their clearances) is `validate.ts`'s job, because those rules
 * report every problem with a path instead of rejecting the file.
 *
 * Every duration is integer tenths of a second (see units.ts).
 */
import { z } from 'zod';

export const PROJECT_SCHEMA_VERSION = 1;

export const MAX_PHASES = 16;
export const MAX_RINGS = 4;
/** One hour; anything longer is a typo, not a timing value. */
export const MAX_TENTHS = 36_000;

export const tenthsSchema = z.number().int().min(0).max(MAX_TENTHS);

export const phaseNumberSchema = z.number().int().min(1).max(MAX_PHASES);

const idSchema = z.string().min(1).max(64);

/**
 * Controller-profile data the general model does not interpret, keyed by profile
 * (e.g. `csm`). It is preserved on load and save so a round trip through SPATT is lossless.
 */
export const extensionsSchema = z.record(z.string(), z.unknown());

export const approachSchema = z.enum(['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW']);
export type Approach = z.infer<typeof approachSchema>;

export const movementKindSchema = z.enum(['through', 'left', 'right', 'pedestrian', 'other']);
export type MovementKind = z.infer<typeof movementKindSchema>;

export const vehicleRecallSchema = z.enum(['none', 'minimum', 'maximum', 'soft']);
export type VehicleRecall = z.infer<typeof vehicleRecallSchema>;

export const volumeDensitySchema = z.object({
  /** Seconds of initial green added per actuation during red. 0 = off. */
  addedInitialPerActuation: tenthsSchema,
  maxInitial: tenthsSchema,
  timeBeforeReduction: tenthsSchema,
  timeToReduce: tenthsSchema,
  minGap: tenthsSchema,
});
export type VolumeDensity = z.infer<typeof volumeDensitySchema>;

export const pedestrianSchema = z.object({
  enabled: z.boolean(),
  walk: tenthsSchema,
  clearance: tenthsSchema,
  recall: z.boolean(),
  restInWalk: z.boolean(),
});
export type Pedestrian = z.infer<typeof pedestrianSchema>;

export const phaseSchema = z.object({
  number: phaseNumberSchema,
  label: z.string().max(80),
  enabled: z.boolean(),
  movement: z.object({
    approach: approachSchema.nullable(),
    kind: movementKindSchema,
  }),
  minGreen: tenthsSchema,
  passage: tenthsSchema,
  maxGreen1: tenthsSchema,
  /** 0 = no Max 2 programmed. */
  maxGreen2: tenthsSchema,
  yellow: tenthsSchema,
  redClear: tenthsSchema,
  volumeDensity: volumeDensitySchema,
  recall: vehicleRecallSchema,
  pedestrian: pedestrianSchema,
  /** Detector memory: a call placed during red stays until served. */
  lockingDetector: z.boolean(),
  dualEntry: z.boolean(),
  conditionalService: z.boolean(),
  extensions: extensionsSchema.optional(),
});
export type Phase = z.infer<typeof phaseSchema>;

/**
 * A ring as barrier groups: `groups[g]` lists this ring's phases in barrier group `g`, in the
 * order they time. Every ring has the same number of groups; a group may be empty for a ring
 * that has nothing to time between those barriers.
 */
export const ringSchema = z.object({
  groups: z.array(z.array(phaseNumberSchema)),
});
export type Ring = z.infer<typeof ringSchema>;

export const overlapTypeSchema = z.enum(['normal', 'minusGreenYellow']);

export const overlapSchema = z.object({
  id: z.string().regex(/^[A-P]$/, 'Overlaps are lettered A to P'),
  label: z.string().max(80),
  enabled: z.boolean(),
  type: overlapTypeSchema,
  includedPhases: z.array(phaseNumberSchema),
  /** For minus-green-yellow: the phases whose green suppresses the overlap. */
  modifierPhases: z.array(phaseNumberSchema),
  trailGreen: tenthsSchema,
  /** 0 = use the terminating phase's yellow / red clear. */
  trailYellow: tenthsSchema,
  trailRedClear: tenthsSchema,
  extensions: extensionsSchema.optional(),
});
export type Overlap = z.infer<typeof overlapSchema>;

export const preemptSchema = z.object({
  number: z.number().int().min(1).max(10),
  label: z.string().max(80),
  enabled: z.boolean(),
  kind: z.enum(['railroad', 'emergency', 'other']),
  trackClearancePhases: z.array(phaseNumberSchema),
  trackClearance: tenthsSchema,
  dwellPhases: z.array(phaseNumberSchema),
  minDwell: tenthsSchema,
  exitPhases: z.array(phaseNumberSchema),
  extensions: extensionsSchema.optional(),
});
export type Preempt = z.infer<typeof preemptSchema>;

/**
 * What a pattern's offset is measured to, in the local cycle.
 * - `beginCoordGreen`: start of the first coordinated phase's green
 * - `beginCoordYellow`: start of the coordinated phase's yellow (end of green)
 * - `yield`: the coordinated phase's yield point
 * - `firstPhaseStart`: start of each ring's first active phase (the CSM ASC-3 reference)
 */
export const offsetReferenceSchema = z.enum(['beginCoordGreen', 'beginCoordYellow', 'yield', 'firstPhaseStart']);
export type OffsetReference = z.infer<typeof offsetReferenceSchema>;

export const patternSchema = z.object({
  id: idSchema,
  name: z.string().max(80),
  mode: z.enum(['free', 'coordinated']),
  cycle: tenthsSchema,
  offset: tenthsSchema,
  offsetReference: offsetReferenceSchema,
  coordinatedPhases: z.array(phaseNumberSchema),
  /** Split per phase number (as a string key), green + yellow + red clear. */
  splits: z.record(z.string().regex(/^([1-9]|1[0-6])$/), tenthsSchema),
  /** Phase order for this pattern (lead/lag); same ring and group membership as the base. */
  sequence: z.array(ringSchema).nullable(),
  maxGreen: z.enum(['max1', 'max2']),
  forceOffMode: z.enum(['fixed', 'floating']),
});
export type Pattern = z.infer<typeof patternSchema>;

export const scheduleEntrySchema = z.object({
  /** Minutes after midnight. */
  startMinute: z.number().int().min(0).max(1439),
  /** `null` runs free. */
  patternId: idSchema.nullable(),
});
export type ScheduleEntry = z.infer<typeof scheduleEntrySchema>;

export const intersectionSchema = z.object({
  id: idSchema,
  name: z.string().min(1).max(120),
  notes: z.string().max(10_000),
  phases: z.array(phaseSchema).max(MAX_PHASES),
  rings: z.array(ringSchema).min(1).max(MAX_RINGS),
  overlaps: z.array(overlapSchema).max(16),
  preempts: z.array(preemptSchema).max(10),
  patterns: z.array(patternSchema),
  schedule: z.array(scheduleEntrySchema),
  extensions: extensionsSchema.optional(),
});
export type Intersection = z.infer<typeof intersectionSchema>;

/** Placeholder until corridors are built; kept in the format so files need no migration then. */
export const corridorSchema = z.object({
  id: idSchema,
  name: z.string().min(1).max(120),
  intersectionIds: z.array(idSchema),
});
export type Corridor = z.infer<typeof corridorSchema>;

export const projectSchema = z.object({
  app: z.literal('spatt'),
  schemaVersion: z.literal(PROJECT_SCHEMA_VERSION),
  id: idSchema,
  name: z.string().min(1).max(120),
  notes: z.string().max(10_000),
  units: z.object({
    length: z.enum(['ft', 'm']),
    speed: z.enum(['mph', 'km/h']),
  }),
  intersections: z.array(intersectionSchema),
  corridors: z.array(corridorSchema),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type Project = z.infer<typeof projectSchema>;
