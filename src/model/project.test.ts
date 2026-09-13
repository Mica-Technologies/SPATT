import { describe, expect, it } from 'vitest';
import { loadProject, saveProject, validateProject } from './project';
import type { Project } from './schema';
import { emptyProject, standardEightPhase, twoPhase } from './templates';

const NOW = new Date('2026-09-13T12:00:00.000Z');

function sampleProject(): Project {
  const project = emptyProject('Sample corridor', 'sample', NOW);
  project.intersections.push(standardEightPhase('main-and-side'), twoPhase('elm-and-3rd'));
  project.corridors.push({ id: 'main-st', name: 'Main St', intersectionIds: ['main-and-side', 'elm-and-3rd'] });
  return project;
}

const load = (value: unknown) => loadProject(JSON.stringify(value));

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
    expect(text).toContain('\n  "schemaVersion": 1,\n');
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
    const result = load({ ...sampleProject(), schemaVersion: 2 });
    expect(result.ok).toBe(false);
    expect(result.issues[0]).toMatchObject({ code: 'file.newer-version', path: ['schemaVersion'] });
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
    expect(result.issues).toEqual([
      expect.objectContaining({ code: 'pattern.cycle-sum', path: ['intersections', 1, 'patterns', 0, 'splits'] }),
    ]);
  });
});

describe('validateProject', () => {
  it('flags duplicate intersection ids', () => {
    const project = sampleProject();
    project.intersections[1]!.id = 'main-and-side';
    project.corridors = [];
    expect(validateProject(project).map((i) => i.code)).toEqual(['project.duplicate-intersection-id']);
  });

  it('flags corridors that name missing intersections', () => {
    const project = sampleProject();
    project.corridors[0]!.intersectionIds.push('gone');
    expect(validateProject(project)).toEqual([
      expect.objectContaining({ code: 'corridor.unknown-intersection', path: ['corridors', 0, 'intersectionIds', 2] }),
    ]);
  });
});
