/**
 * Project library in the desktop app's data folder. Placeholder until the Rust commands exist:
 * it delegates to browser storage inside the webview so the desktop app is usable meanwhile.
 */
import { BrowserStore } from './browser-store';
import type { ProjectStore, ProjectSummary } from './store';

export class TauriStore implements ProjectStore {
  readonly kind = 'tauri' as const;
  private readonly fallback = new BrowserStore();

  list(): Promise<ProjectSummary[]> {
    return this.fallback.list();
  }

  read(id: string): Promise<string | null> {
    return this.fallback.read(id);
  }

  write(id: string, text: string): Promise<void> {
    return this.fallback.write(id, text);
  }

  remove(id: string): Promise<void> {
    return this.fallback.remove(id);
  }
}
