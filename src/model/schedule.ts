/**
 * The daily schedule: which pattern runs at each time of day.
 *
 * An entry runs from its start until the next entry's start. The day wraps: the last entry keeps
 * running past midnight until the first entry of the next day, so if the first entry starts at
 * 06:00, whatever the last entry selects is also what runs from 00:00 to 06:00.
 */
import type { ScheduleEntry } from './schema';

export const MINUTES_PER_DAY = 1440;

/** A stretch of the day in one pattern. `endMinute` is exclusive and may be 1440. */
export interface ScheduleSegment {
  startMinute: number;
  endMinute: number;
  /** `null` runs free. */
  patternId: string | null;
}

/** When an entry stops running. `endMinute` may pass 1440 when it runs past midnight. */
export interface ScheduleSpan {
  entry: ScheduleEntry;
  /** Index of the entry in the array given, so editors can address the stored entry. */
  index: number;
  startMinute: number;
  endMinute: number;
  durationMinutes: number;
}

/** A new array ordered by start time; entries starting together keep their order. */
export function sortSchedule(schedule: readonly ScheduleEntry[]): ScheduleEntry[] {
  return [...schedule].sort((a, b) => a.startMinute - b.startMinute);
}

/**
 * Every entry with the time it ends: the next entry's start, or for the last entry the first
 * entry's start on the following day. A lone entry runs the whole day; an entry sharing its start
 * with the one after it runs for zero minutes.
 */
export function scheduleSpans(schedule: readonly ScheduleEntry[]): ScheduleSpan[] {
  const ordered = schedule.map((entry, index) => ({ entry, index })).sort((a, b) => a.entry.startMinute - b.entry.startMinute);
  const first = ordered[0];
  return ordered.map(({ entry, index }, position) => {
    const next = ordered[position + 1];
    const endMinute = next ? next.entry.startMinute : first!.entry.startMinute + MINUTES_PER_DAY;
    return { entry, index, startMinute: entry.startMinute, endMinute, durationMinutes: endMinute - entry.startMinute };
  });
}

/**
 * The day from 00:00 to 24:00 as consecutive segments, in order, with no gaps or zero-length
 * segments. The stretch before the first entry belongs to the last entry (it runs past midnight).
 * An empty schedule runs free all day. Adjacent entries selecting the same pattern stay separate
 * segments, one per entry.
 */
export function scheduleSegments(schedule: readonly ScheduleEntry[]): ScheduleSegment[] {
  const spans = scheduleSpans(schedule).filter((span) => span.durationMinutes > 0);
  const last = spans.at(-1);
  if (!last) {
    // Empty, or (impossible after filtering a non-empty schedule) nothing with a duration.
    return [{ startMinute: 0, endMinute: MINUTES_PER_DAY, patternId: null }];
  }
  const segments: ScheduleSegment[] = [];
  if (spans[0]!.startMinute > 0) {
    segments.push({ startMinute: 0, endMinute: spans[0]!.startMinute, patternId: last.entry.patternId });
  }
  for (const span of spans) {
    segments.push({ startMinute: span.startMinute, endMinute: Math.min(span.endMinute, MINUTES_PER_DAY), patternId: span.entry.patternId });
  }
  return segments;
}

/** The pattern running at a minute of the day (wrapped into 0..1439); `null` is free. */
export function patternAt(schedule: readonly ScheduleEntry[], minute: number): string | null {
  const m = ((Math.floor(minute) % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
  const segment = scheduleSegments(schedule).find((s) => m >= s.startMinute && m < s.endMinute);
  return segment?.patternId ?? null;
}

/**
 * The start for a new entry: the first whole hour after the last entry's start that no entry
 * already uses, wrapping past midnight. Falls back to any unused minute if every hour is taken,
 * and to 0 when the schedule is empty.
 */
export function nextScheduleStart(schedule: readonly ScheduleEntry[]): number {
  if (schedule.length === 0) {
    return 0;
  }
  const used = new Set(schedule.map((e) => e.startMinute));
  const lastStart = Math.max(...used);
  const firstHour = Math.floor(lastStart / 60) + 1;
  for (let h = 0; h < 24; h++) {
    const minute = ((firstHour + h) % 24) * 60;
    if (!used.has(minute)) {
      return minute;
    }
  }
  for (let i = 1; i < MINUTES_PER_DAY; i++) {
    const minute = (lastStart + i) % MINUTES_PER_DAY;
    if (!used.has(minute)) {
      return minute;
    }
  }
  return lastStart;
}

/** Minutes after midnight as 24-hour `HH:MM`; 1440 is shown as `24:00`. */
export function formatClock(minute: number): string {
  const m = Math.max(0, Math.round(minute));
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

/** A duration in minutes as `3 h 30 min`, `45 min` or `24 h`. */
export function formatDuration(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m} min`;
  return m === 0 ? `${h} h` : `${h} h ${m} min`;
}

/**
 * Parses a 24-hour time of day to minutes after midnight: `6:00`, `06:00`, `0600`, `600`, `6`
 * and `18` are all accepted. Returns null for anything else, including `24:00`.
 */
export function parseClock(text: string): number | null {
  const trimmed = text.trim();
  let hours: string;
  let minutes: string;
  const colon = /^(\d{1,2})[:.](\d{2})$/.exec(trimmed);
  if (colon) {
    hours = colon[1]!;
    minutes = colon[2]!;
  } else if (/^\d{1,2}$/.test(trimmed)) {
    hours = trimmed;
    minutes = '0';
  } else if (/^\d{3,4}$/.test(trimmed)) {
    hours = trimmed.slice(0, -2);
    minutes = trimmed.slice(-2);
  } else {
    return null;
  }
  const h = Number(hours);
  const m = Number(minutes);
  if (h > 23 || m > 59) {
    return null;
  }
  return h * 60 + m;
}
