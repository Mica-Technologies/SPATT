/**
 * Turning-movement counts from CSV: interval counts by approach and movement, the peak hour and
 * its peak hour factor, and the mapping of counted movements onto an intersection's lane groups.
 *
 * Accepted layouts (documented in docs/getting-started/imports.md):
 *
 * - **Wide**: one row per interval, a time column and one column per movement, headed like `NBL`,
 *   `NBT`, `NBR`, `SB Left`, `Eastbound Thru`, `WB_RT` (U-turns, `NBU`, count as lefts).
 * - **Two header rows**: approaches in the first row (`Northbound`, `NB`, or the leg the traffic
 *   comes from: `North Approach`, `From North`), spanning their movements, and `Left`, `Thru`,
 *   `Right` (`L`, `T`, `R`, `U`) underneath.
 * - **Long**: one row per interval and movement, with time, approach, movement and count columns.
 *
 * Times may be `07:15`, `7:15 AM`, `0715`, `2026-10-14 07:15` or a range (`07:00-07:15`; its start
 * is used). Intervals of 5 or 15 minutes are added up into 15-minute bins; hourly rows are taken
 * as they are, with no PHF. Columns that are not movements (pedestrians, bikes, totals) are ignored.
 *
 * Pure: no DOM, no host. Directions are directions of travel, as in the model (`N` = northbound).
 */
import { DEFAULT_PEAK_HOUR_FACTOR, MOVEMENTS, newLaneGroup, type Approach, type Intersection, type LaneGroup, type Movement, type VolumeSet } from '../../model';
import { cellNumber, parseCsv } from './csv';

export type MovementKey = `${Approach}:${Movement}`;

export interface CountBin {
  /** Minutes after midnight at the start of the interval. */
  start: number;
  volumes: Partial<Record<MovementKey, number>>;
}

export type CountLayout = 'wide' | 'two-row' | 'long';

export type ParsedCounts =
  | {
      ok: true;
      layout: CountLayout;
      /** Minutes per bin after aggregation: 15, or 60 for hourly data. */
      interval: 15 | 60;
      /** The interval in the file, before aggregation. */
      sourceInterval: number;
      bins: CountBin[];
      movements: MovementKey[];
      notes: string[];
    }
  | { ok: false; error: string };

const APPROACH_WORDS: [RegExp, Approach][] = [
  [/^(NORTHBOUND|NB|N)$/, 'N'],
  [/^(SOUTHBOUND|SB|S)$/, 'S'],
  [/^(EASTBOUND|EB|E)$/, 'E'],
  [/^(WESTBOUND|WB|W)$/, 'W'],
  [/^(NORTHEASTBOUND|NEB|NE)$/, 'NE'],
  [/^(NORTHWESTBOUND|NWB|NW)$/, 'NW'],
  [/^(SOUTHEASTBOUND|SEB|SE)$/, 'SE'],
  [/^(SOUTHWESTBOUND|SWB|SW)$/, 'SW'],
];
/** The leg traffic comes from: traffic from the north leg travels south. */
const LEG_WORDS: [RegExp, Approach][] = [
  [/^(FROMNORTH|NORTHAPPROACH|NORTHLEG|NORTHAPP)$/, 'S'],
  [/^(FROMSOUTH|SOUTHAPPROACH|SOUTHLEG|SOUTHAPP)$/, 'N'],
  [/^(FROMEAST|EASTAPPROACH|EASTLEG|EASTAPP)$/, 'W'],
  [/^(FROMWEST|WESTAPPROACH|WESTLEG|WESTAPP)$/, 'E'],
];
const TURN_WORDS: [RegExp, Movement | 'uturn'][] = [
  [/^(L|LT|LEFT|LEFTS|LFT)$/, 'left'],
  [/^(T|TH|THR|THRU|THROUGH|THRUS|THROUGHS|STRAIGHT)$/, 'through'],
  [/^(R|RT|RIGHT|RIGHTS|RGT)$/, 'right'],
  [/^(U|UT|UTURN|UTURNS|UTRN)$/, 'uturn'],
];

const normalise = (s: string) => s.toUpperCase().replace(/[^A-Z]/g, '');

export function parseApproach(token: string): Approach | null {
  const t = normalise(token);
  return APPROACH_WORDS.find(([re]) => re.test(t))?.[1] ?? LEG_WORDS.find(([re]) => re.test(t))?.[1] ?? null;
}

export function parseTurn(token: string): Movement | 'uturn' | null {
  const t = normalise(token);
  return TURN_WORDS.find(([re]) => re.test(t))?.[1] ?? null;
}

/** A movement column header (`NBL`, `SB Thru`, `Eastbound Right`), or null. */
export function parseMovementHeader(header: string): { approach: Approach; turn: Movement | 'uturn' } | null {
  const t = normalise(header);
  // Try every split into an approach part and a turn part; the first that reads both wins.
  for (let k = 1; k < t.length; k++) {
    const approach = parseApproach(t.slice(0, k));
    const turn = parseTurn(t.slice(k));
    if (approach && turn) return { approach, turn };
  }
  return null;
}

/** Minutes after midnight from a time cell, or null. A range gives its start. */
export function parseTimeCell(cell: string): number | null {
  const text = cell.trim();
  const clock = /(\d{1,2}):(\d{2})(?::\d{2}(?:\.\d+)?)?\s*([AaPp]\.?[Mm]\.?)?/.exec(text);
  if (clock) {
    let hours = Number(clock[1]);
    const minutes = Number(clock[2]);
    const meridiem = clock[3]?.[0]?.toUpperCase();
    if (meridiem === 'P' && hours < 12) hours += 12;
    if (meridiem === 'A' && hours === 12) hours = 0;
    return hours < 24 && minutes < 60 ? hours * 60 + minutes : null;
  }
  const compact = /^(\d{1,2})(\d{2})$/.exec(text);
  if (compact) {
    const hours = Number(compact[1]);
    const minutes = Number(compact[2]);
    return hours < 24 && minutes < 60 ? hours * 60 + minutes : null;
  }
  return null;
}

const TIME_HEADER = /time|interval|period|start|begin|from|hour/i;
const DATE_HEADER = /^(date|day)$/i;

const keyOf = (approach: Approach, turn: Movement): MovementKey => `${approach}:${turn}`;

interface RawRow {
  date: string;
  start: number;
  volumes: Partial<Record<MovementKey, number>>;
}

/** Column index of the time, guessed from the header or from the first data row. */
function timeColumn(header: string[], firstData: string[] | undefined): number {
  const byName = header.findIndex((h) => TIME_HEADER.test(h) && !DATE_HEADER.test(h));
  if (byName >= 0) return byName;
  return firstData?.findIndex((c) => parseTimeCell(c) !== null) ?? -1;
}

function addVolume(volumes: Partial<Record<MovementKey, number>>, key: MovementKey, n: number) {
  volumes[key] = (volumes[key] ?? 0) + n;
}

function readWide(rows: string[][], headerRows: number, columns: { index: number; approach: Approach; turn: Movement | 'uturn' }[], notes: string[]): RawRow[] | string {
  const header = rows[headerRows - 1]!;
  const firstHeader = rows[0]!;
  const data = rows.slice(headerRows);
  let time = timeColumn(header, data[0]);
  if (time < 0 && headerRows === 2) time = timeColumn(firstHeader, data[0]);
  if (time < 0) return 'No time column found: head it Time, Start time or Interval.';
  const date = [...header, ...(headerRows === 2 ? firstHeader : [])].findIndex((h) => DATE_HEADER.test(h));
  const uturns = columns.some((c) => c.turn === 'uturn');
  if (uturns) notes.push('U-turns are counted as left turns.');
  const result: RawRow[] = [];
  let skipped = 0;
  for (const row of data) {
    const start = parseTimeCell(row[time] ?? '');
    if (start === null) {
      skipped++;
      continue;
    }
    const volumes: Partial<Record<MovementKey, number>> = {};
    for (const c of columns) {
      const n = cellNumber(row[c.index]);
      if (n !== null && n > 0) addVolume(volumes, keyOf(c.approach, c.turn === 'uturn' ? 'left' : c.turn), n);
    }
    result.push({ date: date >= 0 ? (row[date] ?? '') : '', start, volumes });
  }
  if (skipped > 0) notes.push(`${skipped} row${skipped === 1 ? '' : 's'} without a time (totals, blank lines) ignored.`);
  return result;
}

function readLong(rows: string[][], notes: string[]): RawRow[] | string | null {
  const header = rows[0]!;
  const find = (re: RegExp) => header.findIndex((h) => re.test(h));
  const approach = find(/approach|direction|^dir$|bound|leg/i);
  const movement = find(/movement|turn|mvmt|^mov/i);
  const count = find(/count|volume|^vol|vehicles|^veh|^total$|^n$/i);
  if (approach < 0 || movement < 0 || count < 0) return null;
  const time = timeColumn(header, rows[1]);
  if (time < 0) return 'No time column found: head it Time, Start time or Interval.';
  const date = header.findIndex((h) => DATE_HEADER.test(h));
  const byTime = new Map<string, RawRow>();
  let skipped = 0;
  let uturns = false;
  for (const row of rows.slice(1)) {
    const start = parseTimeCell(row[time] ?? '');
    const a = parseApproach(row[approach] ?? '');
    const t = parseTurn(row[movement] ?? '');
    const n = cellNumber(row[count]);
    if (start === null || !a || !t || n === null) {
      skipped++;
      continue;
    }
    if (t === 'uturn') uturns = true;
    const d = date >= 0 ? (row[date] ?? '') : '';
    const id = `${d}|${start}`;
    const entry = byTime.get(id) ?? { date: d, start, volumes: {} };
    if (n > 0) addVolume(entry.volumes, keyOf(a, t === 'uturn' ? 'left' : t), n);
    byTime.set(id, entry);
  }
  if (uturns) notes.push('U-turns are counted as left turns.');
  if (skipped > 0) notes.push(`${skipped} row${skipped === 1 ? '' : 's'} not read (no time, approach, movement or count).`);
  return [...byTime.values()];
}

/** Reads a turning-movement count file; see the module comment for the layouts. */
export function parseTurningMovementCsv(text: string): ParsedCounts {
  const rows = parseCsv(text);
  if (rows.length < 2) return { ok: false, error: 'The file has no data rows.' };
  const notes: string[] = [];

  const movementColumns = (header: string[]) =>
    header.flatMap((h, index) => {
      const parsed = parseMovementHeader(h);
      return parsed ? [{ index, ...parsed }] : [];
    });

  let layout: CountLayout;
  let raw: RawRow[] | string | null;
  const single = movementColumns(rows[0]!);
  if (single.length >= 2) {
    layout = 'wide';
    raw = readWide(rows, 1, single, notes);
  } else {
    // Two header rows: approaches spanning their movements, then the movements.
    let current: Approach | null = null;
    const spanned = rows[0]!.map((cell) => {
      const approach = cell ? parseApproach(cell) : null;
      if (cell) current = approach;
      return current;
    });
    const twoRow = rows[1]!.flatMap((cell, index) => {
      const approach = spanned[index];
      const turn = parseTurn(cell);
      return approach && turn ? [{ index, approach, turn }] : [];
    });
    if (twoRow.length >= 2 && rows.length >= 3) {
      layout = 'two-row';
      raw = readWide(rows, 2, twoRow, notes);
    } else {
      layout = 'long';
      raw = readLong(rows, notes);
    }
  }
  if (raw === null) return { ok: false, error: 'No movement columns found. Head them like NBL, NBT, NBR, or use Time, Approach, Movement and Count columns.' };
  if (typeof raw === 'string') return { ok: false, error: raw };
  if (raw.length === 0) return { ok: false, error: 'No intervals with a time were found.' };

  const dates = [...new Set(raw.map((r) => r.date))];
  if (dates.length > 1) {
    notes.push(`The file holds ${dates.length} days; only ${dates[0]} is used.`);
    raw = raw.filter((r) => r.date === dates[0]);
  }
  const starts = [...new Set(raw.map((r) => r.start))].sort((x, y) => x - y);
  const gaps = starts.slice(1).map((s, k) => s - starts[k]!);
  const sourceInterval = gaps.length > 0 ? Math.min(...gaps) : 15;
  let interval: 15 | 60;
  if (sourceInterval === 60) {
    interval = 60;
  } else if (15 % sourceInterval === 0) {
    interval = 15;
    if (sourceInterval !== 15) notes.push(`${sourceInterval}-minute intervals are added up into 15-minute bins.`);
  } else {
    return { ok: false, error: `Intervals of ${sourceInterval} minutes cannot be put into 15-minute bins; use 5- or 15-minute counts, or hourly totals.` };
  }

  const bins = new Map<number, CountBin>();
  let repeated = false;
  for (const row of raw) {
    const start = Math.floor(row.start / interval) * interval;
    const bin = bins.get(start) ?? { start, volumes: {} };
    if (interval === 15 && sourceInterval === 15 && bins.has(start) && Object.keys(row.volumes).some((k) => bin.volumes[k as MovementKey] !== undefined)) repeated = true;
    for (const [k, n] of Object.entries(row.volumes)) addVolume(bin.volumes, k as MovementKey, n);
    bins.set(start, bin);
  }
  if (repeated && layout !== 'long') notes.push('Some intervals appear more than once; their counts are added together.');
  const sorted = [...bins.values()].sort((x, y) => x.start - y.start);
  const movements = sortMovements([...new Set(sorted.flatMap((b) => Object.keys(b.volumes) as MovementKey[]))]);
  if (movements.length === 0) return { ok: false, error: 'Every count in the file is zero or blank.' };
  return { ok: true, layout, interval, sourceInterval, bins: sorted, movements, notes };
}

const APPROACH_ORDER: Approach[] = ['N', 'S', 'E', 'W', 'NE', 'SW', 'NW', 'SE'];

export function sortMovements(keys: MovementKey[]): MovementKey[] {
  const rank = (k: MovementKey) => {
    const [a, t] = k.split(':') as [Approach, Movement];
    return APPROACH_ORDER.indexOf(a) * 3 + MOVEMENTS.indexOf(t);
  };
  return [...keys].sort((x, y) => rank(x) - rank(y));
}

/** `NB Left` for `N:left`. */
export function movementLabel(key: MovementKey): string {
  const [a, t] = key.split(':') as [Approach, Movement];
  return `${a}B ${t === 'through' ? 'Thru' : t === 'left' ? 'Left' : 'Right'}`;
}

export interface PeakHour {
  /** Minutes after midnight. */
  start: number;
  end: number;
  /** Hourly volume per movement. */
  volumes: Partial<Record<MovementKey, number>>;
  total: number;
  /** Highest 15-minute total in the hour; null for hourly data. */
  peak15: number | null;
  /** total / (4 × peak15), or null when the file has hourly data only. */
  phf: number | null;
}

const binTotal = (bin: CountBin) => Object.values(bin.volumes).reduce((s, n) => s + (n ?? 0), 0);

/**
 * The busiest hour of four consecutive 15-minute bins whose start lies in [from, to) minutes
 * (the whole count by default), or the busiest hourly row for hourly data. Null when no complete
 * hour fits.
 */
export function findPeakHour(counts: Extract<ParsedCounts, { ok: true }>, from = 0, to = 24 * 60): PeakHour | null {
  const byStart = new Map(counts.bins.map((b) => [b.start, b]));
  let best: { start: number; bins: CountBin[]; total: number } | null = null;
  for (const bin of counts.bins) {
    if (bin.start < from || bin.start >= to) continue;
    const hour = counts.interval === 60 ? [bin] : [0, 15, 30, 45].map((m) => byStart.get(bin.start + m));
    if (hour.some((b) => !b)) continue;
    const total = hour.reduce((s, b) => s + binTotal(b!), 0);
    if (!best || total > best.total) best = { start: bin.start, bins: hour as CountBin[], total };
  }
  if (!best) return null;
  const volumes: Partial<Record<MovementKey, number>> = {};
  for (const b of best.bins) for (const [k, n] of Object.entries(b.volumes)) addVolume(volumes, k as MovementKey, n);
  const peak15 = counts.interval === 15 ? Math.max(...best.bins.map(binTotal)) : null;
  return {
    start: best.start,
    end: best.start + 60,
    volumes,
    total: best.total,
    peak15,
    phf: peak15 ? best.total / (4 * peak15) : null,
  };
}

/** Where a counted movement goes: an existing lane group, a new lane group for a phase, or nowhere. */
export type CountTarget = { kind: 'group'; laneGroupId: string } | { kind: 'phase'; phase: number } | { kind: 'skip' };

const PREFERRED_KIND: Record<Movement, string[]> = { left: ['left', 'through', 'other'], through: ['through', 'other'], right: ['right', 'through', 'other'] };

/**
 * The likely lane group for each counted movement: a lane group carrying the movement on a phase
 * for that direction (an exclusive one first), else a lane group of a phase for that direction
 * (a left into the through lanes is a permitted left), else a new lane group for a phase for that
 * direction, else nothing.
 */
export function suggestTargets(intersection: Intersection, movements: readonly MovementKey[]): Record<MovementKey, CountTarget> {
  const phases = new Map(intersection.phases.map((p) => [p.number, p]));
  const result = {} as Record<MovementKey, CountTarget>;
  for (const key of movements) {
    const [approach, turn] = key.split(':') as [Approach, Movement];
    const serving = intersection.laneGroups.filter((g) => {
      const phase = phases.get(g.phase);
      return phase?.enabled && phase.movement.approach === approach;
    });
    const carrying = serving.filter((g) => g.movements[turn]);
    const exclusive = carrying.find((g) => MOVEMENTS.every((m) => m === turn || !g.movements[m]));
    const byKind = (groups: LaneGroup[]) => {
      for (const kind of PREFERRED_KIND[turn]) {
        const found = groups.find((g) => phases.get(g.phase)?.movement.kind === kind);
        if (found) return found;
      }
      return undefined;
    };
    const group = exclusive ?? byKind(carrying) ?? carrying[0] ?? byKind(serving);
    if (group) {
      result[key] = { kind: 'group', laneGroupId: group.id };
      continue;
    }
    const covered = new Set(intersection.laneGroups.map((g) => g.phase));
    const candidates = intersection.phases.filter((p) => p.enabled && p.movement.approach === approach && p.movement.kind !== 'pedestrian' && !covered.has(p.number));
    const phase = PREFERRED_KIND[turn].map((kind) => candidates.find((p) => p.movement.kind === kind)).find(Boolean);
    result[key] = phase ? { kind: 'phase', phase: phase.number } : { kind: 'skip' };
  }
  return result;
}

export interface CountToApply {
  name: string;
  peakHourFactor: number;
  volumes: Partial<Record<MovementKey, number>>;
  targets: Partial<Record<MovementKey, CountTarget>>;
}

export interface AppliedCount {
  volumeSetId: string;
  addedLaneGroups: string[];
  /** Existing lane groups that now carry a movement they did not. */
  widenedLaneGroups: string[];
}

export const MAX_VOLUME = 10_000;

/**
 * Adds the count to the intersection (a recipe for `editIntersection`): new lane groups for
 * movements sent to a phase, the movement enabled on lane groups that did not carry it, and a
 * volume set with every lane group. The first count is linked to the patterns, as when a count is
 * added by hand.
 */
export function applyCount(intersection: Intersection, count: CountToApply, newId: (prefix: string) => string): AppliedCount {
  const addedLaneGroups: string[] = [];
  const widened = new Set<string>();
  const forPhase = new Map<number, LaneGroup>();
  const volumes = new Map<string, Record<Movement, number>>();
  for (const [key, target] of Object.entries(count.targets) as [MovementKey, CountTarget][]) {
    const n = Math.min(MAX_VOLUME, Math.round(count.volumes[key] ?? 0));
    if (target.kind === 'skip') continue;
    const turn = key.split(':')[1] as Movement;
    let group: LaneGroup | undefined;
    if (target.kind === 'group') {
      group = intersection.laneGroups.find((g) => g.id === target.laneGroupId);
    } else {
      group = forPhase.get(target.phase);
      const phase = intersection.phases.find((p) => p.number === target.phase);
      if (!group && phase) {
        group = newLaneGroup(newId('lg'), phase);
        group.movements = { left: false, through: false, right: false };
        intersection.laneGroups.push(group);
        forPhase.set(target.phase, group);
        addedLaneGroups.push(group.id);
      }
    }
    if (!group) continue;
    if (!group.movements[turn]) {
      if (!addedLaneGroups.includes(group.id)) widened.add(group.id);
      group.movements[turn] = true;
    }
    const entry = volumes.get(group.id) ?? { left: 0, through: 0, right: 0 };
    entry[turn] = Math.min(MAX_VOLUME, entry[turn] + n);
    volumes.set(group.id, entry);
  }
  const id = newId('count');
  const set: VolumeSet = {
    id,
    name: count.name.slice(0, 80),
    peakHourFactor: Math.round(Math.min(1, Math.max(0.5, count.peakHourFactor || DEFAULT_PEAK_HOUR_FACTOR)) * 100) / 100,
    volumes: Object.fromEntries(intersection.laneGroups.map((g) => [g.id, volumes.get(g.id) ?? { left: 0, through: 0, right: 0 }])),
  };
  intersection.volumeSets.push(set);
  if (intersection.volumeSets.length === 1) for (const p of intersection.patterns) p.volumeSetId ??= id;
  return { volumeSetId: id, addedLaneGroups, widenedLaneGroups: [...widened] };
}

/** `07:15` for 435. */
export function formatMinute(minute: number): string {
  const m = ((minute % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}
