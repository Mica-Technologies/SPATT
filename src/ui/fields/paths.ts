import type { Issue } from '../../model';

export type FieldPath = (string | number)[];

/** DOM id for the editor control of a project path, so the problems panel can focus it. */
export const fieldId = (path: FieldPath): string => `field:${path.join('.')}`;

const startsWith = (path: FieldPath, prefix: FieldPath): boolean =>
  prefix.length <= path.length && prefix.every((part, i) => String(part) === String(path[i]));

/**
 * Issues that concern a control: those pointing at it or inside it, and those pointing at a
 * parent object at least `minParentDepth` deep (e.g. a phase's `pedestrian` block marks the walk
 * and clearance cells, but a whole-intersection issue does not mark every cell).
 */
export function issuesFor(issues: readonly Issue[], path: FieldPath, minParentDepth = 5): Issue[] {
  return issues.filter((issue) => startsWith(issue.path, path) || (issue.path.length >= minParentDepth && startsWith(path, issue.path)));
}

export function worstSeverity(issues: readonly Issue[]): Issue['severity'] | null {
  if (issues.some((i) => i.severity === 'error')) return 'error';
  return issues.length > 0 ? 'warning' : null;
}

/** Finds the control for a path, walking up to the nearest ancestor that has one. */
export function findFieldElement(path: FieldPath, doc: Document = document): HTMLElement | null {
  for (let length = path.length; length > 0; length--) {
    const element = doc.getElementById(fieldId(path.slice(0, length)));
    if (element) {
      return element;
    }
  }
  return null;
}
