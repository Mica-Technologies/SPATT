import { describe, expect, it } from 'vitest';
import { newLaneGroup, newVolumeSet, removeLaneGroup, removeVolumeSet } from './capacity';
import type { Issue } from './issues';
import type { Intersection } from './schema';
import { intersectionSchema } from './schema';
import { csmDefault, leadLagEightPhase, splitPhaseSideStreet, standardEightPhase, twoPhase } from './templates';
import { validateIntersection } from './validate';

const TEMPLATES: [string, () => Intersection][] = [
  ['standard eight-phase', () => standardEightPhase()],
  ['lead-lag eight-phase', () => leadLagEightPhase()],
  ['split-phase side street', () => splitPhaseSideStreet()],
  ['two-phase', () => twoPhase()],
  ['CSM default', () => csmDefault()],
];

const codes = (issues: Issue[]) => issues.map((i) => `${i.severity}:${i.code}`);

/** Runs `mutate` on a fresh standard eight-phase intersection and returns the issues. */
function issuesAfter(mutate: (i: Intersection) => void, base: () => Intersection = () => standardEightPhase()): Issue[] {
  const intersection = base();
  mutate(intersection);
  expect(intersectionSchema.safeParse(intersection).success).toBe(true);
  return validateIntersection(intersection);
}

const phase = (i: Intersection, n: number) => {
  const found = i.phases.find((p) => p.number === n);
  if (!found) throw new Error(`no phase ${n}`);
  return found;
};

const pattern = (i: Intersection) => {
  const found = i.patterns[0];
  if (!found) throw new Error('no pattern');
  return found;
};

describe('templates', () => {
  it.each(TEMPLATES)('%s is schema-valid and has no issues', (_, build) => {
    const intersection = build();
    expect(intersectionSchema.safeParse(intersection).success).toBe(true);
    expect(validateIntersection(intersection)).toEqual([]);
  });

  it('CSM default is also valid when coordinated (even 22.5 s splits exactly fit the pedestrian interval)', () => {
    expect(issuesAfter((i) => (pattern(i).mode = 'coordinated'), () => csmDefault())).toEqual([]);
  });
});

describe('phase rules', () => {
  it('flags duplicate phase numbers', () => {
    const issues = issuesAfter((i) => i.phases.push(structuredClone(phase(i, 1))));
    expect(codes(issues)).toContain('error:phase.duplicate-number');
    expect(issues.find((x) => x.code === 'phase.duplicate-number')?.path).toEqual(['phases', 8, 'number']);
  });

  it('flags Max 1 below minimum green', () => {
    const issues = issuesAfter((i) => (phase(i, 2).maxGreen1 = 50));
    expect(issues).toContainEqual(expect.objectContaining({ code: 'phase.max-below-min', path: ['phases', 1, 'maxGreen1'] }));
  });

  it('flags a programmed Max 2 below minimum green, but not an unprogrammed one', () => {
    expect(codes(issuesAfter((i) => (phase(i, 2).maxGreen2 = 50)))).toContain('error:phase.max-below-min');
    expect(issuesAfter((i) => (phase(i, 2).maxGreen2 = 0))).toEqual([]);
  });

  it('requires a yellow on vehicle phases', () => {
    expect(codes(issuesAfter((i) => (phase(i, 4).yellow = 0)))).toContain('error:phase.no-yellow');
  });

  it('warns on yellow outside 3–6 s', () => {
    // Phase 1 (a left turn with no pedestrian interval) has room in its split for these.
    expect(codes(issuesAfter((i) => (phase(i, 1).yellow = 25)))).toEqual(['warning:phase.yellow-range']);
    expect(codes(issuesAfter((i) => (phase(i, 1).yellow = 65)))).toEqual(['warning:phase.yellow-range']);
    expect(issuesAfter((i) => (phase(i, 1).yellow = 60))).toEqual([]);
  });

  it('warns on long red clearance', () => {
    // Free mode, so the longer clearance does not also push past the phase's split.
    const issues = issuesAfter((i) => {
      phase(i, 4).redClear = 70;
      pattern(i).mode = 'free';
    });
    expect(codes(issues)).toEqual(['warning:phase.red-clear-range']);
  });

  it('requires walk and clearance when pedestrian service is on', () => {
    expect(codes(issuesAfter((i) => (phase(i, 2).pedestrian.clearance = 0)))).toContain('error:phase.ped-incomplete');
  });

  it('flags a pedestrian phase with pedestrian service off', () => {
    const issues = issuesAfter((i) => {
      const p = phase(i, 2);
      p.movement.kind = 'pedestrian';
      p.pedestrian.enabled = false;
    });
    expect(codes(issues)).toContain('error:phase.ped-incomplete');
  });

  it('warns on a walk below 7 s', () => {
    expect(codes(issuesAfter((i) => (phase(i, 2).pedestrian.walk = 40)))).toEqual(['warning:phase.walk-short']);
  });

  it('does not check the timing of disabled phases', () => {
    expect(
      codes(
        issuesAfter((i) => {
          const p = phase(i, 3);
          p.enabled = false;
          p.yellow = 0;
          pattern(i).splits['4'] = 400; // keep barrier B at 40 s in ring 1
          delete pattern(i).splits['3'];
        }),
      ),
    ).toEqual([]);
  });
});

describe('ring and barrier rules', () => {
  it('flags a phase placed twice', () => {
    expect(codes(issuesAfter((i) => i.rings[1]!.groups[1]!.push(3)))).toContain('error:ring.phase-repeated');
  });

  it('flags a ring naming an undefined phase', () => {
    expect(codes(issuesAfter((i) => i.rings[0]!.groups[1]!.push(12)))).toContain('error:ring.unknown-phase');
  });

  it('flags an enabled phase that is in no ring', () => {
    expect(codes(issuesAfter((i) => (i.rings[0]!.groups[1] = [4])))).toContain('error:ring.phase-unassigned');
  });

  it('flags rings with different numbers of barrier groups', () => {
    expect(codes(issuesAfter((i) => (i.rings[1]!.groups = [[5, 6, 7, 8]])))).toContain('error:barrier.group-count-mismatch');
  });

  it('flags a barrier group with nothing enabled in it', () => {
    const issues = issuesAfter((i) => {
      i.rings = [{ groups: [[1, 2], [3, 4], []] }, { groups: [[5, 6], [7, 8], []] }];
    });
    expect(codes(issues)).toContain('error:barrier.empty-group');
  });

  it('skips pattern checks while the ring structure is broken', () => {
    const issues = issuesAfter((i) => i.rings[1]!.groups[1]!.push(3));
    expect(issues.every((x) => !x.code.startsWith('pattern.'))).toBe(true);
  });
});

describe('pattern rules', () => {
  it('accepts a sequence that only reorders within groups', () => {
    expect(validateIntersection(leadLagEightPhase())).toEqual([]);
  });

  it('rejects a sequence that moves a phase across a barrier', () => {
    const issues = issuesAfter((i) => {
      pattern(i).sequence = [{ groups: [[1, 3], [2, 4]] }, { groups: [[5, 6], [7, 8]] }];
    });
    expect(codes(issues)).toEqual(['error:pattern.sequence-membership']);
  });

  it('ignores splits entirely in free mode', () => {
    expect(issuesAfter((i) => {
      pattern(i).mode = 'free';
      pattern(i).splits = {};
    })).toEqual([]);
  });

  it('requires a cycle length when coordinated', () => {
    expect(codes(issuesAfter((i) => (pattern(i).cycle = 0)))).toEqual(['error:pattern.cycle-missing']);
  });

  it('warns on a very long cycle', () => {
    const issues = issuesAfter((i) => {
      const p = pattern(i);
      p.cycle = 3200; // barrier A 15 + 165 = 180 s, barrier B 12 + 128 = 140 s
      p.splits['2'] = 1650;
      p.splits['6'] = 1650;
      p.splits['4'] = 1280;
      p.splits['8'] = 1280;
    });
    expect(codes(issues)).toEqual(['warning:pattern.cycle-long']);
  });

  it('requires the offset to be inside the cycle', () => {
    expect(codes(issuesAfter((i) => (pattern(i).offset = 900)))).toEqual(['error:pattern.offset-range']);
    expect(issuesAfter((i) => (pattern(i).offset = 899))).toEqual([]);
  });

  it('requires a coordinated phase', () => {
    expect(codes(issuesAfter((i) => (pattern(i).coordinatedPhases = [])))).toEqual(['error:pattern.coord-missing']);
  });

  it('rejects an undefined or disabled coordinated phase', () => {
    expect(codes(issuesAfter((i) => (pattern(i).coordinatedPhases = [2, 14])))).toEqual(['error:pattern.coord-invalid']);
  });

  it('rejects two coordinated phases in one ring', () => {
    expect(codes(issuesAfter((i) => (pattern(i).coordinatedPhases = [1, 2])))).toEqual(['error:pattern.coord-same-ring']);
  });

  it('rejects coordinated phases in different barrier groups', () => {
    expect(codes(issuesAfter((i) => (pattern(i).coordinatedPhases = [2, 8])))).toEqual(['error:pattern.coord-different-barriers']);
  });

  it('requires a split for every enabled phase', () => {
    const issues = issuesAfter((i) => delete pattern(i).splits['7']);
    expect(codes(issues)).toContain('error:pattern.split-missing');
    expect(issues.find((x) => x.code === 'pattern.split-missing')?.path).toEqual(['patterns', 0, 'splits', '7']);
  });

  it('warns about a split on a disabled phase', () => {
    const issues = issuesAfter((i) => {
      phase(i, 3).enabled = false;
      pattern(i).splits['4'] = 400;
    });
    expect(codes(issues)).toEqual(['warning:pattern.split-for-disabled-phase']);
  });

  it('rejects a split shorter than minimum green plus clearances', () => {
    // Phase 1 needs 5.0 + 3.5 + 1.5 = 10.0 s. Keep barrier A aligned by moving time to phase 2/6.
    const issues = issuesAfter((i) => {
      const p = pattern(i);
      p.splits['1'] = 90;
      p.splits['2'] = 410;
    });
    expect(codes(issues)).toEqual(['error:pattern.split-below-minimum']);
    expect(issues[0]?.message).toContain('10.0 s');
  });

  it('warns when the pedestrian interval does not fit and there is no pedestrian recall', () => {
    // Phase 4 needs 7 + 14 + 4 + 2 = 27 s; give it 26 s and phase 3 13 s.
    const issues = issuesAfter((i) => {
      const p = pattern(i);
      p.splits['4'] = 260;
      p.splits['3'] = 140;
    });
    expect(codes(issues)).toEqual(['warning:pattern.split-below-pedestrian']);
  });

  it('errors when the pedestrian interval does not fit and pedestrian recall is on', () => {
    const issues = issuesAfter((i) => {
      phase(i, 4).pedestrian.recall = true;
      const p = pattern(i);
      p.splits['4'] = 260;
      p.splits['3'] = 140;
    });
    expect(codes(issues)).toEqual(['error:pattern.split-below-pedestrian']);
  });

  it('rejects rings that would reach a barrier at different times', () => {
    const issues = issuesAfter((i) => {
      const p = pattern(i);
      p.splits['1'] = 160; // ring 1 barrier A = 51 s, ring 2 = 50 s
      p.splits['4'] = 270; // ring 1 still totals 90 s
    });
    expect(codes(issues)).toEqual(['error:pattern.barrier-misaligned', 'error:pattern.barrier-misaligned']);
    expect(issues[0]?.message).toContain('barrier group 1');
  });

  it('rejects splits that do not fill the cycle', () => {
    const issues = issuesAfter((i) => (pattern(i).cycle = 1000));
    expect(codes(issues)).toEqual(['error:pattern.cycle-sum']);
  });

  it('counts an empty group once, from the rings that serve it (split phasing)', () => {
    expect(codes(issuesAfter((i) => (pattern(i).splits['8'] = 310), () => splitPhaseSideStreet()))).toEqual(['error:pattern.cycle-sum']);
  });

  it('flags duplicate pattern ids', () => {
    expect(codes(issuesAfter((i) => i.patterns.push(structuredClone(pattern(i)))))).toContain('error:pattern.duplicate-id');
  });
});

describe('overlap, preempt and schedule rules', () => {
  const overlap = {
    id: 'A',
    label: 'NB right turn',
    enabled: true,
    type: 'normal' as const,
    includedPhases: [3, 4],
    modifierPhases: [],
    trailGreen: 0,
    trailYellow: 0,
    trailRedClear: 0,
  };

  it('accepts a well-formed overlap', () => {
    expect(issuesAfter((i) => i.overlaps.push(structuredClone(overlap)))).toEqual([]);
  });

  it('flags duplicate overlap letters, empty overlaps and unknown phases', () => {
    expect(codes(issuesAfter((i) => i.overlaps.push(structuredClone(overlap), structuredClone(overlap))))).toEqual(['error:overlap.duplicate-id']);
    expect(codes(issuesAfter((i) => i.overlaps.push({ ...structuredClone(overlap), includedPhases: [] })))).toEqual(['error:overlap.no-included-phases']);
    expect(codes(issuesAfter((i) => i.overlaps.push({ ...structuredClone(overlap), modifierPhases: [11] })))).toEqual(['error:overlap.unknown-phase']);
  });

  it('flags preempts naming undefined phases', () => {
    const issues = issuesAfter((i) =>
      i.preempts.push({
        number: 1,
        label: 'Railroad',
        enabled: true,
        kind: 'railroad',
        trackClearancePhases: [4, 13],
        trackClearance: 150,
        dwellPhases: [2, 6],
        minDwell: 100,
        exitPhases: [2, 6],
      }),
    );
    expect(codes(issues)).toEqual(['error:preempt.unknown-phase']);
  });

  it('flags two schedule entries at the same time and unknown patterns', () => {
    expect(codes(issuesAfter((i) => i.schedule.push({ startMinute: 6 * 60, patternId: null })))).toEqual(['error:schedule.duplicate-start']);
    expect(codes(issuesAfter((i) => i.schedule.push({ startMinute: 12 * 60, patternId: 'nope' })))).toEqual(['error:schedule.unknown-pattern']);
  });
});

describe('lane group and count rules', () => {
  /** Lane groups for phases 2 (EB through) and 1 (WB left), and an AM count on both. */
  const withCounts = (i: Intersection) => {
    i.laneGroups.push(newLaneGroup('eb-t', phase(i, 2)), newLaneGroup('wb-l', phase(i, 1)));
    i.volumeSets.push(newVolumeSet('am', 'AM peak', i.laneGroups));
    pattern(i).volumeSetId = 'am';
  };

  it('accepts lane groups, a count and a pattern linked to it', () => {
    expect(issuesAfter(withCounts)).toEqual([]);
  });

  it('makes a lane group for the serving phase’s own movement', () => {
    const i = standardEightPhase();
    expect(newLaneGroup('g', phase(i, 1))).toMatchObject({ label: 'WB Left', phase: 1, movements: { left: true, through: false, right: false }, lanes: 1, laneWidth: 3.6, saturationFlow: null });
    expect(newLaneGroup('g', phase(i, 2)).movements).toEqual({ left: false, through: true, right: false });
  });

  it('flags duplicate lane group ids, unknown, pedestrian and disabled phases, no movement and wide lanes', () => {
    expect(codes(issuesAfter((i) => { withCounts(i); i.laneGroups.push({ ...structuredClone(i.laneGroups[0]!), label: 'Copy' }); }))).toEqual(['error:laneGroup.duplicate-id']);
    expect(codes(issuesAfter((i) => { withCounts(i); i.laneGroups[0]!.phase = 13; }))).toEqual(['error:laneGroup.unknown-phase']);
    expect(codes(issuesAfter((i) => { withCounts(i); i.laneGroups[0]!.movements.through = false; }))).toEqual(['error:laneGroup.no-movement']);
    const issues = issuesAfter((i) => { withCounts(i); i.laneGroups[0]!.laneWidth = 5; });
    expect(issues).toEqual([expect.objectContaining({ code: 'laneGroup.wide-lanes', severity: 'warning', path: ['laneGroups', 0, 'laneWidth'] })]);
    expect(codes(issuesAfter((i) => { withCounts(i); phase(i, 2).movement.kind = 'pedestrian'; }).filter((x) => x.code.startsWith('laneGroup')))).toEqual(['error:laneGroup.pedestrian-phase']);
    expect(codes(issuesAfter((i) => { withCounts(i); phase(i, 1).enabled = false; }).filter((x) => x.code.startsWith('laneGroup')))).toEqual(['warning:laneGroup.phase-disabled']);
  });

  it('flags duplicate count ids, volumes for missing lane groups or unserved movements, and unknown pattern links', () => {
    expect(codes(issuesAfter((i) => { withCounts(i); i.volumeSets.push(structuredClone(i.volumeSets[0]!)); }))).toEqual(['error:volumeSet.duplicate-id']);
    expect(issuesAfter((i) => { withCounts(i); i.volumeSets[0]!.volumes['gone'] = { left: 0, through: 10, right: 0 }; })).toEqual([
      expect.objectContaining({ code: 'volumeSet.unknown-lane-group', path: ['volumeSets', 0, 'volumes', 'gone'] }),
    ]);
    expect(issuesAfter((i) => { withCounts(i); i.volumeSets[0]!.volumes['eb-t']!.right = 50; })).toEqual([
      expect.objectContaining({ code: 'volumeSet.unserved-movement', severity: 'warning', path: ['volumeSets', 0, 'volumes', 'eb-t', 'right'] }),
    ]);
    expect(issuesAfter((i) => { withCounts(i); pattern(i).volumeSetId = 'pm'; })).toEqual([
      expect.objectContaining({ code: 'pattern.unknown-volume-set', path: ['patterns', 0, 'volumeSetId'] }),
    ]);
  });

  it('removes lane groups from counts, and counts from patterns', () => {
    expect(issuesAfter((i) => { withCounts(i); removeLaneGroup(i, 'eb-t'); expect(Object.keys(i.volumeSets[0]!.volumes)).toEqual(['wb-l']); removeVolumeSet(i, 'am'); expect(pattern(i).volumeSetId).toBeNull(); })).toEqual([]);
  });
});
