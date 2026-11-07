import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { newLaneGroup, standardEightPhase, twoPhase, validateIntersection } from '../../model';
import { parseCsv } from './csv';
import { applyCount, findPeakHour, parseMovementHeader, parseTimeCell, parseTurningMovementCsv, suggestTargets, type MovementKey } from './tmc';

const fixture = (name: string) => readFileSync(join(import.meta.dirname, '../../../test/fixtures/counts', name), 'utf8');
const ok = (text: string) => {
  const parsed = parseTurningMovementCsv(text);
  if (!parsed.ok) throw new Error(parsed.error);
  return parsed;
};
let n = 0;
const ids = (prefix: string) => `${prefix}-${++n}`;

describe('parseCsv', () => {
  it('reads quoted cells, doubled quotes, CRLF and a byte-order mark', () => {
    expect(parseCsv('﻿a,"b, c","say ""hi"""\r\n1,2,3\r\n\r\n')).toEqual([
      ['a', 'b, c', 'say "hi"'],
      ['1', '2', '3'],
    ]);
  });

  it('detects semicolons and tabs', () => {
    expect(parseCsv('a;b\n1;2')).toEqual([['a', 'b'], ['1', '2']]);
    expect(parseCsv('a\tb\n1\t2')).toEqual([['a', 'b'], ['1', '2']]);
  });
});

describe('headers and times', () => {
  it('reads common movement headers', () => {
    expect(parseMovementHeader('NBL')).toEqual({ approach: 'N', turn: 'left' });
    expect(parseMovementHeader('SB Thru')).toEqual({ approach: 'S', turn: 'through' });
    expect(parseMovementHeader('Eastbound Right')).toEqual({ approach: 'E', turn: 'right' });
    expect(parseMovementHeader('WB_RT')).toEqual({ approach: 'W', turn: 'right' });
    expect(parseMovementHeader('NBU')).toEqual({ approach: 'N', turn: 'uturn' });
    expect(parseMovementHeader('Peds')).toBeNull();
    expect(parseMovementHeader('Total')).toBeNull();
    expect(parseMovementHeader('Time')).toBeNull();
  });

  it('reads 24-hour, 12-hour, compact, dated and range times', () => {
    expect(parseTimeCell('07:15')).toBe(435);
    expect(parseTimeCell('7:15 PM')).toBe(1155);
    expect(parseTimeCell('12:00 AM')).toBe(0);
    expect(parseTimeCell('0715')).toBe(435);
    expect(parseTimeCell('2026-10-14 16:45:00')).toBe(1005);
    expect(parseTimeCell('5:00 PM - 5:15 PM')).toBe(1020);
    expect(parseTimeCell('Total')).toBeNull();
  });
});

describe('parseTurningMovementCsv', () => {
  it('reads the wide layout, ignoring pedestrian, total columns and the total row', () => {
    const counts = ok(fixture('wide-15min.csv'));
    expect(counts.layout).toBe('wide');
    expect(counts.interval).toBe(15);
    expect(counts.bins).toHaveLength(8);
    expect(counts.movements).toHaveLength(12);
    expect(counts.bins[0]!.volumes['N:through']).toBe(59);
    expect(counts.notes.join(' ')).toMatch(/1 row without a time/);
  });

  it('finds the peak hour and its PHF', () => {
    const counts = ok(fixture('wide-15min.csv'));
    const peak = findPeakHour(counts)!;
    expect(peak.start).toBe(450); // 07:30
    const totals = counts.bins.map((b) => Object.values(b.volumes).reduce((s, v) => s + v!, 0));
    const hour = totals.slice(2, 6);
    expect(peak.total).toBe(hour.reduce((s, v) => s + v, 0));
    expect(peak.peak15).toBe(Math.max(...hour));
    expect(peak.phf).toBeCloseTo(peak.total / (4 * peak.peak15!), 10);
    expect(peak.volumes['E:through']).toBe(counts.bins.slice(2, 6).reduce((s, b) => s + b.volumes['E:through']!, 0));
    // Limited to a window, the peak must start inside it.
    expect(findPeakHour(counts, 420, 435)!.start).toBe(420);
    expect(findPeakHour(counts, 600, 720)).toBeNull();
  });

  it('reads two header rows named by the leg traffic comes from, with U-turns as lefts', () => {
    const counts = ok(fixture('two-row-legs.csv'));
    expect(counts.layout).toBe('two-row');
    const first = counts.bins[0]!;
    expect(first.start).toBe(17 * 60);
    // The south approach carries northbound traffic: 8 lefts plus 1 U-turn.
    expect(first.volumes['N:left']).toBe(9);
    expect(first.volumes['S:through']).toBe(49);
    expect(counts.notes).toContain('U-turns are counted as left turns.');
  });

  it('reads the long layout and adds 5-minute intervals into 15-minute bins', () => {
    const counts = ok(fixture('long-5min.csv'));
    expect(counts.layout).toBe('long');
    expect(counts.sourceInterval).toBe(5);
    expect(counts.interval).toBe(15);
    expect(counts.bins.map((b) => b.start)).toEqual([960, 975, 990, 1005, 1020, 1035]);
    expect(counts.bins[0]!.volumes['N:through']).toBe(28 * 3);
    expect(findPeakHour(counts)!.start).toBe(990);
  });

  it('takes hourly rows as they are, without a PHF', () => {
    const counts = ok('Hour,NBT,SBT\n07:00,500,400\n08:00,650,420\n09:00,300,200\n');
    expect(counts.interval).toBe(60);
    const peak = findPeakHour(counts)!;
    expect(peak).toMatchObject({ start: 480, total: 1070, phf: null, peak15: null });
  });

  it('explains files it cannot read', () => {
    expect(parseTurningMovementCsv('just one line')).toEqual({ ok: false, error: 'The file has no data rows.' });
    expect(parseTurningMovementCsv('a,b,c\n1,2,3\n')).toMatchObject({ ok: false, error: /No movement columns/ });
    expect(parseTurningMovementCsv('Time,NBT,SBT\n07:00,1,2\n07:10,1,2\n')).toMatchObject({ ok: false, error: /10 minutes/ });
    expect(parseTurningMovementCsv('Time,NBT,SBT\n07:00,0,0\n07:15,0,0\n')).toMatchObject({ ok: false, error: /zero/ });
  });

  it('uses the first day of a multi-day file', () => {
    const counts = ok('Date,Time,NBT,SBT\n2026-10-13,07:00,10,10\n2026-10-14,07:00,20,20\n');
    expect(counts.bins[0]!.volumes['N:through']).toBe(10);
    expect(counts.notes[0]).toMatch(/2 days/);
  });
});

describe('mapping onto lane groups', () => {
  const movements: MovementKey[] = ['N:left', 'N:through', 'N:right', 'E:left', 'E:through', 'E:right'];

  it('suggests new lane groups for phases when the intersection has none', () => {
    const i = standardEightPhase();
    const targets = suggestTargets(i, movements);
    // NB Left is phase 3, NB Thru phase 8 (which takes the rights); EB Left 5, EB Thru 2.
    expect(targets).toEqual({
      'N:left': { kind: 'phase', phase: 3 },
      'N:through': { kind: 'phase', phase: 8 },
      'N:right': { kind: 'phase', phase: 8 },
      'E:left': { kind: 'phase', phase: 5 },
      'E:through': { kind: 'phase', phase: 2 },
      'E:right': { kind: 'phase', phase: 2 },
    });
  });

  it('prefers existing lane groups, and sends lefts without a left phase into the through lanes', () => {
    const i = twoPhase();
    i.laneGroups = i.phases.map((p) => newLaneGroup(`lg-${p.number}`, p));
    const targets = suggestTargets(i, ['N:left', 'N:through', 'W:right']);
    expect(targets).toEqual({
      'N:left': { kind: 'group', laneGroupId: 'lg-8' },
      'N:through': { kind: 'group', laneGroupId: 'lg-8' },
      'W:right': { kind: 'group', laneGroupId: 'lg-6' },
    });
  });

  it('skips a movement no phase serves', () => {
    expect(suggestTargets(twoPhase(), ['NE:left'])).toEqual({ 'NE:left': { kind: 'skip' } });
  });

  it('adds the count, its lane groups and the pattern link as a valid intersection', () => {
    const i = standardEightPhase();
    const counts = ok(fixture('wide-15min.csv'));
    const peak = findPeakHour(counts)!;
    const targets = suggestTargets(i, counts.movements);
    const applied = applyCount(i, { name: 'AM peak 07:30', peakHourFactor: peak.phf!, volumes: peak.volumes, targets }, ids);
    expect(applied.addedLaneGroups).toHaveLength(8);
    const set = i.volumeSets[0]!;
    expect(set.name).toBe('AM peak 07:30');
    expect(set.peakHourFactor).toBe(Math.round(peak.phf! * 100) / 100);
    const nbThru = i.laneGroups.find((g) => g.phase === 8)!;
    expect(nbThru.movements).toEqual({ left: false, through: true, right: true });
    expect(set.volumes[nbThru.id]).toEqual({ left: 0, through: peak.volumes['N:through'], right: peak.volumes['N:right'] });
    expect(i.patterns[0]!.volumeSetId).toBe(set.id);
    expect(validateIntersection(i).filter((x) => x.code.startsWith('laneGroup') || x.code.startsWith('volumeSet'))).toEqual([]);
  });

  it('widens an existing lane group that receives a movement it did not carry', () => {
    const i = twoPhase();
    i.laneGroups = [newLaneGroup('nb', i.phases.find((p) => p.number === 8)!)];
    const applied = applyCount(i, { name: 'PM', peakHourFactor: 0.9, volumes: { 'N:right': 40 }, targets: { 'N:right': { kind: 'group', laneGroupId: 'nb' } } }, ids);
    expect(applied.widenedLaneGroups).toEqual(['nb']);
    expect(i.laneGroups[0]!.movements.right).toBe(true);
    expect(i.volumeSets[0]!.volumes.nb).toEqual({ left: 0, through: 0, right: 40 });
  });
});
