/**
 * The project library. Every host keeps projects somewhere different (browser storage, the
 * desktop app's data folder, the network server), but the UI only ever talks to this interface.
 *
 * Stores deal in project file text, not objects: `loadProject` in the model is the single place
 * text becomes a validated project, whichever store it came from.
 */
import { loadProject, saveProject, type LoadResult, type Project } from '../model';

export interface ProjectSummary {
  id: string;
  name: string;
  updatedAt: string;
  intersectionCount: number;
}

export interface ProjectStore {
  readonly kind: 'browser' | 'tauri' | 'server';
  /** Newest first. */
  list(): Promise<ProjectSummary[]>;
  /** Raw file text, or `null` if there is no such project. */
  read(id: string): Promise<string | null>;
  write(id: string, text: string): Promise<void>;
  remove(id: string): Promise<void>;
}

/** Project ids become file names on desktop and server, so they are restricted to a safe set. */
export const PROJECT_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,62}$/;

export function newProjectId(random: () => string = () => crypto.randomUUID()): string {
  return `p-${random().replace(/-/g, '').slice(0, 20).toLowerCase()}`;
}

export function summarize(project: Project): ProjectSummary {
  return {
    id: project.id,
    name: project.name,
    updatedAt: project.updatedAt,
    intersectionCount: project.intersections.length,
  };
}

export async function openFromStore(store: ProjectStore, id: string): Promise<LoadResult | null> {
  const text = await store.read(id);
  return text === null ? null : loadProject(text);
}

export async function saveToStore(store: ProjectStore, project: Project): Promise<void> {
  if (!PROJECT_ID_PATTERN.test(project.id)) {
    throw new Error(`Project id "${project.id}" cannot be stored`);
  }
  await store.write(project.id, saveProject(project));
}
