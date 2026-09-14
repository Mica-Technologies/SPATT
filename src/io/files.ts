/**
 * Import and export of files. Export uses the native Save dialog on desktop and a browser download
 * elsewhere; import uses the browser file picker, which works in the webview too.
 */
import { invoke } from '@tauri-apps/api/core';
import { PROJECT_FILE_EXTENSION, saveProject, type Project } from '../model';
import { isTauri } from './host';

/** A file name from a user-given name: letters, digits, spaces, `-` and `_` only. */
export function safeFileName(name: string, fallback: string): string {
  const safe = name
    .normalize('NFKD')
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/\s+/g, ' ');
  return safe || fallback;
}

export function projectFileName(project: Project): string {
  return `${safeFileName(project.name, 'project')}${PROJECT_FILE_EXTENSION}`;
}

/**
 * Saves text as a file. On desktop it asks where to save with the native Save dialog
 * (`project_export` in `src-tauri/src/projects.rs`) and resolves with the chosen path, or `null`
 * if the user cancelled or the write failed (logged). In a browser it starts a download and
 * resolves with `null`. Never rejects, so callers may ignore the promise.
 */
export function saveTextFile(fileName: string, text: string, fileType = 'JSON file'): Promise<string | null> {
  if (!isTauri()) {
    browserDownload(fileName, text);
    return Promise.resolve(null);
  }
  return invoke<string | null>('project_export', { suggestedName: fileName, text, fileType }).catch((error: unknown) => {
    console.error('Export failed', error);
    return null;
  });
}

/** Exports the project as a `.spatt.json` file; see `saveTextFile`. */
export function downloadProject(project: Project): Promise<string | null> {
  return saveTextFile(projectFileName(project), saveProject(project), 'SPATT project');
}

function browserDownload(fileName: string, text: string): void {
  const blob = new Blob([text], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Lets the user pick a JSON file and resolves with its text, or null if they cancel. */
export function pickProjectFile(accept = `${PROJECT_FILE_EXTENSION},.json,application/json`): Promise<{ name: string; text: string } | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
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
