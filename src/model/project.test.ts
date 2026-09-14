import { describe, expect, it } from 'vitest';
import { newCorridorPlan, newCorridorStop, removeIntersectionFromCorridors, removePatternFromCorridors, suggestThroughPhases } from './corridor';
import { loadProject, saveProject, validateProject } from './project';
import type { Project } from './schema';
import { emptyProject, splitPhaseSideStreet, standardEightPhase, twoPhase } from './templates';

const NOW = new Date('2026-09-13T12:00:00.000Z');

function sampleProject(): Project {
  const project = emptyProject('Sample corridor', 'sample', NOW);
  const main = standardEightPhase('main-and-side');
  const elm = twoPhase('elm-and-3rd');
  elm.patterns[0]!.cycle = 900;
  Object.assign(elm.patterns[0]!.splits, { 2: 500, 4: 400, 6: 500, 8: 400 });
  project.intersections.push(main, elm);
  project.corridors.push({
    id: 'main-st',
    name: 'Main St',
    outbound: 'E',
    stops: [newCorridorStop(main, 'E', true), newCorridorStop(elm, 'E', false)],
    plans: [newCorridorPlan('am', 'AM', [main, elm])],
  });
  return project;
}

const load = (value: unknown) => loadProject(JSON.stringify(value));
const codes = (project: Project) => validateProject(project).map((i) => i.code);

describe('loadProject', () => {
  it('round-trips a project exactly', () => {
    const project = sampleProject();
    const result = loadProject(saveProject(project));
    expect(result).toEqual({ ok: true, project, issues: [] });
  });

  it('preserves controller extension data it does not understand', () => {
    const project = sampleProject();
    const phase = project.intersections[0]!.phases[0]!;
    phase.extensions = { csm: { circuit: 2, flashOverride: 'yellow', nested: { any: [1, 'two'] } } };
    const result = loadProject(saveProject(project));
    expect(result.ok && result.project.intersections[0]!.phases[0]!.extensions).toEqual(phase.extensions);
  });

  it('writes stable, diffable text', () => {
    const text = saveProject(sampleProject());
    expect(text.endsWith('}\n')).toBe(true);
    expect(text).toContain('\n  "schemaVersion": 2,\n');
  });

  it('rejects text that is not JSON', () => {
    const result = loadProject('{ nope');
    expect(result.ok).toBe(false);
    expect(result.issues[0]?.code).toBe('file.invalid-json');
  });

  it('rejects JSON that is not a SPATT project', () => {
    expect(load([1, 2]).issues[0]?.code).toBe('file.not-a-project');
    expect(load({ app: 'other', schemaVersion: 1 }).issues[0]?.code).toBe('file.not-a-project');
    expect(load({ app: 'spatt' }).issues[0]?.code).toBe('file.bad-version');
  });

  it('refuses files from a newer SPATT instead of misreading them', () => {
    const result = load({ ...sampleProject(), schemaVersion: 3 });
    expect(result.ok).toBe(false);
    expect(result.issues[0]).toMatchObject({ code: 'file.newer-version', path: ['schemaVersion'] });
  });

  it('migrates a version 1 file: placeholder corridors become stops with default links', () => {
    const v2 = sampleProject();
    const v1 = { ...v2, schemaVersion: 1, corridors: [{ id: 'main-st', name: 'Main St', intersectionIds: ['main-and-side', 'elm-and-3rd'] }] };
    const result = load(v1);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.project.schemaVersion).toBe(2);
    expect(result.project.corridors).toEqual([
      {
        id: 'main-st',
        name: 'Main St',
        outbound: 'E',
        stops: [
          { intersectionId: 'main-and-side', distance: 0, speed: { outbound: 13.4, inbound: 13.4 }, speedLimit: null, outboundPhases: [], inboundPhases: [] },
          { intersectionId: 'elm-and-3rd', distance: 300, speed: { outbound: 13.4, inbound: 13.4 }, speedLimit: null, outboundPhases: [], inboundPhases: [] },
        ],
        plans: [],
      },
    ]);
    expect(result.issues.map((i) => i.code)).toEqual(['corridor.no-through-phases', 'corridor.no-through-phases']);
  });

  it('reports shape errors with their path', () => {
    const project = sampleProject() as unknown as { intersections: { phases: { yellow: number }[] }[] };
    project.intersections[0]!.phases[1]!.yellow = 3.5; // seconds instead of tenths
    const result = load(project);
    expect(result.ok).toBe(false);
    expect(result.issues[0]).toMatchObject({ code: 'file.schema', path: ['intersections', 0, 'phases', 1, 'yellow'] });
  });

  it('rejects phase numbers past 16 and overlap ids past P', () => {
    const tooHigh = sampleProject();
    tooHigh.intersections[0]!.phases[0]!.number = 17;
    expect(load(tooHigh).ok).toBe(false);

    const badOverlap = sampleProject() as unknown as { intersections: { overlaps: unknown[] }[] };
    badOverlap.intersections[0]!.overlaps.push({
      id: 'Q',
      label: '',
      enabled: true,
      type: 'normal',
      includedPhases: [2],
      modifierPhases: [],
      trailGreen: 0,
      trailYellow: 0,
      trailRedClear: 0,
    });
    expect(load(badOverlap).ok).toBe(false);
  });

  it('loads a semantically broken plan, with its issues, so it can be fixed', () => {
    const project = sampleProject();
    project.intersections[1]!.patterns[0]!.cycle = 800;
    const result = load(project);
    expect(result.ok).toBe(true);
    expect(result.issues.map((i) => i.code)).toEqual(['pattern.cycle-sum', 'corridor.plan-cycle-mismatch']);
    expect(result.issues[0]).toMatchObject({ path: ['intersections', 1, 'patterns', 0, 'splits'] });
  });
});

describe('validateProject', () => {
  it('flags duplicate intersection and corridor ids', () => {
    const project = sampleProject();
    project.intersections[1]!.id = 'main-and-side';
    project.corridors.push({ ...structuredClone(project.corridors[0]!), stops: [] });
    expect(codes(project)).toEqual(expect.arrayContaining(['project.duplicate-intersection-id', 'project.duplicate-corridor-id', 'corridor.too-few-stops']));
  });

  it('checks each corridor stop', () => {
    const project = sampleProject();
    const [, elm] = project.corridors[0]!.stops;
    elm!.distance = 0;
    elm!.speed.inbound = 0;
    elm!.outboundPhases = [3];
    project.corridors[0]!.stops.push({ ...structuredClone(elm!), intersectionId: 'gone' }, { ...structuredClone(elm!), intersectionId: 'main-and-side', outboundPhases: [], inboundPhases: [] });
    const issues = validateProject(project);
    expect(issues.map((i) => [i.code, i.path.join('.')])).toEqual([
      ['corridor.distance-missing', 'corridors.0.stops.1.distance'],
      ['corridor.speed-missing', 'corridors.0.stops.1.speed.inbound'],
      ['corridor.unknown-phase', 'corridors.0.stops.1.outboundPhases'],
      ['corridor.unknown-intersection', 'corridors.0.stops.2.intersectionId'],
      ['corridor.repeated-intersection', 'corridors.0.stops.3.intersectionId'],
      // Copied from stop 1, so it has the same missing distance and speed.
      ['corridor.distance-missing', 'corridors.0.stops.3.distance'],
      ['corridor.speed-missing', 'corridors.0.stops.3.speed.inbound'],
      ['corridor.no-through-phases', 'corridors.0.stops.3.outboundPhases'],
    ]);
  });

  it('checks each corridor plan', () => {
    const project = sampleProject();
    const corridor = project.corridors[0]!;
    corridor.plans.push({ ...structuredClone(corridor.plans[0]!), name: 'Broken', patterns: { 'main-and-side': 'nope', 'elm-and-3rd': null } });
    corridor.plans.push({ ...structuredClone(corridor.plans[0]!), id: 'free', name: 'Free' });
    project.intersections[1]!.patterns.push({ ...structuredClone(project.intersections[1]!.patterns[0]!), id: 'night', mode: 'free' });
    corridor.plans[2]!.patterns['elm-and-3rd'] = 'night';
    expect(validateProject(project).map((i) => [i.code, i.path.join('.')])).toEqual([
      ['corridor.plan-duplicate-id', 'corridors.0.plans.1.id'],
      ['corridor.plan-unknown-pattern', 'corridors.0.plans.1.patterns.main-and-side'],
      ['corridor.plan-missing-intersection', 'corridors.0.plans.1.patterns.elm-and-3rd'],
      ['corridor.plan-free-pattern', 'corridors.0.plans.2.patterns.elm-and-3rd'],
    ]);
  });

  it('flags a plan whose intersections run different cycles', () => {
    const project = sampleProject();
    const elm = project.intersections[1]!.patterns[0]!;
    elm.cycle = 700;
    Object.assign(elm.splits, { 2: 400, 4: 300, 6: 400, 8: 300 });
    expect(validateProject(project)).toEqual([
      expect.objectContaining({ code: 'corridor.plan-cycle-mismatch', message: expect.stringContaining('90.0 s (Main St & Side St); 70.0 s (Elm St & 3rd Ave)') }),
    ]);
  });
});

describe('corridor helpers', () => {
  it('suggests through phases travelling each way', () => {
    // Standard eight-phase: 2 is EB through, 6 is WB through, 4 SB, 8 NB.
    expect(suggestThroughPhases(standardEightPhase(), 'E')).toEqual({ outboundPhases: [2], inboundPhases: [6] });
    expect(suggestThroughPhases(standardEightPhase(), 'N')).toEqual({ outboundPhases: [8], inboundPhases: [4] });
    // Split-phase side street: 4 "SB All" and 8 "NB All" are through movements too.
    expect(suggestThroughPhases(splitPhaseSideStreet(), 'S')).toEqual({ outboundPhases: [4], inboundPhases: [8] });
  });

  it('removes deleted intersections and patterns from corridors', () => {
    const project = sampleProject();
    removePatternFromCorridors(project, 'elm-and-3rd', 'all-day');
    expect(project.corridors[0]!.plans[0]!.patterns['elm-and-3rd']).toBeNull();
    removeIntersectionFromCorridors(project, 'main-and-side');
    expect(project.corridors[0]!.stops.map((s) => [s.intersectionId, s.distance])).toEqual([['elm-and-3rd', 0]]);
    expect(project.corridors[0]!.plans[0]!.patterns).toEqual({ 'elm-and-3rd': null });
  });
});
