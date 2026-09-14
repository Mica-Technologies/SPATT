import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  csmDefault,
  emptyProject,
  leadLagEightPhase,
  loadProject,
  saveProject,
  splitPhaseSideStreet,
  standardEightPhase,
  twoPhase,
  type Intersection,
} from '../src/model';
import { csmPlanJsonSchema, csmPlanSchema, exportCsm } from '../src/profiles/csm';

/**
 * The committed `.spatt.json` fixtures pin the file format: if the model or a template changes
 * what gets written, this fails and the diff shows exactly what changed in the files users have.
 * Regenerate deliberately with `UPDATE_FIXTURES=1 npx vitest run test/fixtures.test.ts`.
 */
const FIXTURES: [string, () => Intersection][] = [
  ['standard-8-phase', standardEightPhase],
  ['lead-lag-8-phase', leadLagEightPhase],
  ['split-phase-side-street', splitPhaseSideStreet],
  ['two-phase', twoPhase],
  ['csm-default', csmDefault],
];

const dir = join(import.meta.dirname, 'fixtures', 'projects');
const update = process.env.UPDATE_FIXTURES === '1';

/** Writes `expected` when regenerating (or when missing), then checks the committed file. */
function pinned(path: string, expected: string): string {
  if (update || !existsSync(path)) {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, expected);
  }
  const onDisk = readFileSync(path, 'utf8').replace(/\r\n/g, '\n');
  expect(onDisk).toBe(expected);
  return onDisk;
}

/**
 * The CSM ASC-3 plans exported from the templates, and the format's JSON Schema. These are what
 * the City Super Mod implements against, so any change to them is a format change.
 */
describe('CSM plan fixtures', () => {
  it.each(FIXTURES)('%s.csm.json matches its export and reads back', (name, build) => {
    const result = exportCsm(build());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const onDisk = pinned(join(import.meta.dirname, 'fixtures', 'csm', `${name}.csm.json`), result.text);
    expect(csmPlanSchema.parse(JSON.parse(onDisk))).toEqual(result.plan);
  });

  it('csm-asc3-plan.schema.json matches the format', () => {
    pinned(join(import.meta.dirname, '..', 'docs', 'profiles', 'csm-asc3-plan.schema.json'), `${JSON.stringify(csmPlanJsonSchema(), null, 2)}\n`);
  });
});

describe('project fixtures', () => {
  it.each(FIXTURES)('%s.spatt.json matches its template and loads cleanly', (name, build) => {
    const project = emptyProject(build().name, name, new Date('2026-09-13T00:00:00.000Z'));
    project.intersections.push(build());
    const expected = saveProject(project);
    const path = join(dir, `${name}.spatt.json`);

    if (update || !existsSync(path)) {
      mkdirSync(dir, { recursive: true });
      writeFileSync(path, expected);
    }
    const onDisk = readFileSync(path, 'utf8').replace(/\r\n/g, '\n');
    expect(onDisk).toBe(expected);

    const loaded = loadProject(onDisk);
    expect(loaded).toEqual({ ok: true, project, issues: [] });
  });
});
