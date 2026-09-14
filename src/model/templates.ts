/**
 * Starting points for new intersections, and the fixtures the test suite is built on.
 * Values are in tenths of a second.
 */
import type { Approach, Intersection, MovementKind, Pattern, Phase, Project, Ring } from './schema';
import { PROJECT_SCHEMA_VERSION } from './schema';
import { DEFAULT_CAPACITY } from './capacity';

interface PhaseOptions {
  label: string;
  approach: Approach | null;
  kind: MovementKind;
  minGreen: number;
  maxGreen1: number;
  yellow: number;
  redClear: number;
  /** Walk and pedestrian clearance; omit for no pedestrian service. */
  ped?: { walk: number; clearance: number };
}

export function makePhase(number: number, options: PhaseOptions): Phase {
  return {
    number,
    label: options.label,
    enabled: true,
    movement: { approach: options.approach, kind: options.kind },
    minGreen: options.minGreen,
    passage: options.kind === 'left' ? 20 : 30,
    maxGreen1: options.maxGreen1,
    maxGreen2: 0,
    yellow: options.yellow,
    redClear: options.redClear,
    volumeDensity: { addedInitialPerActuation: 0, maxInitial: 0, timeBeforeReduction: 0, timeToReduce: 0, minGap: 0 },
    recall: 'none',
    pedestrian: {
      enabled: options.ped !== undefined,
      walk: options.ped?.walk ?? 0,
      clearance: options.ped?.clearance ?? 0,
      recall: false,
      restInWalk: false,
    },
    lockingDetector: false,
    dualEntry: false,
    conditionalService: false,
  };
}

const left = (label: string, approach: Approach): PhaseOptions => ({
  label,
  approach,
  kind: 'left',
  minGreen: 50,
  maxGreen1: 200,
  yellow: 35,
  redClear: 15,
});

const through = (label: string, approach: Approach, pedClearance: number, maxGreen1: number): PhaseOptions => ({
  label,
  approach,
  kind: 'through',
  minGreen: 100,
  maxGreen1,
  yellow: 40,
  redClear: 20,
  ped: { walk: 70, clearance: pedClearance },
});

export function coordinatedPattern(id: string, name: string, cycle: number, splits: Record<number, number>, coordinatedPhases = [2, 6]): Pattern {
  return {
    id,
    name,
    mode: 'coordinated',
    cycle,
    offset: 0,
    offsetReference: 'beginCoordGreen',
    coordinatedPhases,
    splits: Object.fromEntries(Object.entries(splits).map(([k, v]) => [k, v])),
    sequence: null,
    maxGreen: 'max1',
    forceOffMode: 'fixed',
    volumeSetId: null,
  };
}

function intersection(id: string, name: string, phases: Phase[], rings: Ring[], patterns: Pattern[]): Intersection {
  return {
    id,
    name,
    notes: '',
    phases,
    rings,
    overlaps: [],
    preempts: [],
    patterns,
    schedule: patterns.length > 0 ? [{ startMinute: 6 * 60, patternId: patterns[0]!.id }, { startMinute: 22 * 60, patternId: null }] : [],
    capacity: { ...DEFAULT_CAPACITY },
    laneGroups: [],
    volumeSets: [],
  };
}

/**
 * The standard NEMA eight-phase intersection: protected lefts leading in both directions,
 * main street on 2/6, side street on 4/8, coordinated 90 s with 2 and 6 coordinated.
 */
export function standardEightPhase(id = 'standard-8-phase'): Intersection {
  const phases = [
    makePhase(1, left('WB Left', 'W')),
    makePhase(2, through('EB Thru', 'E', 180, 400)),
    makePhase(3, left('NB Left', 'N')),
    makePhase(4, through('SB Thru', 'S', 140, 300)),
    makePhase(5, left('EB Left', 'E')),
    makePhase(6, through('WB Thru', 'W', 180, 400)),
    makePhase(7, left('SB Left', 'S')),
    makePhase(8, through('NB Thru', 'N', 140, 300)),
  ];
  const rings: Ring[] = [
    { groups: [[1, 2], [3, 4]] },
    { groups: [[5, 6], [7, 8]] },
  ];
  // Barrier A: 15 + 35 = 50 in both rings; barrier B: 12 + 28 = 40; cycle 90.
  const splits = { 1: 150, 2: 350, 3: 120, 4: 280, 5: 150, 6: 350, 7: 120, 8: 280 };
  return intersection(id, 'Main St & Side St', phases, rings, [coordinatedPattern('am-peak', 'AM Peak', 900, splits)]);
}

/** The eight-phase intersection with the ring 1 main-street left lagging (2 before 1). */
export function leadLagEightPhase(id = 'lead-lag-8-phase'): Intersection {
  const base = standardEightPhase(id);
  const pattern = base.patterns[0]!;
  pattern.id = 'pm-peak-lead-lag';
  pattern.name = 'PM Peak (lead-lag)';
  pattern.sequence = [
    { groups: [[2, 1], [3, 4]] },
    { groups: [[5, 6], [7, 8]] },
  ];
  base.schedule = [{ startMinute: 15 * 60, patternId: pattern.id }];
  return base;
}

/**
 * Main street with leading lefts; the two side-street approaches split-phased, each in its own
 * barrier group, so ring 2 is empty in groups 2 and 3.
 */
export function splitPhaseSideStreet(id = 'split-phase-side-street'): Intersection {
  const phases = [
    makePhase(1, left('WB Left', 'W')),
    makePhase(2, through('EB Thru', 'E', 180, 400)),
    makePhase(4, { ...through('SB All', 'S', 140, 250), label: 'SB All' }),
    makePhase(5, left('EB Left', 'E')),
    makePhase(6, through('WB Thru', 'W', 180, 400)),
    makePhase(8, { ...through('NB All', 'N', 140, 250), label: 'NB All' }),
  ];
  const rings: Ring[] = [
    { groups: [[1, 2], [4], [8]] },
    { groups: [[5, 6], [], []] },
  ];
  const splits = { 1: 150, 2: 450, 5: 150, 6: 450, 4: 300, 8: 300 };
  return intersection(id, 'Harbor Rd & Split Ave', phases, rings, [coordinatedPattern('midday', 'Midday', 1200, splits)]);
}

/** Two phases per ring, no protected lefts: 2+6 main street, 4+8 side street. */
export function twoPhase(id = 'two-phase'): Intersection {
  const phases = [
    makePhase(2, through('EB', 'E', 160, 350)),
    makePhase(4, through('SB', 'S', 120, 250)),
    makePhase(6, through('WB', 'W', 160, 350)),
    makePhase(8, through('NB', 'N', 120, 250)),
  ];
  const rings: Ring[] = [
    { groups: [[2], [4]] },
    { groups: [[6], [8]] },
  ];
  const splits = { 2: 400, 4: 300, 6: 400, 8: 300 };
  return intersection(id, 'Elm St & 3rd Ave', phases, rings, [coordinatedPattern('all-day', 'All Day', 700, splits)]);
}

/**
 * The plan a new CSM ASC-3 controller starts with: 8 phases, CSM's default timers (min green
 * 100 ticks, passage 40, max 600, yellow 70, red clear 40, walk 140, pedestrian clearance 200)
 * and its default 90 s coordination with even splits.
 */
export function csmDefault(id = 'csm-default'): Intersection {
  const csmPhase = (number: number, kind: MovementKind, label: string): Phase => ({
    ...makePhase(number, {
      label,
      approach: null,
      kind,
      minGreen: 50,
      maxGreen1: 300,
      yellow: 35,
      redClear: 20,
      ped: { walk: 70, clearance: 100 },
    }),
    passage: 20,
  });
  const phases = [1, 2, 3, 4, 5, 6, 7, 8].map((n) => csmPhase(n, n % 2 === 1 ? 'left' : 'through', `Phase ${n}`));
  const rings: Ring[] = [
    { groups: [[1, 2], [3, 4]] },
    { groups: [[5, 6], [7, 8]] },
  ];
  const splits = Object.fromEntries(phases.map((p) => [p.number, 225]));
  const pattern = coordinatedPattern('csm-slot-0', 'Pattern 1', 900, splits);
  pattern.mode = 'free';
  pattern.offsetReference = 'firstPhaseStart';
  return { ...intersection(id, 'CSM ASC-3 default', phases, rings, [pattern]), schedule: [] };
}

export function emptyProject(name: string, id: string, now: Date = new Date()): Project {
  const timestamp = now.toISOString();
  return {
    app: 'spatt',
    schemaVersion: PROJECT_SCHEMA_VERSION,
    id,
    name,
    notes: '',
    units: { length: 'ft', speed: 'mph' },
    intersections: [],
    corridors: [],
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}
