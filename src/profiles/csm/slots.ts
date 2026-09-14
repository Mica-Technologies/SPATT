/**
 * How a SPATT intersection's patterns and daily schedule map onto the controller's four pattern
 * slots and their whole-hour start times.
 *
 * - **With a schedule**, entry k (in start-time order) becomes slot k and starts at its hour; a
 *   free entry (`patternId: null`) becomes a FREE slot. Unused slots start at the same hour as
 *   slot 0, so they never run (the lower slot wins a tie), and are not written, so the controller
 *   keeps whatever it had there.
 * - **Without a schedule**, patterns 1..4 fill slots 0..3 and time-of-day selection is off, so
 *   slot 0 runs all day.
 */
import { error, warning, type Intersection, type Issue, type Pattern } from '../../model';
import { CSM_SLOT_COUNT } from './format';

/** The controller's default start hours (`TrafficTimeOfDaySchedule`). */
export const CSM_DEFAULT_START_HOURS: [number, number, number, number] = [6, 9, 15, 19];

export interface SlotUse {
  slot: number;
  /** `null`: a free schedule entry. */
  pattern: Pattern | null;
}

export interface SlotAssignment {
  scheduleEnabled: boolean;
  slots: SlotUse[];
  startHours: [number, number, number, number];
  issues: Issue[];
}

export function assignSlots(intersection: Intersection): SlotAssignment {
  const issues: Issue[] = [];
  const patterns = new Map(intersection.patterns.map((p) => [p.id, p]));

  if (intersection.schedule.length === 0) {
    if (intersection.patterns.length > CSM_SLOT_COUNT) {
      issues.push(error('csm.too-many-patterns', `The controller holds ${CSM_SLOT_COUNT} patterns; this intersection has ${intersection.patterns.length}`, ['patterns']));
    }
    return {
      scheduleEnabled: false,
      slots: intersection.patterns.slice(0, CSM_SLOT_COUNT).map((pattern, slot) => ({ slot, pattern })),
      startHours: [...CSM_DEFAULT_START_HOURS],
      issues,
    };
  }

  const entries = intersection.schedule.map((entry, index) => ({ entry, index })).sort((a, b) => a.entry.startMinute - b.entry.startMinute);
  if (entries.length > CSM_SLOT_COUNT) {
    issues.push(error('csm.too-many-schedule-entries', `The controller schedules ${CSM_SLOT_COUNT} time-of-day entries; this intersection has ${entries.length}`, ['schedule']));
  }
  for (const { entry, index } of entries) {
    if (entry.startMinute % 60 !== 0) {
      issues.push(error('csm.schedule-not-on-the-hour', `The controller starts patterns on whole hours; the entry at ${Math.floor(entry.startMinute / 60)}:${String(entry.startMinute % 60).padStart(2, '0')} is not`, ['schedule', index, 'startMinute']));
    }
  }

  const used = entries.slice(0, CSM_SLOT_COUNT);
  const slots = used.map(({ entry }, slot) => ({ slot, pattern: entry.patternId === null ? null : (patterns.get(entry.patternId) ?? null) }));
  const firstHour = Math.floor((used[0]?.entry.startMinute ?? 0) / 60);
  const startHours = Array.from({ length: CSM_SLOT_COUNT }, (_, slot) => (used[slot] ? Math.floor(used[slot].entry.startMinute / 60) : firstHour)) as SlotAssignment['startHours'];

  const scheduled = new Set(used.map(({ entry }) => entry.patternId));
  intersection.patterns.forEach((pattern, index) => {
    if (!scheduled.has(pattern.id)) {
      issues.push(warning('csm.pattern-not-scheduled', `Pattern "${pattern.name}" is not in the schedule, so it is not exported`, ['patterns', index]));
    }
  });
  return { scheduleEnabled: true, slots, startHours, issues };
}
