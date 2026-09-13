/** Import and export of `.spatt.json` files in the browser (and the Tauri webview). */
import { PROJECT_FILE_EXTENSION, saveProject, type Project } from '../model';

export function projectFileName(project: Project): string {
  const safe = project.name
    .normalize('NFKD')
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/\s+/g, ' ');
  return `${safe || 'project'}${PROJECT_FILE_EXTENSION}`;
}

/** Offers the project as a file download. */
export function downloadProject(project: Project): void {
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
