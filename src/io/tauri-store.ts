/**
 * Project library in the desktop app's data folder (`<app data>/projects/<id>.spatt.json`).
 * The files are managed by the Rust commands in `src-tauri/src/projects.rs`; keep the command
 * and argument names in step with them.
 */
import { invoke } from '@tauri-apps/api/core';
import { ConflictError, type ExpectedVersion, type ProjectStore, type ProjectSummary, type StoredProject } from './store';

/** Mirrors `Expected` in `src-tauri/src/projects.rs`. */
type ExpectedArg = { kind: 'any' } | { kind: 'absent' } | { kind: 'version'; version: string };

/** Mirrors `CommandError` in `src-tauri/src/projects.rs`. */
interface CommandError {
  kind: 'conflict' | 'failed';
  current?: string | null;
  message: string;
}

function toExpectedArg(expected: ExpectedVersion): ExpectedArg {
  if (expected === undefined) return { kind: 'any' };
  if (expected === null) return { kind: 'absent' };
  return { kind: 'version', version: expected };
}

/** Command errors arrive as `CommandError` objects; conflicts become `ConflictError`. */
function rethrow(error: unknown): never {
  if (typeof error === 'object' && error !== null && 'kind' in error) {
    const command = error as CommandError;
    if (command.kind === 'conflict') {
      throw new ConflictError(command.current ?? null);
    }
    throw new Error(command.message);
  }
  throw error instanceof Error ? error : new Error(String(error));
}

export class TauriStore implements ProjectStore {
  readonly kind = 'tauri' as const;

  list(): Promise<ProjectSummary[]> {
    return invoke<ProjectSummary[]>('projects_list').catch(rethrow);
  }

  read(id: string): Promise<StoredProject | null> {
    return invoke<StoredProject | null>('projects_read', { id }).catch(rethrow);
  }

  write(id: string, text: string, expected?: ExpectedVersion): Promise<string> {
    return invoke<string>('projects_write', { id, text, expected: toExpectedArg(expected) }).catch(rethrow);
  }

  remove(id: string): Promise<void> {
    return invoke<void>('projects_remove', { id }).catch(rethrow);
  }
}
