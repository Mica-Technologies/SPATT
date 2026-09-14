import { describe, expect, it } from 'vitest';
import { convertOffset, projectCycle } from '../../engine';
import { csmDefault, effectiveSequence, leadLagEightPhase, splitPhaseSideStreet, standardEightPhase, twoPhase, type Intersection } from '../../model';
import { checkCsm, exportCsm, importCsm, type CsmPlan } from './index';

const exported = (intersection: Intersection): CsmPlan => {
  const result = exportCsm(intersection);
  if (!result.ok) throw new Error(result.issues.map((i) => `${i.code}: ${i.message}`).join('\n'));
  return result.plan;
};
const codes = (intersection: Intersection) => checkCsm(intersection).map((i) => i.code);

describe('exportCsm — standard eight-phase, hand-worked', () => {
  const plan = exported(standardEightPhase());

  it('converts phase times to ticks and barrier groups to barrier numbers', () => {
    // Phase 1: min green 5.0 s, passage 2.0, Max 1 20.0, yellow 3.5, red clear 1.5 → ×20 ticks.
    expect(plan.phases[0]).toEqual({
      number: 1, enabled: true, barrier: 0,
      minGreen: 100, passage: 40, maxGreen: 400, maxGreen2: 0, yellow: 70, redClear: 30,
      addedInitial: 0, maxInitial: 0, minGap: 0, timeBeforeReduce: 0, timeToReduce: 0,
      recall: 'NONE', pedRecall: false, restInWalk: false, dualEntry: false, conditionalService: false, lockCall: false,
      label: 'WB Left',
    });
    // Phase 2 has pedestrian service: walk 7.0 s, clearance 18.0 s.
    expect(plan.phases[1]).toMatchObject({ number: 2, barrier: 0, walk: 140, pedClear: 360 });
    expect(plan.phases.map((p) => p.barrier)).toEqual([0, 0, 1, 1, 0, 0, 1, 1]);
    expect(plan.rings).toEqual([[1, 2, 3, 4], [5, 6, 7, 8]]);
  });

  it('re-measures the offset to the start of the ring sequence and maps the schedule to slots', () => {
    // Offset 0 s to begin of coordinated green, which is 15 s into the sequence: 0 − 15 → 75 s.
    expect(plan.patterns).toEqual([
      { slot: 0, mode: 'COORDINATED', cycle: 1800, offset: 1500, coordinatedPhases: [2, 6], splits: { 1: 300, 2: 700, 3: 240, 4: 560, 5: 300, 6: 700, 7: 240, 8: 560 }, name: 'AM Peak' },
      { slot: 1, mode: 'FREE', cycle: 1800, offset: 0, coordinatedPhases: [], splits: {} },
    ]);
    // 06:00 AM Peak, 22:00 free; unused slots start with slot 0 and never run.
    expect(plan.schedule).toEqual({ enabled: true, startHours: [6, 22, 6, 6] });
  });
});

describe('exportCsm — sequences and barriers', () => {
  it('uses a lead-lag order shared by every exported pattern as the ring sequence', () => {
    const plan = exported(leadLagEightPhase());
    expect(plan.rings).toEqual([[2, 1, 3, 4], [5, 6, 7, 8]]);
    // Phase 2 starts the sequence and is the first coordinated green: offset 0 stays 0.
    expect(plan.patterns[0]).toMatchObject({ offset: 0, cycle: 1800 });
    expect(plan.schedule.startHours).toEqual([15, 15, 15, 15]);
  });

  it('exports three barrier groups with a warning', () => {
    const intersection = splitPhaseSideStreet();
    expect(codes(intersection)).toEqual(['csm.barrier-groups']);
    const plan = exported(intersection);
    expect(plan.phases.map((p) => [p.number, p.barrier])).toEqual([[1, 0], [2, 0], [4, 1], [5, 0], [6, 0], [8, 2]]);
    expect(plan.rings).toEqual([[1, 2, 4, 8], [5, 6]]);
  });

  it('measures the offset from the barrier group where ring 1 starts', () => {
    // A split-phase plan whose ring 1 idles through group 1: ring 1 = [], [4], [8] and
    // ring 2 = [1, 2, 5, 6], [], []. Group 1 = 10 + 20 + 10 + 20 = 60 s; groups 2 and 3 = 30 s.
    const intersection = splitPhaseSideStreet();
    intersection.rings = [{ groups: [[], [4], [8]] }, { groups: [[1, 2, 5, 6], [], []] }];
    const pattern = intersection.patterns[0]!;
    Object.assign(pattern.splits, { 1: 100, 2: 200, 5: 100, 6: 200 });
    pattern.coordinatedPhases = [4];
    pattern.offsetReference = 'firstPhaseStart';
    pattern.offset = 100; // the sequence (group 1) starts at 10 s system time
    const plan = exported(intersection);
    // The controller's local zero is group 2's start, 60 s later: 10 + 60 = 70 s.
    expect(plan.patterns[0]).toMatchObject({ offset: 1400 });
    expect(plan.phases.find((p) => p.number === 4)?.barrier).toBe(1);
  });
});

describe('checkCsm', () => {
  it('passes the templates the controller can run', () => {
    expect(codes(standardEightPhase())).toEqual([]);
    expect(codes(twoPhase())).toEqual([]);
    expect(codes(csmDefault())).toEqual([]);
  });

  it('reports what the controller cannot express', () => {
    const intersection = standardEightPhase();
    intersection.phases[1]!.maxGreen1 = 6010; // 601 s
    intersection.phases[2]!.recall = 'maximum';
    intersection.schedule.push({ startMinute: 12 * 60 + 30, patternId: 'am-peak' });
    intersection.patterns[0]!.forceOffMode = 'floating';
    intersection.phases[3]!.maxGreen2 = 400;
    expect(codes(intersection).sort()).toEqual(['csm.floating-force-off', 'csm.max-recall', 'csm.max2-in-coordination', 'csm.schedule-not-on-the-hour', 'csm.value-too-long'].sort());
    expect(checkCsm(intersection).find((i) => i.code === 'csm.value-too-long')?.path).toEqual(['phases', 1, 'maxGreen1']);
  });

  it('refuses patterns with different phase orders, more than four schedule entries, and phases above 8', () => {
    const intersection = standardEightPhase();
    const second = structuredClone(intersection.patterns[0]!);
    second.id = 'pm';
    second.sequence = [{ groups: [[2, 1], [3, 4]] }, { groups: [[5, 6], [7, 8]] }];
    intersection.patterns.push(second);
    intersection.schedule = [0, 4, 8, 12, 16].map((h, k) => ({ startMinute: h * 60, patternId: k % 2 ? 'pm' : 'am-peak' }));
    expect(codes(intersection)).toEqual(expect.arrayContaining(['csm.sequence-per-pattern', 'csm.too-many-schedule-entries']));

    const nine = standardEightPhase();
    nine.phases.push({ ...structuredClone(nine.phases[0]!), number: 9, enabled: false });
    expect(codes(nine)).toContain('csm.phase-number');
  });

  it('warns about patterns the schedule never selects', () => {
    const intersection = standardEightPhase();
    intersection.patterns.push({ ...structuredClone(intersection.patterns[0]!), id: 'spare', name: 'Spare' });
    expect(checkCsm(intersection)).toEqual([expect.objectContaining({ code: 'csm.pattern-not-scheduled', path: ['patterns', 1], severity: 'warning' })]);
  });

  it('blocks export when SPATT validation fails', () => {
    const intersection = standardEightPhase();
    intersection.patterns[0]!.splits['1'] = 160;
    const result = exportCsm(intersection);
    expect(result.ok).toBe(false);
    expect(result.issues.map((i) => i.code)).toContain('pattern.barrier-misaligned');
  });
});

describe('importCsm', () => {
  it('rotates barrier groups to start where ring 1 starts, and converts ticks and enums', () => {
    const plan = exported(standardEightPhase());
    // Controller phase order 3, 4, 1, 2 in ring 1: local zero is barrier 1's start.
    plan.rings = [[3, 4, 1, 2], [7, 8, 5, 6]];
    plan.phases[2]!.recall = 'PEDESTRIAN';
    plan.phases[2]!.movement = 'PROTECTED_LEFT';
    plan.phases[2]!.circuit = 3;
    plan.phases[0]!.yellow = 71; // 3.55 s
    const result = importCsm(JSON.stringify(plan), { id: 'imported' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const { intersection, issues } = result;
    expect(intersection.rings).toEqual([{ groups: [[3, 4], [1, 2]] }, { groups: [[7, 8], [5, 6]] }]);
    expect(intersection.phases[2]).toMatchObject({ recall: 'none', pedestrian: { recall: true }, movement: { kind: 'left' }, extensions: { csm: { movement: 'PROTECTED_LEFT', circuit: 3 } } });
    expect(intersection.phases[0]!.yellow).toBe(36);
    expect(issues).toEqual([expect.objectContaining({ code: 'csm.odd-ticks', path: ['phases', 0, 'yellow'] })]);
    expect(intersection.schedule).toEqual([{ startMinute: 360, patternId: 'csm-slot-0' }, { startMinute: 1320, patternId: null }]);
    expect(intersection.patterns[0]).toMatchObject({ offsetReference: 'firstPhaseStart', offset: 750, cycle: 900 });
  });

  it('refuses text that is not a plan', () => {
    expect(importCsm('{', { id: 'x' })).toMatchObject({ ok: false, issues: [{ code: 'csm.invalid-json' }] });
    const result = importCsm({ format: 'csm-asc3-plan', formatVersion: 2 }, { id: 'x' });
    expect(result.ok).toBe(false);
    expect(result.issues[0]!.code).toBe('csm.invalid-plan');
  });

  it('keeps controller data SPATT does not model and gives it back on export', () => {
    const plan = exported(standardEightPhase());
    plan.overlaps = [{ en: true, oc: 4, in: [2, 3] }];
    plan.priority = { en: false };
    plan.phases[5]!.flash = 'RED';
    plan.phases[0]!.walk = 140; // a phase without pedestrian signals still has timers on the controller
    plan.phases[0]!.pedClear = 200;
    plan.phases[0]!.hasPedestrianSignals = false;
    const imported = importCsm(plan, { id: 'x', offsetReference: 'beginCoordGreen' });
    if (!imported.ok) throw new Error('import failed');
    expect(imported.intersection.phases[0]!.pedestrian.enabled).toBe(false);
    const again = exported(imported.intersection);
    expect(again.overlaps).toEqual(plan.overlaps);
    expect(again.priority).toEqual(plan.priority);
    expect(again.phases[5]!.flash).toBe('RED');
    expect(again.phases[0]).toMatchObject({ walk: 140, pedClear: 200 });
    expect(again.preempts).toBeUndefined();
  });
});

/** Timing and structure, with every coordinated offset measured to the sequence start. */
function timing(intersection: Intersection) {
  return {
    // Approach and movement kind are not in the controller plan; the ring order is compared per
    // pattern (a lead-lag pattern's order becomes the controller's base order).
    phases: intersection.phases.map(({ movement: _movement, extensions: _extensions, ...rest }) => rest),
    patterns: intersection.patterns.map((pattern) => {
      const projection = pattern.mode === 'coordinated' ? projectCycle(intersection, pattern.id) : null;
      return {
        name: pattern.name,
        mode: pattern.mode,
        cycle: pattern.cycle,
        offset: projection?.ok ? convertOffset(projection.projection, 'firstPhaseStart') : pattern.offset,
        coordinatedPhases: pattern.coordinatedPhases,
        splits: pattern.splits,
        sequence: effectiveSequence(pattern, intersection.rings),
        maxGreen: pattern.maxGreen,
      };
    }),
    schedule: intersection.schedule.map((e) => ({ startMinute: e.startMinute, pattern: intersection.patterns.find((p) => p.id === e.patternId)?.name ?? null })),
  };
}

describe('round trip SPATT → CSM → SPATT', () => {
  it.each([
    ['standard eight-phase', standardEightPhase],
    ['lead-lag', leadLagEightPhase],
    ['split-phase side street', splitPhaseSideStreet],
    ['two-phase', twoPhase],
    ['CSM default', csmDefault],
  ])('%s keeps its timing', (_, build) => {
    const original = build();
    const reference = original.patterns[0]!.offsetReference;
    const result = importCsm(exportCsm(original).ok ? exported(original) : null, { id: original.id, offsetReference: reference });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const back = result.intersection;
    // The lead-lag order becomes the base ring order, so compare effective sequences.
    expect(timing(back)).toEqual(timing(original));
    expect(back.patterns.every((p) => p.mode !== 'coordinated' || p.offsetReference === reference)).toBe(true);
  });
});
