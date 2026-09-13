import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
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
