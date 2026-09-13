import type { FieldPath } from '../fields/paths';
import { useWorkspace, type WorkspaceTab } from '../state/workspace';

const TAB_FOR_SECTION: Record<string, WorkspaceTab> = {
  phases: 'phases',
  overlaps: 'phases',
  preempts: 'phases',
  rings: 'rings',
  patterns: 'patterns',
  schedule: 'schedule',
};

/** Opens the editor that owns a project path and asks it to focus the field. */
export function navigateTo(path: FieldPath): void {
  const state = useWorkspace.getState();
  const project = state.project;
  if (!project || path[0] !== 'intersections' || typeof path[1] !== 'number') {
    return;
  }
  const intersection = project.intersections[path[1]];
  if (!intersection) {
    return;
  }
  state.selectIntersection(intersection.id);
  const section = String(path[2] ?? 'phases');
  state.setTab(TAB_FOR_SECTION[section] ?? 'phases');
  if (section === 'patterns' && typeof path[3] === 'number') {
    const pattern = intersection.patterns[path[3]];
    if (pattern) {
      state.selectPattern(pattern.id);
    }
  }
  state.requestFocus(path);
}
