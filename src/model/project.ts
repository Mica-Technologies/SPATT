/**
 * Loading, migrating, validating and saving `*.spatt.json` project files.
 */
import { DEFAULT_LINK, validateCorridor } from './corridor';
import { error, type Issue } from './issues';
import { PROJECT_SCHEMA_VERSION, projectSchema, type Project } from './schema';
import { validateIntersection } from './validate';

export const PROJECT_FILE_EXTENSION = '.spatt.json';

/**
 * Brings a parsed file up to the current schema version. Each future version adds one step
 * here (v1 → v2, v2 → v3, ...) so any older file loads.
 */
export function migrateProject(raw: unknown): { value: unknown; issues: Issue[] } {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { value: raw, issues: [error('file.not-a-project', 'The file is not a SPATT project', [])] };
  }
  const record = raw as Record<string, unknown>;
  if (record.app !== 'spatt') {
    return { value: raw, issues: [error('file.not-a-project', 'The file is not a SPATT project', ['app'])] };
  }
  const version = record.schemaVersion;
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) {
    return { value: raw, issues: [error('file.bad-version', 'The file has no valid schema version', ['schemaVersion'])] };
  }
  if (version > PROJECT_SCHEMA_VERSION) {
    return {
      value: raw,
      issues: [error('file.newer-version', `The file was saved by a newer SPATT (format ${version}); this version reads format ${PROJECT_SCHEMA_VERSION}`, ['schemaVersion'])],
    };
  }
  let value: Record<string, unknown> = record;
  if (version < 2) {
    value = migrateV1(value);
  }
  return { value, issues: [] };
}

/**
 * v1 → v2: corridors were a placeholder (`intersectionIds`); they become stops with default links
 * and no through phases or plans, for the user to fill in.
 */
function migrateV1(v1: Record<string, unknown>): Record<string, unknown> {
  const corridors = Array.isArray(v1.corridors) ? v1.corridors : [];
  return {
    ...v1,
    schemaVersion: 2,
    corridors: corridors.map((corridor) => {
      const old = corridor as { id?: unknown; name?: unknown; intersectionIds?: unknown };
      const ids = Array.isArray(old.intersectionIds) ? old.intersectionIds : [];
      return {
        id: old.id,
        name: old.name,
        outbound: 'E',
        stops: ids.map((intersectionId, k) => ({
          intersectionId,
          distance: k === 0 ? 0 : DEFAULT_LINK.distance,
          speed: { outbound: DEFAULT_LINK.speed, inbound: DEFAULT_LINK.speed },
          speedLimit: null,
          outboundPhases: [],
          inboundPhases: [],
        })),
        plans: [],
      };
    }),
  };
}

export type LoadResult = { ok: true; project: Project; issues: Issue[] } | { ok: false; issues: Issue[] };

/**
 * Parses file text into a project. Shape errors make the load fail; semantic issues are
 * returned alongside a loaded project, because an invalid plan is still worth opening to fix.
 */
export function loadProject(text: string): LoadResult {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (cause) {
    return { ok: false, issues: [error('file.invalid-json', `The file is not valid JSON: ${(cause as Error).message}`, [])] };
  }
  const migrated = migrateProject(raw);
  if (migrated.issues.length > 0) {
    return { ok: false, issues: migrated.issues };
  }
  const parsed = projectSchema.safeParse(migrated.value);
  if (!parsed.success) {
    return {
      ok: false,
      issues: parsed.error.issues.map((issue) => error('file.schema', issue.message, issue.path.map((p) => (typeof p === 'symbol' ? String(p) : p)))),
    };
  }
  return { ok: true, project: parsed.data, issues: validateProject(parsed.data) };
}

export function validateProject(project: Project): Issue[] {
  const issues: Issue[] = [];
  const ids = new Set<string>();
  project.intersections.forEach((intersection, index) => {
    if (ids.has(intersection.id)) {
      issues.push(error('project.duplicate-intersection-id', `Intersection id "${intersection.id}" is used more than once`, ['intersections', index, 'id']));
    }
    ids.add(intersection.id);
    for (const issue of validateIntersection(intersection)) {
      issues.push({ ...issue, path: ['intersections', index, ...issue.path] });
    }
  });
  const corridorIds = new Set<string>();
  project.corridors.forEach((corridor, index) => {
    if (corridorIds.has(corridor.id)) {
      issues.push(error('project.duplicate-corridor-id', `Corridor id "${corridor.id}" is used more than once`, ['corridors', index, 'id']));
    }
    corridorIds.add(corridor.id);
    issues.push(...validateCorridor(corridor, project, ['corridors', index]));
  });
  return issues;
}

/** Serializes with stable two-space formatting and a trailing newline, so files diff cleanly. */
export function saveProject(project: Project): string {
  return `${JSON.stringify(project, null, 2)}\n`;
}
