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

/**
 * 2: corridors gained stops, directions and timing plans; CSM units.
 * 3: intersections gained lane groups, capacity settings and volume count sets; patterns link a count.
 */
export const PROJECT_SCHEMA_VERSION = 3;

export const lengthUnitSchema = z.enum(['ft', 'm', 'block']);
export type LengthUnit = z.infer<typeof lengthUnitSchema>;
export const speedUnitSchema = z.enum(['mph', 'km/h', 'block/s']);
export type SpeedUnit = z.infer<typeof speedUnitSchema>;

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

/** Direction of travel: `E` is eastbound (traffic heading east, arriving from the west). */
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

/**
 * The inputs a phase's clearance times were calculated from (engine/clearance.ts), kept so a
 * timing sheet can show where a yellow or pedestrian clearance came from. Lengths and speeds
 * are in the project's units. Optional: hand-entered times have none.
 */
export const clearanceBasisSchema = z.object({
  approachSpeed: z.number().positive().optional(),
  /** Percent; uphill positive. */
  gradePercent: z.number().min(-15).max(15).optional(),
  /** Stop line to the far side of the last conflicting lane. */
  intersectionWidth: z.number().nonnegative().optional(),
  vehicleLength: z.number().nonnegative().optional(),
  crossingDistance: z.number().nonnegative().optional(),
  walkingSpeed: z.number().positive().optional(),
});
export type ClearanceBasis = z.infer<typeof clearanceBasisSchema>;

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
  clearanceBasis: clearanceBasisSchema.optional(),
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
 * - `beginCoordGreen`: start of the first coordinated phase's green ("lead" reference)
 * - `beginCoordYellow`: start of the first coordinated phase's yellow, i.e. the end of
 *   coordinated green, which controllers also call the yield point ("lag" reference)
 * - `firstPhaseStart`: start of the ring sequence, barrier group 1 (the CSM ASC-3 reference)
 */
export const offsetReferenceSchema = z.enum(['beginCoordGreen', 'beginCoordYellow', 'firstPhaseStart']);
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
  /** The volume count set this pattern is timed for and analysed against, if any. */
  volumeSetId: idSchema.nullable(),
});
export type Pattern = z.infer<typeof patternSchema>;

export const scheduleEntrySchema = z.object({
  /** Minutes after midnight. */
  startMinute: z.number().int().min(0).max(1439),
  /** `null` runs free. */
  patternId: idSchema.nullable(),
});
export type ScheduleEntry = z.infer<typeof scheduleEntrySchema>;

/** Vehicles per hour. */
const volumeSchema = z.number().int().min(0).max(10_000);

/**
 * Lanes that share a phase and a saturation flow: an exclusive left-turn bay, the through lanes,
 * or a shared through-and-right lane. The approach comes from the serving phase.
 */
export const laneGroupSchema = z.object({
  id: idSchema,
  label: z.string().max(80),
  /** The phase that serves this lane group; lefts it carries are protected when it is a left-turn phase. */
  phase: phaseNumberSchema,
  movements: z.object({ left: z.boolean(), through: z.boolean(), right: z.boolean() }),
  lanes: z.number().int().min(1).max(8),
  /** Average lane width, metres. */
  laneWidth: z.number().min(2).max(6),
  heavyVehiclesPercent: z.number().min(0).max(100),
  /** Percent; uphill positive. */
  gradePercent: z.number().min(-10).max(10),
  /** Saturation flow for the whole group (veh/h of green) when entered by hand; `null` = calculated. */
  saturationFlow: z.number().int().min(1).max(20_000).nullable(),
});
export type LaneGroup = z.infer<typeof laneGroupSchema>;

export const movementVolumesSchema = z.object({ left: volumeSchema, through: volumeSchema, right: volumeSchema });
export type MovementVolumes = z.infer<typeof movementVolumesSchema>;

/** One traffic count (an AM peak hour, say): hourly volumes per lane group and movement. */
export const volumeSetSchema = z.object({
  id: idSchema,
  name: z.string().max(80),
  peakHourFactor: z.number().min(0.5).max(1),
  volumes: z.record(idSchema, movementVolumesSchema),
});
export type VolumeSet = z.infer<typeof volumeSetSchema>;

export const capacitySettingsSchema = z.object({
  /** Passenger cars per hour of green per lane, before adjustments (1900 in the HCM). */
  baseSaturationFlow: z.number().int().min(1).max(3000),
  centralBusinessDistrict: z.boolean(),
});
export type CapacitySettings = z.infer<typeof capacitySettingsSchema>;

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
  capacity: capacitySettingsSchema,
  laneGroups: z.array(laneGroupSchema).max(32),
  volumeSets: z.array(volumeSetSchema).max(32),
  extensions: extensionsSchema.optional(),
});
export type Intersection = z.infer<typeof intersectionSchema>;

/** Metres, stored exactly as entered after conversion; distances are never durations. */
const metresSchema = z.number().min(0).max(100_000);
/** Metres per second. */
const speedSchema = z.number().min(0).max(100);
const directionPhasesSchema = z.array(phaseNumberSchema).max(MAX_PHASES);

/**
 * One intersection's place in a corridor. Distances and speeds describe the link from the
 * previous intersection (they are ignored on the first). `outboundPhases` / `inboundPhases` are
 * the phases carrying through traffic in each direction; either may be empty.
 */
export const corridorStopSchema = z.object({
  intersectionId: idSchema,
  distance: metresSchema,
  /** Progression (design) speed on the link, per direction of travel. */
  speed: z.object({ outbound: speedSchema, inbound: speedSchema }),
  /** The posted limit, for reference; progression speed is what timing uses. */
  speedLimit: speedSchema.nullable(),
  outboundPhases: directionPhasesSchema,
  inboundPhases: directionPhasesSchema,
});
export type CorridorStop = z.infer<typeof corridorStopSchema>;

/**
 * A corridor timing plan: which pattern each intersection runs together (by intersection id;
 * `null` leaves the intersection out), and how much each direction's progression band counts.
 */
export const corridorPlanSchema = z.object({
  id: idSchema,
  name: z.string().max(80),
  patterns: z.record(idSchema, idSchema.nullable()),
  weights: z.object({ outbound: z.number().min(0).max(10), inbound: z.number().min(0).max(10) }),
});
export type CorridorPlan = z.infer<typeof corridorPlanSchema>;

/**
 * A coordinated route through several intersections, in travel order. `outbound` is the direction
 * of travel from the first stop to the last (`E`: eastbound); inbound is the opposite.
 */
export const corridorSchema = z.object({
  id: idSchema,
  name: z.string().min(1).max(120),
  outbound: approachSchema,
  stops: z.array(corridorStopSchema),
  plans: z.array(corridorPlanSchema),
});
export type Corridor = z.infer<typeof corridorSchema>;

export const projectSchema = z.object({
  app: z.literal('spatt'),
  schemaVersion: z.literal(PROJECT_SCHEMA_VERSION),
  id: idSchema,
  name: z.string().min(1).max(120),
  notes: z.string().max(10_000),
  /** How lengths and speeds are shown and entered; `block` and `block/s` are CSM units (1 block = 1 m). */
  units: z.object({
    length: lengthUnitSchema,
    speed: speedUnitSchema,
  }),
  intersections: z.array(intersectionSchema),
  corridors: z.array(corridorSchema),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type Project = z.infer<typeof projectSchema>;
