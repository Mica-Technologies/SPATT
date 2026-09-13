import { describe, expect, it } from 'vitest';
import { csmDefault, leadLagEightPhase, splitPhaseSideStreet, standardEightPhase, type Intersection } from '../model';
import { convertOffset, projectCycle, toLocal, toSystem, type CycleProjection, type PhaseInterval } from './projection';

function projected(intersection: Intersection, patternId = intersection.patterns[0]!.id): CycleProjection {
  const result = projectCycle(intersection, patternId);
  if (!result.ok) {
    throw new Error(result.issues.map((i) => i.message).join('; '));
  }
  return result.projection;
}

const interval = (projection: CycleProjection, phase: number): PhaseInterval => {
  const found = projection.rings.flat().find((i) => i.phase === phase);
  if (!found) throw new Error(`phase ${phase} not projected`);
  return found;
};

/** [splitStart, yellowStart, redClearStart, splitEnd] in tenths. */
const windows = (projection: CycleProjection, ring: number) =>
  projection.rings[ring]!.map((i) => [i.phase, i.splitStart, i.yellowStart, i.redClearStart, i.splitEnd]);

describe('projectCycle — standard eight-phase, 90 s, coordinated 2 + 6, offset to begin of coord green', () => {
  // Worked by hand. Ring 1 splits 15 / 35 / 12 / 28 s.
  //   Phase 1: split 0–15, left clearances 3.5 + 1.5 → green 0–10, yellow 10–13.5, red 13.5–15
  //   Phase 2: split 15–50, through clearances 4 + 2 → green 15–44, yellow 44–48, red 48–50
  //   Phase 3: split 50–62 → green 50–57, yellow 57–60.5, red 60.5–62
  //   Phase 4: split 62–90 → green 62–84, yellow 84–88, red 88–90
  const p = projected(standardEightPhase());

  it('lays out ring 1', () => {
    expect(windows(p, 0)).toEqual([
      [1, 0, 100, 135, 150],
      [2, 150, 440, 480, 500],
      [3, 500, 570, 605, 620],
      [4, 620, 840, 880, 900],
    ]);
  });

  it('lays out ring 2 identically to ring 1', () => {
    expect(windows(p, 1).map(([, ...times]) => times)).toEqual(windows(p, 0).map(([, ...times]) => times));
  });

  it('places the barriers at 50 s and 90 s', () => {
    expect(p.barriers).toEqual([500, 900]);
  });

  it('finds the reference points', () => {
    expect(p.referencePoints).toEqual({ firstPhaseStart: 0, beginCoordGreen: 150, beginCoordYellow: 440 });
    expect(p.localZero).toBe(150);
  });

  it('gives force-offs in local time (local zero = 15 s sequence time)', () => {
    expect(toLocal(p, interval(p, 3).forceOff)).toBe(420); // 57 − 15
    expect(toLocal(p, interval(p, 4).forceOff)).toBe(690); // 84 − 15
    expect(toLocal(p, interval(p, 1).forceOff)).toBe(850); // 10 − 15 wraps to 85
    expect(toLocal(p, interval(p, 2).forceOff)).toBe(290); // coordinated yield: 44 − 15
  });

  it('gives the latest start that still serves minimum green and the pedestrian interval', () => {
    const phase4 = interval(p, 4);
    expect(phase4.latestVehicleStart).toBe(740); // force-off 84 − min green 10
    expect(phase4.latestPedestrianStart).toBe(630); // 84 − walk 7 − clearance 14
    expect(interval(p, 1).latestPedestrianStart).toBeNull(); // no pedestrian service
    expect(interval(p, 2).latestVehicleStart).toBeNull(); // coordinated
  });

  it('times the pedestrian interval from the start of green', () => {
    expect(interval(p, 2)).toMatchObject({ walkEnd: 220, pedestrianClearanceEnd: 400 }); // 15 + 7, + 18
    expect(interval(p, 1)).toMatchObject({ walkEnd: null, pedestrianClearanceEnd: null });
  });

  it('marks only the coordinated phases', () => {
    expect(p.rings.flat().filter((i) => i.coordinated).map((i) => i.phase)).toEqual([2, 6]);
  });
});

describe('offsets', () => {
  it('converts an offset between references without changing the timing on the ground', () => {
    const intersection = standardEightPhase();
    intersection.patterns[0]!.offset = 300; // coordinated green begins at system time 30 s
    const p = projected(intersection);
    expect(convertOffset(p, 'beginCoordGreen')).toBe(300);
    expect(convertOffset(p, 'firstPhaseStart')).toBe(150); // sequence starts 15 s earlier: 30 − 15
    expect(convertOffset(p, 'beginCoordYellow')).toBe(590); // yellow 29 s after green: 30 + 29

    // Re-project with each converted offset: the coordinated green must land on the same system time.
    for (const reference of ['beginCoordGreen', 'beginCoordYellow', 'firstPhaseStart'] as const) {
      const moved = standardEightPhase();
      moved.patterns[0]!.offsetReference = reference;
      moved.patterns[0]!.offset = convertOffset(p, reference);
      const q = projected(moved);
      expect(toSystem(q, interval(q, 2).greenStart)).toBe(300);
    }
  });

  it('wraps a converted offset into the cycle', () => {
    const p = projected(standardEightPhase()); // offset 0 to begin of coord green
    expect(convertOffset(p, 'firstPhaseStart')).toBe(750); // 0 − 15 → 75
  });

  it('gives the CSM offset for the default CSM plan run coordinated', () => {
    const intersection = csmDefault();
    const pattern = intersection.patterns[0]!;
    pattern.mode = 'coordinated';
    pattern.offsetReference = 'beginCoordGreen';
    pattern.offset = 100;
    // Even 22.5 s splits: phase 2's green starts 22.5 s into the sequence.
    expect(convertOffset(projected(intersection), 'firstPhaseStart')).toBe(900 - 125); // 10 − 22.5 wraps to 77.5
  });
});

describe('projectCycle — lead-lag', () => {
  // Ring 1 runs 2 then 1: phase 2 split 0–35 (green 0–29), phase 1 split 35–50 (green 35–45).
  // Ring 2 is unchanged: phase 5 0–15, phase 6 15–50 (green 15–44).
  const p = projected(leadLagEightPhase());

  it('lays out the lagging left', () => {
    expect(windows(p, 0).slice(0, 2)).toEqual([
      [2, 0, 290, 330, 350],
      [1, 350, 450, 485, 500],
    ]);
  });

  it('takes the earliest coordinated green and yellow as reference points', () => {
    // Phase 2 starts at 0 and turns yellow at 29; phase 6 starts at 15 and turns yellow at 44.
    expect(p.referencePoints).toEqual({ firstPhaseStart: 0, beginCoordGreen: 0, beginCoordYellow: 290 });
  });
});

describe('projectCycle — split-phased side street, 120 s', () => {
  // Group 1: 1 (15) + 2 (45) = 60 in both rings. Group 2: phase 4 alone, 30. Group 3: phase 8, 30.
  const p = projected(splitPhaseSideStreet());

  it('places the side-street phases after the main-street barrier, one per group', () => {
    expect(p.barriers).toEqual([600, 900, 1200]);
    expect(windows(p, 0)).toEqual([
      [1, 0, 100, 135, 150],
      [2, 150, 540, 580, 600],
      [4, 600, 840, 880, 900],
      [8, 900, 1140, 1180, 1200],
    ]);
  });

  it('leaves ring 2 idle through the split-phase groups', () => {
    expect(p.rings[1]!.map((i) => i.phase)).toEqual([5, 6]);
    expect(p.rings[1]!.at(-1)!.splitEnd).toBe(600);
  });
});

describe('projectCycle — refusals', () => {
  it('refuses a free pattern', () => {
    const result = projectCycle(csmDefault(), 'csm-slot-0');
    expect(result.ok).toBe(false);
    expect(!result.ok && result.issues[0]!.code).toBe('projection.free-pattern');
  });

  it('refuses an unknown pattern', () => {
    const result = projectCycle(standardEightPhase(), 'nope');
    expect(!result.ok && result.issues[0]!.code).toBe('projection.unknown-pattern');
  });

  it('refuses a pattern with misaligned barriers, reporting why', () => {
    const intersection = standardEightPhase();
    intersection.patterns[0]!.splits['1'] = 160;
    intersection.patterns[0]!.splits['4'] = 270;
    const result = projectCycle(intersection, 'am-peak');
    expect(!result.ok && result.issues.map((i) => i.code)).toContain('pattern.barrier-misaligned');
  });

  it('is not blocked by errors in other patterns, schedules or warnings', () => {
    const intersection = standardEightPhase();
    const broken = structuredClone(intersection.patterns[0]!);
    broken.id = 'broken';
    broken.cycle = 1000;
    intersection.patterns.push(broken);
    intersection.schedule.push({ startMinute: 12 * 60, patternId: 'gone' });
    intersection.phases[1]!.pedestrian.walk = 40; // warning only
    expect(projectCycle(intersection, 'am-peak').ok).toBe(true);
    expect(projectCycle(intersection, 'broken').ok).toBe(false);
  });
});
