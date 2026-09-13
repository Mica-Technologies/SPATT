/**
 * Import and export of `.spatt.json` files. Export uses the native Save dialog on desktop and a
 * browser download elsewhere; import uses the browser file picker, which works in the webview too.
 */
import { invoke } from '@tauri-apps/api/core';
import { PROJECT_FILE_EXTENSION, saveProject, type Project } from '../model';
import { isTauri } from './host';

export function projectFileName(project: Project): string {
  const safe = project.name
    .normalize('NFKD')
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/\s+/g, ' ');
  return `${safe || 'project'}${PROJECT_FILE_EXTENSION}`;
}

/**
 * Exports the project as a file. On desktop it asks where to save with the native Save dialog
 * (`project_export` in `src-tauri/src/projects.rs`) and resolves with the chosen path, or `null`
 * if the user cancelled or the write failed (logged). In a browser it starts a download and
 * resolves with `null`. Never rejects, so callers may ignore the promise.
 */
export function downloadProject(project: Project): Promise<string | null> {
  if (!isTauri()) {
    browserDownload(project);
    return Promise.resolve(null);
  }
  return invoke<string | null>('project_export', {
    suggestedName: projectFileName(project),
    text: saveProject(project),
  }).catch((error: unknown) => {
    console.error('Project export failed', error);
    return null;
  });
}

function browserDownload(project: Project): void {
  const blob = new Blob([saveProject(project)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = projectFileName(project);
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Lets the user pick a file and resolves with its text, or null if they cancel. */
export function pickProjectFile(): Promise<{ name: string; text: string } | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = `${PROJECT_FILE_EXTENSION},.json,application/json`;
    input.addEventListener('change', () => {
      const file = input.files?.[0];
      if (!file) {
        resolve(null);
        return;
      }
      void file.text().then((text) => resolve({ name: file.name, text }));
    });
    input.addEventListener('cancel', () => resolve(null));
    input.click();
  });
}
