import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { analyzePattern, projectCycle } from '../../engine';
import { intersectionSchema, validateIntersection } from '../../model';
import { importUtdf, referencePhases, utdfSections } from './utdf';

// Hand-written samples of the combined UTDF CSV layout, not files exported by Synchro.
const fixture = (name: string) => readFileSync(join(import.meta.dirname, '../../../test/fixtures/utdf', name), 'utf8');

function load(name: string) {
  let n = 0;
  const result = importUtdf(fixture(name), (prefix) => `${prefix}-${++n}`);
  if (!result.ok) throw new Error(result.error);
  return result;
}

describe('utdfSections', () => {
  it('splits the file into sections with their header rows', () => {
    const sections = utdfSections(fixture('two-intersections.utdf.csv'));
    expect([...sections.keys()]).toEqual(['network', 'nodes', 'links', 'lanes', 'timeplans', 'phases']);
    expect(sections.get('phases')!.header.slice(0, 3)).toEqual(['RECORDNAME', 'INTID', 'D1']);
    expect(sections.get('nodes')!.rows[0]![5]).toBe('Main St & 1st Ave');
  });
});

describe('referencePhases', () => {
  it('reads one phase or a pair', () => {
    expect(referencePhases('2')).toEqual([2]);
    expect(referencePhases('206')).toEqual([2, 6]);
    expect(referencePhases('412')).toEqual([4, 12]);
    expect(referencePhases('1216')).toEqual([12, 16]);
    expect(referencePhases('')).toEqual([]);
  });
});

describe('importUtdf', () => {
  it('imports each signalized node as an intersection and skips the others', () => {
    const result = load('two-intersections.utdf.csv');
    expect(result.intersections.map((i) => [i.nodeId, i.intersection.name])).toEqual([
      ['1', 'Main St & 1st Ave'],
      ['2', 'Main St & 2nd Ave'],
    ]);
    expect(result.notes.map((n) => n.message).join('\n')).toMatch(/Nodes without signal phasing were skipped: 3/);
    expect(result.notes.map((n) => n.message).join('\n')).toMatch(/Phase records not used: .*pedcalls/);
    for (const { intersection } of result.intersections) {
      expect(intersectionSchema.safeParse(intersection).success).toBe(true);
    }
  });

  it('reads phase timing, pedestrian times, recall and directions', () => {
    const main = load('two-intersections.utdf.csv').intersections[0]!.intersection;
    expect(main.phases.map((p) => p.number)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    const p2 = main.phases.find((p) => p.number === 2)!;
    expect(p2).toMatchObject({ label: 'EB Thru', movement: { approach: 'E', kind: 'through' }, minGreen: 100, maxGreen1: 395, passage: 30, yellow: 40, redClear: 15, dualEntry: true, recall: 'none' });
    expect(p2.pedestrian).toMatchObject({ enabled: true, walk: 70, clearance: 180 });
    expect(p2.volumeDensity.minGap).toBe(30);
    const p3 = main.phases.find((p) => p.number === 3)!;
    expect(p3).toMatchObject({ label: 'NB Left', movement: { approach: 'N', kind: 'left' }, pedestrian: { enabled: false } });
  });

  it('builds the rings from BRP codes', () => {
    const [main, second] = load('two-intersections.utdf.csv').intersections.map((i) => i.intersection);
    expect(main!.rings).toEqual([{ groups: [[1, 2], [3, 4]] }, { groups: [[5, 6], [7, 8]] }]);
    expect(second!.rings).toEqual([{ groups: [[2], [4]] }, { groups: [[6], [8]] }]);
  });

  it('makes a coordinated pattern from the timing plan with splits that fill the cycle', () => {
    const [main, second] = load('two-intersections.utdf.csv').intersections.map((i) => i.intersection);
    const pattern = main!.patterns[0]!;
    expect(pattern).toMatchObject({ mode: 'coordinated', cycle: 1000, offset: 0, offsetReference: 'beginCoordGreen', coordinatedPhases: [2, 6] });
    expect(pattern.splits).toEqual({ 1: 150, 2: 450, 3: 150, 4: 250, 5: 150, 6: 450, 7: 150, 8: 250 });
    expect(projectCycle(main!, pattern.id).ok).toBe(true);
    expect(validateIntersection(main!).filter((i) => i.severity === 'error')).toEqual([]);
    // Referenced to the begin of yellow.
    expect(second!.patterns[0]).toMatchObject({ offset: 350, offsetReference: 'beginCoordYellow', splits: { 2: 650, 4: 350, 6: 650, 8: 350 } });
    expect(validateIntersection(second!).filter((i) => i.severity === 'error')).toEqual([]);
  });

  it('makes lane groups from lanes, shared lanes and phases, in metres', () => {
    const [main, second] = load('two-intersections.utdf.csv').intersections.map((i) => i.intersection);
    const ebThru = main!.laneGroups.find((g) => g.label === 'EB Thru/Right')!;
    expect(ebThru).toMatchObject({ phase: 2, lanes: 2, movements: { left: false, through: true, right: true }, laneWidth: 3.66, heavyVehiclesPercent: 4 });
    expect(main!.laneGroups.find((g) => g.label === 'NB Left')).toMatchObject({ phase: 3, lanes: 1, laneWidth: 3.35 });
    expect(main!.laneGroups.find((g) => g.label === 'SB Thru/Right')!.gradePercent).toBe(2);
    expect(main!.laneGroups).toHaveLength(8);
    // A shared left-through-right lane and a permitted left bay.
    expect(second!.laneGroups.find((g) => g.label === 'NB Thru/Left/Right')).toMatchObject({ phase: 8, movements: { left: true, through: true, right: true } });
    expect(second!.laneGroups.find((g) => g.label === 'EB Left')).toMatchObject({ phase: 2 });
    expect(second!.capacity).toEqual({ baseSaturationFlow: 1800, centralBusinessDistrict: true });
  });

  it('imports the volumes as a count linked to the pattern, which can be analysed', () => {
    const [main, second] = load('two-intersections.utdf.csv').intersections.map((i) => i.intersection);
    const set = main!.volumeSets[0]!;
    expect(set.name).toBe('Synchro volumes');
    const ebThru = main!.laneGroups.find((g) => g.label === 'EB Thru/Right')!;
    expect(set.volumes[ebThru.id]).toEqual({ left: 0, through: 920, right: 105 });
    // Volume-weighted between 0.92 and 0.94.
    expect(set.peakHourFactor).toBeGreaterThan(0.92);
    expect(set.peakHourFactor).toBeLessThan(0.94);
    expect(main!.patterns[0]!.volumeSetId).toBe(set.id);
    const analysis = analyzePattern(main!, main!.patterns[0]!.id);
    expect(analysis.ok && analysis.delay).toBeGreaterThan(0);
    const nb = second!.laneGroups.find((g) => g.label === 'NB Thru/Left/Right')!;
    expect(second!.volumeSets[0]!.volumes[nb.id]).toEqual({ left: 40, through: 210, right: 35 });
    expect(second!.volumeSets[0]!.peakHourFactor).toBe(0.9);
  });

  it('makes one pattern per timing plan, with plan values over the base ones', () => {
    const result = load('timing-plans.utdf.csv');
    const { intersection, notes } = result.intersections[0]!;
    expect(intersection.name).toBe('Oak Rd & Pine St');
    expect(intersection.rings).toEqual([{ groups: [[2], [4]] }]);
    expect(intersection.patterns.map((p) => [p.name, p.mode, p.cycle])).toEqual([
      ['AM', 'coordinated', 800],
      ['PM', 'coordinated', 900],
      ['NIGHT', 'free', 600],
    ]);
    const [am, pm] = intersection.patterns;
    expect(am!.splits).toEqual({ 2: 500, 4: 300 });
    expect(am).toMatchObject({ offset: 100, coordinatedPhases: [2] });
    // Begin of red: 20 s less phase 2's 4 s yellow, measured to the end of coordinated green.
    expect(pm).toMatchObject({ offset: 160, offsetReference: 'beginCoordYellow', splits: { 2: 550, 4: 350 } });
    expect(intersection.phases.find((p) => p.number === 2)!.recall).toBe('minimum');
    const messages = notes.map((n) => n.message).join('\n');
    expect(messages).toMatch(/No usable BRP/);
    expect(messages).toMatch(/NIGHT: actuated, uncoordinated, so the pattern runs free/);
    expect(messages).toMatch(/begin of red is converted/);
    expect(intersection.laneGroups).toEqual([]);
    expect(result.notes.map((n) => n.message).join('\n')).toMatch(/No \[Lanes\] section/);
    expect(validateIntersection(intersection).filter((i) => i.severity === 'error')).toEqual([]);
  });

  it('explains files it cannot use', () => {
    expect(importUtdf('a,b\n1,2', () => 'x')).toEqual({ ok: false, error: 'This is not a UTDF file: no [Section] headings were found.' });
    expect(importUtdf('[Nodes]\nNode Data\nINTID,TYPE\n1,0\n', () => 'x')).toMatchObject({ ok: false, error: /no \[Phases\] section/ });
  });
});
