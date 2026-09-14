/**
 * The project library. Every host keeps projects somewhere different (browser storage, the
 * desktop app's data folder, the network server), but the UI only ever talks to this interface.
 *
 * Stores deal in project file text, not objects: `loadProject` in the model is the single place
 * text becomes a validated project, whichever store it came from.
 *
 * Every stored project has a version (a hash of its text, `versionOf`). Writes can be made
 * conditional on it, so two tabs or devices editing one project cannot silently overwrite each
 * other: the loser gets a `ConflictError` naming the version it missed.
 */
import { loadProject, randomHex, saveProject, type LoadResult, type Project } from '../model';

export interface ProjectSummary {
  id: string;
  name: string;
  updatedAt: string;
  intersectionCount: number;
}

export interface StoredProject {
  text: string;
  version: string;
}

/**
 * What a write expects to find: `undefined` for no condition (last write wins), `null` for no
 * such project yet, or the version it last read or wrote.
 */
export type ExpectedVersion = string | null | undefined;

export class ConflictError extends Error {
  /** The project's version now, or `null` if it was deleted. */
  readonly current: string | null;

  constructor(current: string | null) {
    super(current === null ? 'The project was deleted elsewhere' : 'The project was changed elsewhere');
    this.name = 'ConflictError';
    this.current = current;
  }
}

export interface ProjectStore {
  readonly kind: 'browser' | 'tauri' | 'server';
  /** Newest first. */
  list(): Promise<ProjectSummary[]>;
  /** Raw file text and version, or `null` if there is no such project. */
  read(id: string): Promise<StoredProject | null>;
  /** Resolves with the new version; rejects with `ConflictError` if `expected` does not hold. */
  write(id: string, text: string, expected?: ExpectedVersion): Promise<string>;
  remove(id: string): Promise<void>;
}

/** Project ids become file names on desktop and server, so they are restricted to a safe set. */
export const PROJECT_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,62}$/;

export function newProjectId(random: () => string = () => randomHex(20)): string {
  return `p-${random().replace(/-/g, '').slice(0, 20).toLowerCase()}`;
}

const FNV_OFFSET = 0xcbf29ce484222325n;
const FNV_PRIME = 0x100000001b3n;
const MASK = 0xffffffffffffffffn;

/**
 * A project's version: FNV-1a, 64 bits, over the UTF-8 bytes of its text, as 16 hex digits.
 * Identical to `version_of` in `crates/spatt-server/src/store.rs`.
 */
export function versionOf(text: string): string {
  let hash = FNV_OFFSET;
  for (const byte of new TextEncoder().encode(text)) {
    hash = ((hash ^ BigInt(byte)) * FNV_PRIME) & MASK;
  }
  return hash.toString(16).padStart(16, '0');
}

/**
 * Throws `ConflictError` unless a project at `current` satisfies `expected`. Writing exactly the
 * text already stored (`next === current`) always passes, as in the Rust store: the same save
 * sent twice is not a conflict.
 */
export function checkExpected(current: string | null, expected: ExpectedVersion, next?: string): void {
  if (expected === undefined || current === expected || (next !== undefined && current === next)) {
    return;
  }
  throw new ConflictError(current);
}

export function summarize(project: Project): ProjectSummary {
  return {
    id: project.id,
    name: project.name,
    updatedAt: project.updatedAt,
    intersectionCount: project.intersections.length,
  };
}

export async function openFromStore(store: ProjectStore, id: string): Promise<{ result: LoadResult; version: string } | null> {
  const stored = await store.read(id);
  return stored === null ? null : { result: loadProject(stored.text), version: stored.version };
}

/** Saves the project, resolving with its new version. */
export async function saveToStore(store: ProjectStore, project: Project, expected?: ExpectedVersion): Promise<string> {
  if (!PROJECT_ID_PATTERN.test(project.id)) {
    throw new Error(`Project id "${project.id}" cannot be stored`);
  }
  return store.write(project.id, saveProject(project), expected);
}
