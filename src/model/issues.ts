/** A problem found in a project. Validation never throws; it returns every issue it finds. */
export interface Issue {
  severity: 'error' | 'warning';
  /** Stable identifier, e.g. `pattern.barrier-misaligned`. UI and tests key off this, not the message. */
  code: string;
  message: string;
  /** Path into the validated object, e.g. `['patterns', 0, 'splits', '2']`, for click-to-field. */
  path: (string | number)[];
}

export const error = (code: string, message: string, path: Issue['path']): Issue => ({
  severity: 'error',
  code,
  message,
  path,
});

export const warning = (code: string, message: string, path: Issue['path']): Issue => ({
  severity: 'warning',
  code,
  message,
  path,
});

export const hasErrors = (issues: readonly Issue[]): boolean => issues.some((i) => i.severity === 'error');
