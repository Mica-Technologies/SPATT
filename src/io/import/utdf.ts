/**
 * Synchro UTDF import: intersections from the combined UTDF CSV file (Universal Traffic Data
 * Format), as written by Synchro's "UTDF combined" export.
 *
 * The file is a set of sections, each a `[Name]` line, a title line, a header row and data rows.
 * Read here (case-insensitive section names, aliases in brackets):
 *
 * - `[Network]`: `Metric` (0 = feet, 1 = metres).
 * - `[Nodes]`: `INTID`, `DESCRIPTION` (the intersection name), `CBD`.
 * - `[Lanes]`: `RECORDNAME,INTID,NBL,NBT,NBR,…,WBR` records `Lanes`, `Shared`, `Width`, `Grade`,
 *   `Phase1`, `PermPhase1`, `IdealFlow`, `Volume`, `PHF`, `HeavyVehicles`.
 * - `[Timeplans]` (`[Timing]`): `RECORDNAME,INTID,DATA`, or `RECORDNAME,INTID,PLANID,DATA` for
 *   several timing plans; records `Control Type`, `Cycle Length`, `Referenced To`,
 *   `Reference Phase`, `Offset`.
 * - `[Phases]` (`[Phasing]`): `RECORDNAME,INTID,D1,…,D16` (optionally with `PLANID` after
 *   `INTID`, giving one plan's values); records `BRP`, `MinGreen`, `MaxGreen`, `VehExt`,
 *   `TimeBeforeReduce`, `TimeToReduce`, `MinGap`, `Yellow`, `AllRed`, `Recall`, `Walk`,
 *   `DontWalk`, `DualEntry`, and `Split` when present.
 * - `[Volume]` (`[Volumes]`): `INTID` and movement columns, optionally `DATE`/`TIME`; used when
 *   `[Lanes]` has no `Volume` record.
 *
 * Code values that the format leaves to the exporting program are read as documented in
 * docs/getting-started/imports.md (recall 0 None, 1 Min, 2 Max, 3 Ped, 4 C-Max, 5 C-Min; offset
 * reference 0 begin of green, 1 begin of yellow, 2 begin of red, 3 TS2 first green, 4 170 style;
 * control type 0 pretimed, 1 semi-actuated, 2 actuated, 3 actuated-coordinated). Everything the
 * import assumes or leaves out is reported per intersection.
 *
 * Tested against a hand-written sample (test/fixtures/utdf), not output from Synchro itself.
 * Pure: no DOM, no host.
 */
import {
  DEFAULT_CAPACITY,
  DEFAULT_LANE_WIDTH,
  DEFAULT_PEAK_HOUR_FACTOR,
  MAX_PHASES,
  MAX_TENTHS,
  makePhase,
  type Approach,
  type Intersection,
  type LaneGroup,
  type Movement,
  type MovementKind,
  type OffsetReference,
  type Pattern,
  type Phase,
  type Ring,
  type VehicleRecall,
} from '../../model';
import { cellNumber, parseCsv } from './csv';

export interface UtdfNote {
  kind: 'assumed' | 'dropped';
  message: string;
}

export interface UtdfIntersection {
  /** The UTDF node id. */
  nodeId: string;
  intersection: Intersection;
  notes: UtdfNote[];
}

export type UtdfResult = { ok: true; intersections: UtdfIntersection[]; notes: UtdfNote[] } | { ok: false; error: string };

interface Section {
  header: string[];
  rows: string[][];
}

const SECTION_ALIASES: Record<string, string> = {
  network: 'network',
  nodes: 'nodes',
  links: 'links',
  lanes: 'lanes',
  timeplans: 'timeplans',
  timing: 'timeplans',
  timingplans: 'timeplans',
  phases: 'phases',
  phasing: 'phases',
  volume: 'volume',
  volumes: 'volume',
};

/** Splits the file into sections: `[Name]`, a title line, then a header row and data rows. */
export function utdfSections(text: string): Map<string, Section> {
  const sections = new Map<string, Section>();
  let current: { name: string; lines: string[][] } | null = null;
  const flush = () => {
    if (!current) return;
    // The title line ("Lane Group Data") has a single cell; the header row is the first with several.
    const body = current.lines.filter((l) => l.some((c) => c !== ''));
    const start = body.findIndex((l) => l.filter((c) => c !== '').length > 1);
    if (start >= 0) sections.set(current.name, { header: body[start]!.map((h) => h.trim()), rows: body.slice(start + 1) });
  };
  for (const row of parseCsv(text, ',')) {
    const marker = /^\[(.+)\]$/.exec(row[0] ?? '');
    if (marker && row.slice(1).every((c) => c === '')) {
      flush();
      const key = marker[1]!.toLowerCase().replace(/[^a-z]/g, '');
      current = { name: SECTION_ALIASES[key] ?? key, lines: [] };
    } else if (current) {
      current.lines.push(row);
    }
  }
  flush();
  return sections;
}

const MOVEMENT_COLUMNS = ['NBL', 'NBT', 'NBR', 'SBL', 'SBT', 'SBR', 'EBL', 'EBT', 'EBR', 'WBL', 'WBT', 'WBR', 'NEL', 'NET', 'NER', 'NWL', 'NWT', 'NWR', 'SEL', 'SET', 'SER', 'SWL', 'SWT', 'SWR'] as const;
const U_TURN_COLUMNS = ['NBU', 'SBU', 'EBU', 'WBU', 'NEU', 'NWU', 'SEU', 'SWU'] as const;
type MovementColumn = (typeof MOVEMENT_COLUMNS)[number];
const TURN_OF: Record<string, Movement> = { L: 'left', T: 'through', R: 'right' };
const APPROACHES: Approach[] = ['N', 'S', 'E', 'W', 'NE', 'NW', 'SE', 'SW'];

function columnApproach(column: string): Approach {
  return (column.length === 3 ? column[0] : column.slice(0, 2)) as Approach;
}
const columnFor = (approach: Approach, turn: Movement) => (approach.length === 1 ? `${approach}B` : approach) + (turn === 'left' ? 'L' : turn === 'through' ? 'T' : 'R');

/** `record name → node → plan ('' = base) → column → cell`, for record-per-row sections. */
type Records = Map<string, Map<string, Map<string, Record<string, string>>>>;

function readRecords(section: Section | undefined): Records {
  const records: Records = new Map();
  if (!section) return records;
  const lower = section.header.map((h) => h.toUpperCase().replace(/\s+/g, ''));
  const nameAt = lower.indexOf('RECORDNAME');
  const nodeAt = lower.indexOf('INTID');
  const planAt = lower.indexOf('PLANID');
  if (nameAt < 0 || nodeAt < 0) return records;
  for (const row of section.rows) {
    const name = (row[nameAt] ?? '').toLowerCase().replace(/\s+/g, '');
    const node = row[nodeAt] ?? '';
    const plan = planAt >= 0 ? (row[planAt] ?? '') : '';
    if (!name || !node) continue;
    const cells: Record<string, string> = {};
    section.header.forEach((h, k) => {
      if (k !== nameAt && k !== nodeAt && k !== planAt) cells[h.toUpperCase()] = row[k] ?? '';
    });
    const byNode = records.get(name) ?? new Map<string, Map<string, Record<string, string>>>();
    const byPlan = byNode.get(node) ?? new Map<string, Record<string, string>>();
    byPlan.set(plan, cells);
    byNode.set(node, byPlan);
    records.set(name, byNode);
  }
  return records;
}

const recordFor = (records: Records, name: string, node: string, plan = ''): Record<string, string> | undefined => {
  const byPlan = records.get(name.toLowerCase().replace(/\s+/g, ''))?.get(node);
  return byPlan?.get(plan) ?? (plan !== '' ? byPlan?.get('') : undefined);
};

const tenths = (seconds: number) => Math.min(MAX_TENTHS, Math.max(0, Math.round(seconds * 10)));
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

const RECALL_CODES: Record<number, { recall: VehicleRecall; ped?: true; coordinated?: true; label: string }> = {
  0: { recall: 'none', label: 'None' },
  1: { recall: 'minimum', label: 'Min' },
  2: { recall: 'maximum', label: 'Max' },
  3: { recall: 'none', ped: true, label: 'Ped' },
  4: { recall: 'none', coordinated: true, label: 'C-Max' },
  5: { recall: 'none', coordinated: true, label: 'C-Min' },
};

const REFERENCE_CODES: Record<number, { reference: OffsetReference; label: string; exact: boolean; toRed?: true }> = {
  0: { reference: 'beginCoordGreen', label: 'begin of green', exact: true },
  1: { reference: 'beginCoordYellow', label: 'begin of yellow', exact: true },
  2: { reference: 'beginCoordYellow', label: 'begin of red', exact: true, toRed: true },
  3: { reference: 'beginCoordGreen', label: 'TS2 first green', exact: false },
  4: { reference: 'beginCoordYellow', label: '170 style', exact: false },
};

const CONTROL_TYPES = ['Pretimed', 'Semi-actuated, uncoordinated', 'Actuated, uncoordinated', 'Actuated, coordinated'];

/** Phases from `Reference Phase`: `206` is phases 2 and 6, `2` is phase 2, `412` is 4 and 12. */
export function referencePhases(value: string): number[] {
  const digits = value.trim();
  if (!/^\d+$/.test(digits)) return [];
  const n = Number(digits);
  if (n >= 1 && n <= MAX_PHASES) return [n];
  if (digits.length === 3) return [Number(digits[0]), Number(digits.slice(1))].filter((p) => p >= 1 && p <= MAX_PHASES);
  if (digits.length === 4) return [Number(digits.slice(0, 2)), Number(digits.slice(2))].filter((p) => p >= 1 && p <= MAX_PHASES);
  return [];
}

const KIND_LABEL: Record<Movement, string> = { left: 'Left', through: 'Thru', right: 'Right' };
const KIND_OF: Record<Movement, MovementKind> = { left: 'left', through: 'through', right: 'right' };

/** Rings from BRP codes (barrier, ring, position), or the standard dual ring when there are none. */
function ringsFrom(numbers: number[], brp: Map<number, string>, notes: UtdfNote[]): Ring[] {
  const placed = numbers.flatMap((n) => {
    const code = brp.get(n)?.trim() ?? '';
    return /^\d{3}$/.test(code) ? [{ n, barrier: Number(code[0]), ring: Number(code[1]), position: Number(code[2]) }] : [];
  });
  if (placed.length === numbers.length && placed.length > 0) {
    const barriers = [...new Set(placed.map((p) => p.barrier))].sort((a, b) => a - b);
    const rings = [...new Set(placed.map((p) => p.ring))].sort((a, b) => a - b).slice(0, 4);
    if (new Set(placed.map((p) => p.ring)).size > 4) notes.push({ kind: 'dropped', message: 'Phases in a fifth ring or beyond were left out of the ring structure.' });
    return rings.map((r) => ({
      groups: barriers.map((b) =>
        placed
          .filter((p) => p.ring === r && p.barrier === b)
          .sort((x, y) => x.position - y.position)
          .map((p) => p.n),
      ),
    }));
  }
  notes.push({ kind: 'assumed', message: 'No usable BRP (barrier, ring, position) codes: phases 1–4 are put in ring 1 and 5–8 in ring 2, with the barrier after 2 and 6.' });
  const ring = (lo: number) => ({ groups: [[lo, lo + 1], [lo + 2, lo + 3]].map((g) => g.filter((n) => numbers.includes(n))) });
  const rings = [ring(1), ring(5)].filter((r) => r.groups.some((g) => g.length > 0));
  const outside = numbers.filter((n) => n > 8);
  if (outside.length > 0) notes.push({ kind: 'dropped', message: `Phases ${outside.join(', ')} have no place in the assumed rings and were left out of them.` });
  return rings.length > 0 ? rings : [{ groups: [[]] }];
}

interface BuildContext {
  nodeId: string;
  name: string;
  cbd: boolean;
  metric: boolean;
  lanes: Records;
  timing: Records;
  phases: Records;
  volumeRows: Section | undefined;
  newId: (prefix: string) => string;
}

function buildIntersection(ctx: BuildContext): UtdfIntersection | null {
  const notes: UtdfNote[] = [];
  const { nodeId } = ctx;
  const phaseRecord = (name: string, plan = '') => recordFor(ctx.phases, name, nodeId, plan);
  const brp = phaseRecord('BRP');
  const columns = new Set([...(ctx.phases.values())].flatMap((byNode) => [...(byNode.get(nodeId)?.values() ?? [])].flatMap((cells) => Object.keys(cells))));
  // A phase exists when any base record gives it a value.
  const numbers = [...columns]
    .map((c) => /^D(\d+)$/.exec(c))
    .filter((m): m is RegExpExecArray => m !== null)
    .map((m) => Number(m[1]))
    .filter((n) => [...ctx.phases.values()].some((byNode) => (byNode.get(nodeId)?.get('')?.[`D${n}`] ?? '').trim() !== ''))
    .sort((a, b) => a - b);
  if (numbers.length === 0) return null;
  const tooHigh = numbers.filter((n) => n > MAX_PHASES);
  if (tooHigh.length > 0) notes.push({ kind: 'dropped', message: `Phases ${tooHigh.join(', ')} are beyond phase ${MAX_PHASES} and were left out.` });
  const phaseNumbers = numbers.filter((n) => n >= 1 && n <= MAX_PHASES);

  const value = (record: string, n: number, plan = '') => cellNumber(phaseRecord(record, plan)?.[`D${n}`]);
  const missing = new Set<string>();
  const seconds = (record: string, n: number, fallback: number) => {
    const v = value(record, n);
    if (v === null) {
      missing.add(record);
      return fallback;
    }
    return tenths(v);
  };

  // Movements served by each phase, from the lanes' protected and permitted phases.
  const served = new Map<number, { approach: Approach; turn: Movement; permitted: boolean }[]>();
  for (const [record, permitted] of [['Phase1', false], ['PermPhase1', true]] as const) {
    const cells = recordFor(ctx.lanes, record, nodeId);
    for (const column of MOVEMENT_COLUMNS) {
      const n = cellNumber(cells?.[column]);
      if (n === null || n <= 0) continue;
      const list = served.get(n) ?? [];
      list.push({ approach: columnApproach(column), turn: TURN_OF[column.at(-1)!]!, permitted });
      served.set(n, list);
    }
  }

  const coordinatedByRecall: number[] = [];
  const phases: Phase[] = phaseNumbers.map((n) => {
    const protectedMoves = (served.get(n) ?? []).filter((m) => !m.permitted);
    const moves = protectedMoves.length > 0 ? protectedMoves : (served.get(n) ?? []);
    const main = moves.find((m) => m.turn === 'through') ?? moves.find((m) => m.turn === 'left') ?? moves[0];
    const walk = value('Walk', n);
    const dontWalk = value('DontWalk', n);
    const ped = (walk ?? 0) > 0 || (dontWalk ?? 0) > 0 ? { walk: tenths(walk ?? 0), clearance: tenths(dontWalk ?? 0) } : undefined;
    const phase = makePhase(n, {
      label: main ? `${main.approach}B ${KIND_LABEL[main.turn]}` : `Phase ${n}`,
      approach: main?.approach ?? null,
      kind: main ? KIND_OF[main.turn] : 'through',
      minGreen: seconds('MinGreen', n, 50),
      maxGreen1: seconds('MaxGreen', n, 300),
      yellow: seconds('Yellow', n, 35),
      redClear: seconds('AllRed', n, 15),
      ped,
    });
    phase.passage = seconds('VehExt', n, phase.passage);
    phase.volumeDensity.timeBeforeReduction = tenths(value('TimeBeforeReduce', n) ?? 0);
    phase.volumeDensity.timeToReduce = tenths(value('TimeToReduce', n) ?? 0);
    phase.volumeDensity.minGap = tenths(value('MinGap', n) ?? 0);
    phase.dualEntry = (value('DualEntry', n) ?? 0) > 0;
    const code = value('Recall', n);
    if (code !== null) {
      const recall = RECALL_CODES[code];
      if (recall) {
        phase.recall = recall.recall;
        if (recall.ped && phase.pedestrian.enabled) phase.pedestrian.recall = true;
        if (recall.coordinated) coordinatedByRecall.push(n);
      } else {
        notes.push({ kind: 'dropped', message: `Phase ${n}: recall code ${code} is not known; no recall set.` });
      }
    }
    if (!main) notes.push({ kind: 'assumed', message: `Phase ${n} serves no lane in [Lanes]: it has no direction and is taken as a through phase.` });
    return phase;
  });
  if (missing.size > 0) notes.push({ kind: 'assumed', message: `Missing ${[...missing].join(', ')} values were given SPATT's defaults.` });
  if (coordinatedByRecall.length > 0) notes.push({ kind: 'assumed', message: `C-Max/C-Min recall on phases ${coordinatedByRecall.join(', ')} is read as coordination; their vehicle recall is None.` });

  const brpByPhase = new Map(phaseNumbers.map((n) => [n, brp?.[`D${n}`] ?? '']));
  const rings = ringsFrom(phaseNumbers, brpByPhase, notes);

  // Timing plans: one pattern each.
  const planIds = [...new Set([...ctx.timing.values()].flatMap((byNode) => [...(byNode.get(nodeId)?.keys() ?? [])]))];
  const patterns: Pattern[] = [];
  const ringed = new Set(rings.flatMap((r) => r.groups.flat()));
  for (const plan of planIds.length > 0 ? planIds : ['']) {
    const timing = (name: string) => cellNumber(recordFor(ctx.timing, name, nodeId, plan)?.DATA);
    const planName = plan || 'Synchro plan';
    const cycle = timing('Cycle Length');
    if (cycle === null || cycle <= 0) {
      notes.push({ kind: 'dropped', message: `Timing plan ${planName} has no cycle length and was left out.` });
      continue;
    }
    const control = timing('Control Type') ?? 3;
    const coordinated = control === 0 || control === 3;
    const splits: Record<string, number> = {};
    for (const n of phaseNumbers) {
      if (!ringed.has(n)) continue;
      const split = value('Split', n, plan);
      const phase = phases.find((p) => p.number === n)!;
      const maxGreen = value('MaxGreen', n, plan);
      splits[String(n)] = split !== null ? tenths(split) : Math.min(MAX_TENTHS, (maxGreen !== null ? tenths(maxGreen) : phase.maxGreen1) + phase.yellow + phase.redClear);
    }
    const reference = REFERENCE_CODES[timing('Referenced To') ?? 0] ?? REFERENCE_CODES[0]!;
    const coordinatedPhases = referencePhases(recordFor(ctx.timing, 'Reference Phase', nodeId, plan)?.DATA ?? '').filter((n) => ringed.has(n));
    const coordPhases = coordinatedPhases.length > 0 ? coordinatedPhases : coordinatedByRecall.filter((n) => ringed.has(n));
    const cycleTenths = tenths(cycle);
    let offset = tenths(timing('Offset') ?? 0) % Math.max(1, cycleTenths);
    if (coordinated && reference.toRed) {
      // Begin of red is begin of yellow plus the yellow of the first coordinated phase.
      const yellow = phases.find((p) => p.number === coordPhases[0])?.yellow ?? 0;
      offset = (((offset - yellow) % cycleTenths) + cycleTenths) % cycleTenths;
      notes.push({ kind: 'assumed', message: `${planName}: the offset to the begin of red is converted to the end of coordinated green.` });
    } else if (coordinated && !reference.exact) {
      notes.push({ kind: 'assumed', message: `${planName}: the ${reference.label} offset reference is taken as the ${reference.reference === 'beginCoordGreen' ? 'begin' : 'end'} of coordinated green.` });
    }
    if (coordinated && coordPhases.length === 0) notes.push({ kind: 'assumed', message: `${planName}: no reference phase; choose the coordinated phases on the Patterns tab.` });
    if (!coordinated) notes.push({ kind: 'assumed', message: `${planName}: ${CONTROL_TYPES[control]?.toLowerCase() ?? `control type ${control}`}, so the pattern runs free; its cycle and splits are kept for reference.` });
    if (control === 0) {
      for (const p of phases) if (ringed.has(p.number)) p.recall = 'maximum';
      notes.push({ kind: 'assumed', message: 'Pretimed control: every phase is set to max recall.' });
    }
    patterns.push({
      id: ctx.newId('pattern'),
      name: planName.slice(0, 80),
      mode: coordinated ? 'coordinated' : 'free',
      cycle: cycleTenths,
      offset,
      offsetReference: reference.reference,
      coordinatedPhases: coordinated ? coordPhases : [],
      splits,
      sequence: null,
      maxGreen: 'max1',
      forceOffMode: 'fixed',
      volumeSetId: null,
    });
  }
  if (patterns.length === 0) notes.push({ kind: 'assumed', message: 'No timing plan: the intersection has no pattern and runs free.' });

  // Lane groups and the count.
  const lanes = (record: string, column: string) => cellNumber(recordFor(ctx.lanes, record, nodeId)?.[column]);
  const hasLanes = recordFor(ctx.lanes, 'Lanes', nodeId) !== undefined;
  const laneGroups: LaneGroup[] = [];
  const groupOf = new Map<MovementColumn, LaneGroup>();
  const toMetres = (width: number) => (ctx.metric ? width : width * 0.3048);
  if (hasLanes) {
    for (const approach of APPROACHES) {
      const col = (turn: Movement) => columnFor(approach, turn) as MovementColumn;
      const count = (turn: Movement) => lanes('Lanes', col(turn)) ?? 0;
      const shared = lanes('Shared', col('through')) ?? 0;
      const plans: { primary: Movement; movements: Movement[]; lanes: number }[] = [];
      if (count('through') > 0) {
        plans.push({ primary: 'through', movements: ['through', ...(shared & 1 ? (['left'] as const) : []), ...(shared & 2 ? (['right'] as const) : [])], lanes: count('through') });
      }
      if (count('left') > 0) plans.push({ primary: 'left', movements: ['left'], lanes: count('left') });
      if (count('right') > 0) plans.push({ primary: 'right', movements: ['right'], lanes: count('right') });
      for (const plan of plans) {
        const column = col(plan.primary);
        const protectedPhase = lanes('Phase1', column);
        const permittedPhase = lanes('PermPhase1', column);
        const phaseNumber = [protectedPhase, permittedPhase].find((n) => n !== null && n > 0 && phases.some((p) => p.number === n));
        const label = `${approach}B ${plan.movements.map((m) => KIND_LABEL[m]).join('/')}`;
        if (phaseNumber == null) {
          notes.push({ kind: 'dropped', message: `Lane group ${label}: no phase in this file serves it, so it was left out.` });
          continue;
        }
        if (protectedPhase && permittedPhase && protectedPhase !== permittedPhase) {
          notes.push({ kind: 'assumed', message: `Lane group ${label} is protected-permitted; it is analysed on its protected phase ${protectedPhase} only.` });
        }
        const width = lanes('Width', column);
        const grade = lanes('Grade', column) ?? 0;
        const heavy = lanes('HeavyVehicles', column) ?? 2;
        const group: LaneGroup = {
          id: ctx.newId('lg'),
          label,
          phase: phaseNumber,
          movements: { left: plan.movements.includes('left'), through: plan.movements.includes('through'), right: plan.movements.includes('right') },
          lanes: clamp(Math.round(plan.lanes), 1, 8),
          laneWidth: Math.round(clamp(width !== null ? toMetres(width) : DEFAULT_LANE_WIDTH, 2, 6) * 100) / 100,
          heavyVehiclesPercent: clamp(heavy, 0, 100),
          gradePercent: clamp(grade, -10, 10),
          saturationFlow: null,
        };
        laneGroups.push(group);
        for (const m of plan.movements) groupOf.set(col(m), group);
      }
    }
    if (laneGroups.length > 32) {
      notes.push({ kind: 'dropped', message: `Only the first 32 of ${laneGroups.length} lane groups were kept.` });
      laneGroups.length = 32;
    }
  } else {
    notes.push({ kind: 'dropped', message: 'No [Lanes] data: no lane groups or count.' });
  }

  // Volumes: the Lanes Volume record, else the busiest row of a [Volume] section.
  const volumeSets: Intersection['volumeSets'] = [];
  let volumes: Record<string, number> | null = null;
  const laneVolumes = recordFor(ctx.lanes, 'Volume', nodeId);
  if (laneVolumes) {
    volumes = Object.fromEntries([...MOVEMENT_COLUMNS, ...U_TURN_COLUMNS].map((c) => [c, cellNumber(laneVolumes[c]) ?? 0]));
  } else if (ctx.volumeRows) {
    const header = ctx.volumeRows.header.map((h) => h.toUpperCase());
    const node = header.indexOf('INTID');
    const rows = ctx.volumeRows.rows.filter((r) => r[node] === nodeId);
    const totals = rows.map((r) => [...MOVEMENT_COLUMNS, ...U_TURN_COLUMNS].reduce((s, c) => s + (cellNumber(r[header.indexOf(c)]) ?? 0), 0));
    const best = totals.indexOf(Math.max(...totals));
    if (best >= 0) {
      volumes = Object.fromEntries([...MOVEMENT_COLUMNS, ...U_TURN_COLUMNS].map((c) => [c, cellNumber(rows[best]![header.indexOf(c)]) ?? 0]));
      if (rows.length > 1) notes.push({ kind: 'assumed', message: `[Volume] has ${rows.length} rows for this node; the busiest is used as the hourly count.` });
    }
  }
  if (volumes && laneGroups.length > 0) {
    const byGroup = new Map<string, Record<Movement, number>>();
    const unserved: string[] = [];
    for (const [column, n] of Object.entries(volumes)) {
      if (n <= 0) continue;
      // U-turns are counted with the lefts.
      const target = (column.endsWith('U') ? column.slice(0, -1) + 'L' : column) as MovementColumn;
      const group = groupOf.get(target);
      if (!group || !laneGroups.includes(group)) {
        unserved.push(column);
        continue;
      }
      const turn = TURN_OF[target.at(-1)!]!;
      const entry = byGroup.get(group.id) ?? { left: 0, through: 0, right: 0 };
      entry[turn] = Math.min(10_000, entry[turn] + Math.round(n));
      byGroup.set(group.id, entry);
    }
    if (unserved.length > 0) notes.push({ kind: 'dropped', message: `Volumes for ${unserved.join(', ')} have no lane group to go in and were left out.` });
    if (Object.keys(volumes).some((c) => c.endsWith('U') && volumes![c]! > 0)) notes.push({ kind: 'assumed', message: 'U-turn volumes are counted as lefts.' });
    // PHF: the volume-weighted average of the movements' factors.
    const phfCells = recordFor(ctx.lanes, 'PHF', nodeId);
    let weighted = 0;
    let weight = 0;
    for (const column of MOVEMENT_COLUMNS) {
      const phf = cellNumber(phfCells?.[column]);
      const n = volumes[column] ?? 0;
      if (phf !== null && phf > 0 && n > 0) {
        weighted += phf * n;
        weight += n;
      }
    }
    const phf = weight > 0 ? Math.round(clamp(weighted / weight, 0.5, 1) * 100) / 100 : DEFAULT_PEAK_HOUR_FACTOR;
    if (weight === 0) notes.push({ kind: 'assumed', message: `No PHF values: the count uses ${DEFAULT_PEAK_HOUR_FACTOR}.` });
    const distinctPhf = new Set(MOVEMENT_COLUMNS.map((c) => cellNumber(phfCells?.[c])).filter((v) => v !== null && v > 0));
    if (distinctPhf.size > 1) notes.push({ kind: 'assumed', message: `Movement PHFs differ; the count uses their volume-weighted average, ${phf.toFixed(2)}.` });
    const setId = ctx.newId('count');
    volumeSets.push({ id: setId, name: 'Synchro volumes', peakHourFactor: phf, volumes: Object.fromEntries(laneGroups.map((g) => [g.id, byGroup.get(g.id) ?? { left: 0, through: 0, right: 0 }])) });
    for (const p of patterns) p.volumeSetId = setId;
  }

  const idealFlow = lanes('IdealFlow', 'NBT') ?? lanes('IdealFlow', 'EBT') ?? lanes('IdealFlow', 'SBT') ?? lanes('IdealFlow', 'WBT');
  const intersection: Intersection = {
    id: ctx.newId('i'),
    name: ctx.name.slice(0, 120),
    notes: `Imported from a Synchro UTDF file (node ${nodeId}).`,
    phases,
    rings,
    redAmber: 0,
    greenFlash: 0,
    overlaps: [],
    preempts: [],
    patterns,
    schedule: [],
    capacity: { baseSaturationFlow: idealFlow !== null && idealFlow > 0 ? clamp(Math.round(idealFlow), 1, 3000) : DEFAULT_CAPACITY.baseSaturationFlow, centralBusinessDistrict: ctx.cbd },
    laneGroups,
    volumeSets,
  };
  if (patterns.length > 0) notes.push({ kind: 'assumed', message: 'No schedule is imported: add one on the Schedule tab to choose when each pattern runs.' });
  return { nodeId, intersection, notes };
}

/** Reads a combined UTDF CSV file. `newId(prefix)` makes the ids of everything created. */
export function importUtdf(text: string, newId: (prefix: string) => string): UtdfResult {
  const sections = utdfSections(text);
  if (!sections.has('phases')) {
    return { ok: false, error: sections.size === 0 ? 'This is not a UTDF file: no [Section] headings were found.' : 'The file has no [Phases] section, so there is no signal timing to import.' };
  }
  const notes: UtdfNote[] = [];
  const network = sections.get('network');
  const metricRow = network?.rows.find((r) => (r[0] ?? '').toLowerCase() === 'metric');
  const metric = cellNumber(metricRow?.[1]) === 1;
  const nodes = sections.get('nodes');
  const nodeHeader = nodes?.header.map((h) => h.toUpperCase()) ?? [];
  const nodeInfo = new Map(
    (nodes?.rows ?? []).map((r) => [r[nodeHeader.indexOf('INTID')] ?? '', { name: r[nodeHeader.indexOf('DESCRIPTION')] ?? '', cbd: cellNumber(r[nodeHeader.indexOf('CBD')]) === 1 }]),
  );
  const lanes = readRecords(sections.get('lanes'));
  const timing = readRecords(sections.get('timeplans'));
  const phases = readRecords(sections.get('phases'));
  const nodeIds = [...new Set([...phases.values()].flatMap((byNode) => [...byNode.keys()]))].sort((a, b) => Number(a) - Number(b) || a.localeCompare(b));
  const used = new Set(['brp', 'mingreen', 'maxgreen', 'vehext', 'timebeforereduce', 'timetoreduce', 'mingap', 'yellow', 'allred', 'recall', 'walk', 'dontwalk', 'dualentry', 'split']);
  const ignored = [...phases.keys()].filter((k) => !used.has(k));
  if (ignored.length > 0) notes.push({ kind: 'dropped', message: `Phase records not used: ${ignored.join(', ')} (SPATT works these out from the timing itself, or has no equivalent).` });
  if (!sections.has('lanes')) notes.push({ kind: 'dropped', message: 'No [Lanes] section: phases get no directions, and no lane groups or counts are made.' });
  const skipped = [...nodeInfo.keys()].filter((id) => id && !nodeIds.includes(id));
  if (skipped.length > 0) notes.push({ kind: 'dropped', message: `Nodes without signal phasing were skipped: ${skipped.join(', ')}.` });

  const intersections = nodeIds.flatMap((nodeId) => {
    const info = nodeInfo.get(nodeId);
    const built = buildIntersection({
      nodeId,
      name: info?.name.trim() || `Node ${nodeId}`,
      cbd: info?.cbd ?? false,
      metric,
      lanes,
      timing,
      phases,
      volumeRows: sections.get('volume'),
      newId,
    });
    return built ? [built] : [];
  });
  if (intersections.length === 0) return { ok: false, error: 'No intersection in the file has signal phasing.' };
  return { ok: true, intersections, notes };
}
