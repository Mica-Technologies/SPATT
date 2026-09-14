/**
 * Lane groups and volume counts: defaults, validation, and the edits that keep counts and
 * pattern links consistent when lane groups and counts are removed. The capacity arithmetic
 * itself is in `engine/capacity.ts`.
 */
import { error, warning, type Issue } from './issues';
import type { CapacitySettings, Intersection, LaneGroup, MovementVolumes, Phase, VolumeSet } from './schema';

/** HCM base saturation flow, outside a central business district. */
export const DEFAULT_CAPACITY: CapacitySettings = { baseSaturationFlow: 1900, centralBusinessDistrict: false };
/** Metres (about 12 ft), the HCM base lane width. */
export const DEFAULT_LANE_WIDTH = 3.6;
/** Wider than this, the HCM suggests analysing the lane as two narrow lanes. */
export const LANE_WIDTH_TYPICAL_MAX = 4.8;
export const DEFAULT_PEAK_HOUR_FACTOR = 0.92;
export const MOVEMENTS = ['left', 'through', 'right'] as const;
export type Movement = (typeof MOVEMENTS)[number];

export const MOVEMENT_LABEL: Record<Movement, string> = { left: 'Left', through: 'Through', right: 'Right' };

/** A lane group for one lane serving `phase`'s own movement (a left-turn phase serves lefts). */
export function newLaneGroup(id: string, phase: Phase): LaneGroup {
  const kind = phase.movement.kind;
  return {
    id,
    label: phase.label || `Phase ${phase.number}`,
    phase: phase.number,
    movements: { left: kind === 'left', through: kind === 'through' || kind === 'other', right: kind === 'right' },
    lanes: 1,
    laneWidth: DEFAULT_LANE_WIDTH,
    heavyVehiclesPercent: 2,
    gradePercent: 0,
    saturationFlow: null,
  };
}

/** Phases that can carry vehicles and have no lane group yet. */
export function phasesWithoutLaneGroups(intersection: Intersection): Phase[] {
  const covered = new Set(intersection.laneGroups.map((g) => g.phase));
  return intersection.phases.filter((p) => p.enabled && p.movement.kind !== 'pedestrian' && !covered.has(p.number));
}

export function zeroVolumes(): MovementVolumes {
  return { left: 0, through: 0, right: 0 };
}

export function newVolumeSet(id: string, name: string, laneGroups: readonly LaneGroup[]): VolumeSet {
  return { id, name, peakHourFactor: DEFAULT_PEAK_HOUR_FACTOR, volumes: Object.fromEntries(laneGroups.map((g) => [g.id, zeroVolumes()])) };
}

/** Removes a lane group and its volumes from every count. */
export function removeLaneGroup(intersection: Intersection, laneGroupId: string): void {
  intersection.laneGroups = intersection.laneGroups.filter((g) => g.id !== laneGroupId);
  for (const set of intersection.volumeSets) {
    delete set.volumes[laneGroupId];
  }
}

/** Removes a count; patterns timed for it keep their timing and lose the link. */
export function removeVolumeSet(intersection: Intersection, volumeSetId: string): void {
  intersection.volumeSets = intersection.volumeSets.filter((s) => s.id !== volumeSetId);
  for (const pattern of intersection.patterns) {
    if (pattern.volumeSetId === volumeSetId) {
      pattern.volumeSetId = null;
    }
  }
}

/** Rules for lane groups, counts and pattern count links. Codes are listed in project-format.md. */
export function validateCapacity(intersection: Intersection): Issue[] {
  const issues: Issue[] = [];
  const phases = new Map(intersection.phases.map((p) => [p.number, p]));
  const groupIds = new Set<string>();

  intersection.laneGroups.forEach((group, index) => {
    const path = ['laneGroups', index];
    const name = group.label || `Lane group ${index + 1}`;
    if (groupIds.has(group.id)) {
      issues.push(error('laneGroup.duplicate-id', `Lane group id "${group.id}" is used more than once`, [...path, 'id']));
    }
    groupIds.add(group.id);
    const phase = phases.get(group.phase);
    if (!phase) {
      issues.push(error('laneGroup.unknown-phase', `${name} is served by phase ${group.phase}, which is not defined`, [...path, 'phase']));
    } else if (phase.movement.kind === 'pedestrian') {
      issues.push(error('laneGroup.pedestrian-phase', `${name} is served by phase ${group.phase}, a pedestrian phase`, [...path, 'phase']));
    } else if (!phase.enabled) {
      issues.push(warning('laneGroup.phase-disabled', `${name} is served by phase ${group.phase}, which is disabled`, [...path, 'phase']));
    }
    if (!MOVEMENTS.some((m) => group.movements[m])) {
      issues.push(error('laneGroup.no-movement', `${name} carries no movement`, [...path, 'movements']));
    }
    if (group.laneWidth > LANE_WIDTH_TYPICAL_MAX) {
      issues.push(warning('laneGroup.wide-lanes', `${name}'s lanes are wider than ${LANE_WIDTH_TYPICAL_MAX} m; consider analysing each as two lanes`, [...path, 'laneWidth']));
    }
  });

  const setIds = new Set<string>();
  intersection.volumeSets.forEach((set, index) => {
    const path = ['volumeSets', index];
    const name = set.name || `Count ${index + 1}`;
    if (setIds.has(set.id)) {
      issues.push(error('volumeSet.duplicate-id', `Count id "${set.id}" is used more than once`, [...path, 'id']));
    }
    setIds.add(set.id);
    for (const [groupId, volumes] of Object.entries(set.volumes)) {
      const group = intersection.laneGroups.find((g) => g.id === groupId);
      if (!group) {
        issues.push(error('volumeSet.unknown-lane-group', `${name} has volumes for a lane group that does not exist`, [...path, 'volumes', groupId]));
        continue;
      }
      for (const movement of MOVEMENTS) {
        if (volumes[movement] > 0 && !group.movements[movement]) {
          issues.push(
            warning('volumeSet.unserved-movement', `${name} counts ${MOVEMENT_LABEL[movement].toLowerCase()} turns in ${group.label || 'a lane group'}, which carries none`, [...path, 'volumes', groupId, movement]),
          );
        }
      }
    }
  });

  intersection.patterns.forEach((pattern, index) => {
    if (pattern.volumeSetId !== null && !setIds.has(pattern.volumeSetId)) {
      issues.push(error('pattern.unknown-volume-set', `Pattern ${pattern.name || pattern.id} is linked to a count that does not exist`, ['patterns', index, 'volumeSetId']));
    }
  });
  return issues;
}
