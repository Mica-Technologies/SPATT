/**
 * Project library in the desktop app's data folder (`<app data>/projects/<id>.spatt.json`).
 * The files are managed by the Rust commands in `src-tauri/src/projects.rs`; keep the command
 * and argument names in step with them.
 */
import { invoke } from '@tauri-apps/api/core';
import type { ProjectStore, ProjectSummary } from './store';

export class TauriStore implements ProjectStore {
  readonly kind = 'tauri' as const;

  list(): Promise<ProjectSummary[]> {
    return invoke<ProjectSummary[]>('projects_list');
  }

  read(id: string): Promise<string | null> {
    return invoke<string | null>('projects_read', { id });
  }

  write(id: string, text: string): Promise<void> {
    return invoke<void>('projects_write', { id, text });
  }

  remove(id: string): Promise<void> {
    return invoke<void>('projects_remove', { id });
  }
}
