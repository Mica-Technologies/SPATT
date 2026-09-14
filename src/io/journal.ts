/**
 * A synchronous safety copy of the open project, written when the page is being hidden or
 * closed. Every library store is asynchronous (IndexedDB, Tauri commands, HTTP), and a write
 * started while the page unloads may be dropped with it; `localStorage` is written before the
 * handler returns. The next time the library loads, `recoverJournal` hands any copy newer than
 * the store's to the store and clears it.
 */
import { saveProject, type Project } from '../model';
import type { ProjectStore } from './store';

const PREFIX = 'spatt:unsaved:';

function defaultStorage(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

function updatedAtOf(text: string | null): string {
  try {
    const raw = text === null ? null : (JSON.parse(text) as { updatedAt?: unknown });
    return typeof raw?.updatedAt === 'string' ? raw.updatedAt : '';
  } catch {
    return '';
  }
}

/** Keeps a copy of the project; never throws (a full or blocked storage just keeps nothing). */
export function journalProject(project: Project, storage: Storage | null = defaultStorage()): void {
  try {
    storage?.setItem(PREFIX + project.id, saveProject(project));
  } catch {
    // Nothing more can be done while the page is going away.
  }
}

/**
 * Writes every journal copy that is newer than the store's version of that project (or whose
 * project the store no longer has) to the store, then clears the journal. Resolves with the ids
 * written. A copy the store refuses stays in the journal for the next attempt.
 */
export async function recoverJournal(store: ProjectStore, storage: Storage | null = defaultStorage()): Promise<string[]> {
  if (!storage) {
    return [];
  }
  const keys = Array.from({ length: storage.length }, (_, k) => storage.key(k)).filter((key): key is string => key?.startsWith(PREFIX) === true);
  const written: string[] = [];
  for (const key of keys) {
    const id = key.slice(PREFIX.length);
    const text = storage.getItem(key);
    if (text === null) {
      continue;
    }
    try {
      const stored = await store.read(id);
      if (stored === null || updatedAtOf(text) > updatedAtOf(stored)) {
        await store.write(id, text);
        written.push(id);
      }
      storage.removeItem(key);
    } catch (cause) {
      console.error(`Could not recover unsaved changes to project ${id}`, cause);
    }
  }
  return written;
}
