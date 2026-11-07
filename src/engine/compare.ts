/**
 * Plan compare: what differs between two timing patterns, either two patterns of one
 * intersection or one intersection's pattern in two projects.
 *
 * The comparison is field by field and phase by phase. Values stay in model units (integer
 * tenths for durations); the UI formats them. When both patterns are linked to a count, each is
 * analysed with `analyzePattern` and the delay, v/c and level of service are set side by side.
 */
import { effectiveSequence, type Intersection, type OffsetReference, type Pattern, type Phase, type Tenths, type VehicleRecall } from '../model';
import { analyzePattern, type Los, type PatternAnalysis } from './capacity';
import { convertOffset, projectCycle } from './projection';

/** One side of a comparison. */
export interface CompareSide {
  intersection: Intersection;
  patternId: string;
}

export type FieldValue = number | string | boolean | null;

/** How a value is shown: a duration in tenths, plain text, yes/no, or a list of phase numbers. */
export type FieldFormat = 'tenths' | 'text' | 'boolean' | 'phases';

export interface FieldDiff {
  key: string;
  label: string;
  format: FieldFormat;
  a: FieldValue;
  b: FieldValue;
  changed: boolean;
  /** b − a, for durations present on both sides. */
  delta: number | null;
}

export interface PhaseDiff {
  phase: number;
  label: string;
  /** Whether the phase is defined and enabled on each side. */
  inA: boolean;
  inB: boolean;
  fields: FieldDiff[];
  changed: boolean;
}

export interface RingOrderDiff {
  ring: number;
  /** The ring's phases in timing order, barrier groups separated, as on the sheet: `1 2 | 3 4`. */
  a: string | null;
  b: string | null;
  changed: boolean;
}

export interface CapacityValues {
  volumeToCapacity: number | null;
  delay: number | null;
  los: Los | null;
}

export interface CapacityRow {
  key: string;
  label: string;
  a: CapacityValues | null;
  b: CapacityValues | null;
}

export interface CapacityComparison {
  countA: string;
  countB: string;
  /** Intersection delay, critical v/c (Xc) and LOS. */
  overall: CapacityRow;
  laneGroups: CapacityRow[];
}

export interface PlanComparison {
  pattern: FieldDiff[];
  phases: PhaseDiff[];
  rings: RingOrderDiff[];
  /** `null` unless both patterns have an analysable count; `reasons` says why not. */
  capacity: CapacityComparison | null;
  capacityReasons: { a: string | null; b: string | null };
  /** Number of changed values (pattern fields, phase fields and ring orders). */
  changeCount: number;
}

const RECALL_TEXT: Record<VehicleRecall, string> = { none: 'None', minimum: 'Min', maximum: 'Max', soft: 'Soft' };
const REFERENCE_TEXT: Record<OffsetReference, string> = {
  beginCoordGreen: 'Begin of coord. green',
  beginCoordYellow: 'End of coord. green',
  firstPhaseStart: 'Start of ring sequence',
};

function field(key: string, label: string, format: FieldFormat, a: FieldValue, b: FieldValue): FieldDiff {
  const changed = a !== b;
  const delta = format === 'tenths' && typeof a === 'number' && typeof b === 'number' ? b - a : null;
  return { key, label, format, a, b, changed, delta };
}

const phaseList = (phases: readonly number[]) => [...phases].sort((x, y) => x - y).join(', ');

/** The ring's phase order as text, enabled phases only. */
export function ringOrderText(groups: readonly (readonly number[])[], enabled: (n: number) => boolean): string {
  return groups.map((g) => g.filter(enabled).join(' ') || '–').join(' | ');
}

/**
 * Field-by-field differences of two patterns (mode, cycle, offset, reference, coordinated phases,
 * max green, force-off mode). When the offset references differ and both project, B's offset is
 * also given against A's reference, which is the number that says whether the timing on the ground moved.
 */
function patternFields(a: CompareSide & { pattern: Pattern }, b: CompareSide & { pattern: Pattern }): FieldDiff[] {
  const pa = a.pattern;
  const pb = b.pattern;
  const fields = [
    field('mode', 'Mode', 'text', pa.mode === 'free' ? 'Free' : 'Coordinated', pb.mode === 'free' ? 'Free' : 'Coordinated'),
    field('cycle', 'Cycle', 'tenths', pa.cycle, pb.cycle),
    field('offset', 'Offset', 'tenths', pa.offset, pb.offset),
    field('offsetReference', 'Offset reference', 'text', REFERENCE_TEXT[pa.offsetReference], REFERENCE_TEXT[pb.offsetReference]),
  ];
  if (pa.offsetReference !== pb.offsetReference) {
    const projected = projectCycle(b.intersection, pb.id);
    if (projected.ok) {
      fields.push(field('offsetAsA', `Offset to ${REFERENCE_TEXT[pa.offsetReference].toLowerCase()}`, 'tenths', pa.offset, convertOffset(projected.projection, pa.offsetReference)));
    }
  }
  fields.push(
    field('coordinatedPhases', 'Coordinated phases', 'phases', phaseList(pa.coordinatedPhases), phaseList(pb.coordinatedPhases)),
    field('maxGreen', 'Max green', 'text', pa.maxGreen === 'max2' ? 'Max 2' : 'Max 1', pb.maxGreen === 'max2' ? 'Max 2' : 'Max 1'),
    field('forceOffMode', 'Force-offs', 'text', pa.forceOffMode === 'floating' ? 'Floating' : 'Fixed', pb.forceOffMode === 'floating' ? 'Floating' : 'Fixed'),
  );
  return fields;
}

function phaseFields(a: Phase | undefined, b: Phase | undefined, splitA: Tenths | null, splitB: Tenths | null, leadLagA: string | null, leadLagB: string | null): FieldDiff[] {
  const v = <T extends FieldValue>(phase: Phase | undefined, get: (p: Phase) => T): T | null => (phase?.enabled ? get(phase) : null);
  const ped = <T extends FieldValue>(phase: Phase | undefined, get: (p: Phase) => T): T | null => (phase?.enabled && phase.pedestrian.enabled ? get(phase) : null);
  return [
    field('split', 'Split', 'tenths', splitA, splitB),
    field('order', 'Lead/lag', 'text', leadLagA, leadLagB),
    field('minGreen', 'Min green', 'tenths', v(a, (p) => p.minGreen), v(b, (p) => p.minGreen)),
    field('passage', 'Passage', 'tenths', v(a, (p) => p.passage), v(b, (p) => p.passage)),
    field('maxGreen1', 'Max 1', 'tenths', v(a, (p) => p.maxGreen1), v(b, (p) => p.maxGreen1)),
    // 0 means no Max 2 programmed.
    field('maxGreen2', 'Max 2', 'tenths', v(a, (p) => p.maxGreen2 || null), v(b, (p) => p.maxGreen2 || null)),
    field('yellow', 'Yellow', 'tenths', v(a, (p) => p.yellow), v(b, (p) => p.yellow)),
    field('redClear', 'Red clear', 'tenths', v(a, (p) => p.redClear), v(b, (p) => p.redClear)),
    field('recall', 'Recall', 'text', v(a, (p) => RECALL_TEXT[p.recall]), v(b, (p) => RECALL_TEXT[p.recall])),
    field('walk', 'Walk', 'tenths', ped(a, (p) => p.pedestrian.walk), ped(b, (p) => p.pedestrian.walk)),
    field('pedClear', 'Ped clear', 'tenths', ped(a, (p) => p.pedestrian.clearance), ped(b, (p) => p.pedestrian.clearance)),
    field('pedRecall', 'Ped recall', 'boolean', ped(a, (p) => p.pedestrian.recall), ped(b, (p) => p.pedestrian.recall)),
  ];
}

/**
 * Where a phase sits in its barrier group: `lead` before its partner, `lag` after it, `null` when
 * it times alone. Sequences come from the pattern's own order when it has one.
 */
function leadLag(sequence: ReturnType<typeof effectiveSequence>, enabled: (n: number) => boolean): Map<number, string> {
  const result = new Map<number, string>();
  for (const ring of sequence) {
    for (const group of ring.groups) {
      const phases = group.filter(enabled);
      if (phases.length < 2) continue;
      phases.forEach((n, k) => result.set(n, k === 0 ? 'Lead' : k === phases.length - 1 ? 'Lag' : `Position ${k + 1}`));
    }
  }
  return result;
}

const capacityValues = (vc: number | null, delay: number | null, los: Los | null): CapacityValues => ({
  volumeToCapacity: vc !== null && Number.isFinite(vc) ? vc : null,
  delay,
  los,
});

const ANALYSIS_REASON: Record<Extract<PatternAnalysis, { ok: false }>['reason'], string> = {
  'no-volume-set': 'The pattern is not linked to a count.',
  'no-lane-groups': 'The intersection has no lane groups.',
  'no-cycle': 'A free pattern has no cycle to analyse.',
};

function compareCapacity(a: PatternAnalysis, b: PatternAnalysis, ia: Intersection, ib: Intersection): CapacityComparison | null {
  if (!a.ok || !b.ok) return null;
  const groupKey = (intersection: Intersection, id: string) => {
    const group = intersection.laneGroups.find((g) => g.id === id)!;
    return `${group.phase}/${group.label.trim().toLowerCase()}`;
  };
  // Lane groups match by id within a project, and by phase and label across projects.
  const rows = new Map<string, CapacityRow>();
  for (const result of a.laneGroups) {
    rows.set(result.laneGroupId, { key: result.laneGroupId, label: result.label || `Phase ${result.phase}`, a: capacityValues(result.volumeToCapacity, result.delay, result.los), b: null });
  }
  const byLabel = new Map(a.laneGroups.map((g) => [groupKey(ia, g.laneGroupId), g.laneGroupId]));
  for (const result of b.laneGroups) {
    const key = rows.has(result.laneGroupId) ? result.laneGroupId : (byLabel.get(groupKey(ib, result.laneGroupId)) ?? `b:${result.laneGroupId}`);
    const values = capacityValues(result.volumeToCapacity, result.delay, result.los);
    const row = rows.get(key);
    if (row) row.b = values;
    else rows.set(key, { key, label: result.label || `Phase ${result.phase}`, a: null, b: values });
  }
  return {
    countA: a.volumeSet.name,
    countB: b.volumeSet.name,
    overall: { key: 'intersection', label: 'Intersection', a: capacityValues(a.criticalVolumeToCapacity, a.delay, a.los), b: capacityValues(b.criticalVolumeToCapacity, b.delay, b.los) },
    laneGroups: [...rows.values()],
  };
}

/** Compares side B's pattern against side A's. Throws if a pattern id is not found. */
export function comparePlans(a: CompareSide, b: CompareSide): PlanComparison {
  const pa = a.intersection.patterns.find((p) => p.id === a.patternId);
  const pb = b.intersection.patterns.find((p) => p.id === b.patternId);
  if (!pa || !pb) throw new Error('comparePlans: pattern not found');

  const phasesA = new Map(a.intersection.phases.map((p) => [p.number, p]));
  const phasesB = new Map(b.intersection.phases.map((p) => [p.number, p]));
  const enabledA = (n: number) => phasesA.get(n)?.enabled === true;
  const enabledB = (n: number) => phasesB.get(n)?.enabled === true;
  const sequenceA = effectiveSequence(pa, a.intersection.rings);
  const sequenceB = effectiveSequence(pb, b.intersection.rings);
  const orderA = leadLag(sequenceA, enabledA);
  const orderB = leadLag(sequenceB, enabledB);
  const inRings = (sequence: typeof sequenceA, enabled: (n: number) => boolean) => new Set(sequence.flatMap((r) => r.groups.flat()).filter(enabled));
  const ringedA = inRings(sequenceA, enabledA);
  const ringedB = inRings(sequenceB, enabledB);

  const numbers = [...new Set([...phasesA.keys(), ...phasesB.keys()])].sort((x, y) => x - y);
  const phases: PhaseDiff[] = numbers
    .map((n): PhaseDiff => {
      const phaseA = phasesA.get(n);
      const phaseB = phasesB.get(n);
      const split = (pattern: Pattern, ringed: Set<number>) => (ringed.has(n) && pattern.mode === 'coordinated' ? (pattern.splits[String(n)] ?? 0) : null);
      const fields = phaseFields(phaseA, phaseB, split(pa, ringedA), split(pb, ringedB), enabledA(n) ? (orderA.get(n) ?? null) : null, enabledB(n) ? (orderB.get(n) ?? null) : null);
      return {
        phase: n,
        label: (phaseA?.enabled ? phaseA.label : '') || (phaseB?.enabled ? phaseB.label : '') || phaseA?.label || phaseB?.label || '',
        inA: enabledA(n),
        inB: enabledB(n),
        fields,
        changed: enabledA(n) !== enabledB(n) || fields.some((f) => f.changed),
      };
    })
    .filter((d) => d.inA || d.inB);

  const ringCount = Math.max(sequenceA.length, sequenceB.length);
  const rings: RingOrderDiff[] = Array.from({ length: ringCount }, (_, r) => {
    const textA = sequenceA[r] ? ringOrderText(sequenceA[r].groups, enabledA) : null;
    const textB = sequenceB[r] ? ringOrderText(sequenceB[r].groups, enabledB) : null;
    return { ring: r + 1, a: textA, b: textB, changed: textA !== textB };
  });

  const pattern = patternFields({ ...a, pattern: pa }, { ...b, pattern: pb });
  const analysisA = analyzePattern(a.intersection, pa.id);
  const analysisB = analyzePattern(b.intersection, pb.id);
  const changeCount =
    pattern.filter((f) => f.changed && f.key !== 'offsetAsA').length +
    phases.reduce((sum, d) => sum + d.fields.filter((f) => f.changed).length + (d.inA !== d.inB ? 1 : 0), 0) +
    rings.filter((r) => r.changed).length;
  return {
    pattern,
    phases,
    rings,
    capacity: compareCapacity(analysisA, analysisB, a.intersection, b.intersection),
    capacityReasons: { a: analysisA.ok ? null : ANALYSIS_REASON[analysisA.reason], b: analysisB.ok ? null : ANALYSIS_REASON[analysisB.reason] },
    changeCount,
  };
}

/** The intersection in `candidates` with the same name as `name` (ignoring case and spacing), if any. */
export function matchIntersectionByName<T extends { name: string }>(name: string, candidates: readonly T[]): T | null {
  const norm = (s: string) => s.trim().replace(/\s+/g, ' ').toLowerCase();
  return candidates.find((c) => norm(c.name) === norm(name)) ?? null;
}
