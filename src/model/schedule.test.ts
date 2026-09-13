import { describe, expect, it } from 'vitest';
import {
  formatClock,
  formatDuration,
  MINUTES_PER_DAY,
  nextScheduleStart,
  parseClock,
  patternAt,
  scheduleSegments,
  scheduleSpans,
  sortSchedule,
  type ScheduleSegment,
} from './schedule';
import type { ScheduleEntry } from './schema';

const e = (startMinute: number, patternId: string | null): ScheduleEntry => ({ startMinute, patternId });

/** Segments must tile 0..1440 exactly, in order, with nothing empty. */
function expectTiling(segments: ScheduleSegment[]) {
  expect(segments[0]!.startMinute).toBe(0);
  expect(segments.at(-1)!.endMinute).toBe(MINUTES_PER_DAY);
  segments.forEach((segment, i) => {
    expect(segment.endMinute).toBeGreaterThan(segment.startMinute);
    if (i > 0) expect(segment.startMinute).toBe(segments[i - 1]!.endMinute);
  });
}

describe('sortSchedule', () => {
  it('orders by start without mutating the input', () => {
    const input = [e(900, 'pm'), e(360, 'am'), e(0, null)];
    expect(sortSchedule(input).map((x) => x.startMinute)).toEqual([0, 360, 900]);
    expect(input.map((x) => x.startMinute)).toEqual([900, 360, 0]);
  });

  it('keeps entries that share a start in their original order', () => {
    expect(sortSchedule([e(60, 'b'), e(0, 'z'), e(60, 'a')]).map((x) => x.patternId)).toEqual(['z', 'b', 'a']);
  });

  it('handles an empty schedule', () => {
    expect(sortSchedule([])).toEqual([]);
  });
});

describe('scheduleSpans', () => {
  it('ends each entry at the next start and the last at the first start tomorrow', () => {
    const spans = scheduleSpans([e(1320, 'night'), e(360, 'am'), e(900, 'pm')]);
    expect(spans.map((s) => [s.startMinute, s.endMinute, s.durationMinutes, s.index])).toEqual([
      [360, 900, 540, 1],
      [900, 1320, 420, 2],
      [1320, 1800, 480, 0],
    ]);
  });

  it('runs a lone entry all day', () => {
    expect(scheduleSpans([e(420, 'a')])).toMatchObject([{ startMinute: 420, endMinute: 1860, durationMinutes: 1440 }]);
  });

  it('ends the last entry at midnight when the first starts at 00:00', () => {
    expect(scheduleSpans([e(0, 'a'), e(600, 'b')]).at(-1)).toMatchObject({ endMinute: 1440, durationMinutes: 840 });
  });

  it('gives a duplicate start zero minutes', () => {
    expect(scheduleSpans([e(60, 'a'), e(60, 'b')]).map((s) => s.durationMinutes)).toEqual([0, 1440]);
  });
});

describe('scheduleSegments', () => {
  it('runs free all day when empty', () => {
    expect(scheduleSegments([])).toEqual([{ startMinute: 0, endMinute: 1440, patternId: null }]);
  });

  it('wraps the last entry past midnight to fill the morning', () => {
    const segments = scheduleSegments([e(360, 'am'), e(900, 'pm'), e(1320, null)]);
    expect(segments).toEqual([
      { startMinute: 0, endMinute: 360, patternId: null },
      { startMinute: 360, endMinute: 900, patternId: 'am' },
      { startMinute: 900, endMinute: 1320, patternId: 'pm' },
      { startMinute: 1320, endMinute: 1440, patternId: null },
    ]);
    expectTiling(segments);
  });

  it('adds no wrap segment when an entry starts at midnight', () => {
    const segments = scheduleSegments([e(600, 'b'), e(0, 'a')]);
    expect(segments).toEqual([
      { startMinute: 0, endMinute: 600, patternId: 'a' },
      { startMinute: 600, endMinute: 1440, patternId: 'b' },
    ]);
  });

  it('covers the whole day with a single entry', () => {
    const segments = scheduleSegments([e(1439, 'late')]);
    expect(segments).toEqual([
      { startMinute: 0, endMinute: 1439, patternId: 'late' },
      { startMinute: 1439, endMinute: 1440, patternId: 'late' },
    ]);
    expectTiling(segments);
  });

  it('drops zero-length duplicates, letting the later entry run', () => {
    const segments = scheduleSegments([e(0, 'a'), e(300, 'x'), e(300, 'y')]);
    expect(segments).toEqual([
      { startMinute: 0, endMinute: 300, patternId: 'a' },
      { startMinute: 300, endMinute: 1440, patternId: 'y' },
    ]);
  });

  it('tiles the day for many shapes of schedule', () => {
    const cases = [[e(5, 'a')], [e(0, 'a')], [e(1439, 'a'), e(0, 'b')], [e(700, 'a'), e(700, 'b'), e(701, null)], [e(59, 'a'), e(61, 'b'), e(60, 'c')]];
    cases.forEach((schedule) => expectTiling(scheduleSegments(schedule)));
  });
});

describe('patternAt', () => {
  const schedule = [e(360, 'am'), e(900, 'pm'), e(1320, null)];

  it('finds the running pattern, start inclusive and end exclusive', () => {
    expect(patternAt(schedule, 360)).toBe('am');
    expect(patternAt(schedule, 899)).toBe('am');
    expect(patternAt(schedule, 900)).toBe('pm');
    expect(patternAt(schedule, 1319)).toBe('pm');
  });

  it('uses the last entry before the first start', () => {
    expect(patternAt([e(360, 'am'), e(1320, 'night')], 0)).toBe('night');
    expect(patternAt([e(360, 'am'), e(1320, 'night')], 359)).toBe('night');
  });

  it('returns null for free and for an empty schedule', () => {
    expect(patternAt(schedule, 1400)).toBeNull();
    expect(patternAt([], 600)).toBeNull();
  });

  it('wraps minutes outside the day', () => {
    expect(patternAt(schedule, 1440 + 400)).toBe('am');
    expect(patternAt(schedule, -1)).toBeNull();
    expect(patternAt([e(360, 'am'), e(1320, 'night')], -1)).toBe('night');
  });
});

describe('nextScheduleStart', () => {
  it('starts an empty schedule at midnight', () => {
    expect(nextScheduleStart([])).toBe(0);
  });

  it('takes the next whole hour after the last start', () => {
    expect(nextScheduleStart([e(360, 'a')])).toBe(420);
    expect(nextScheduleStart([e(0, 'a'), e(390, 'b')])).toBe(420);
  });

  it('wraps past midnight and skips hours in use', () => {
    expect(nextScheduleStart([e(1380, 'a'), e(0, 'b')])).toBe(60);
    expect(nextScheduleStart([e(1410, 'a')])).toBe(0);
  });

  it('falls back to a free minute when every hour is taken', () => {
    const everyHour = Array.from({ length: 24 }, (_, h) => e(h * 60, 'a'));
    expect(nextScheduleStart(everyHour)).toBe(1381);
  });
});

describe('formatClock', () => {
  it('formats 24-hour times with leading zeros', () => {
    expect(formatClock(0)).toBe('00:00');
    expect(formatClock(360)).toBe('06:00');
    expect(formatClock(905)).toBe('15:05');
    expect(formatClock(1439)).toBe('23:59');
    expect(formatClock(1440)).toBe('24:00');
  });
});

describe('formatDuration', () => {
  it('formats hours and minutes', () => {
    expect(formatDuration(45)).toBe('45 min');
    expect(formatDuration(180)).toBe('3 h');
    expect(formatDuration(210)).toBe('3 h 30 min');
    expect(formatDuration(1440)).toBe('24 h');
    expect(formatDuration(0)).toBe('0 min');
  });
});

describe('parseClock', () => {
  it.each([
    ['6:00', 360],
    ['06:00', 360],
    ['0600', 360],
    ['600', 360],
    ['6', 360],
    ['18', 1080],
    ['  15:30 ', 930],
    ['15.30', 930],
    ['00:00', 0],
    ['0', 0],
    ['23:59', 1439],
    ['2359', 1439],
  ])('parses %j as %i', (text, minute) => {
    expect(parseClock(text)).toBe(minute);
  });

  it.each(['', ' ', '24:00', '2400', '24', '12:60', '1260', '6:0', '6:000', '12345', 'abc', '-1:00', '6:00pm', '1:2:3', '6:5'])('rejects %j', (text) => {
    expect(parseClock(text)).toBeNull();
  });

  it('round-trips every minute of the day through formatClock', () => {
    for (let m = 0; m < MINUTES_PER_DAY; m++) {
      expect(parseClock(formatClock(m))).toBe(m);
    }
  });
});
