import type { FieldPath } from '../fields/paths';
import { useWorkspace, type WorkspaceTab } from '../state/workspace';

const TAB_FOR_SECTION: Record<string, WorkspaceTab> = {
  phases: 'phases',
  overlaps: 'phases',
  preempts: 'phases',
  rings: 'rings',
  patterns: 'patterns',
  schedule: 'schedule',
  capacity: 'volumes',
  laneGroups: 'volumes',
  volumeSets: 'volumes',
};

/** Opens the editor that owns a project path and asks it to focus the field. */
export function navigateTo(path: FieldPath): void {
  const state = useWorkspace.getState();
  const project = state.project;
  if (!project || typeof path[1] !== 'number') {
    return;
  }
  if (path[0] === 'corridors') {
    const corridor = project.corridors[path[1]];
    if (!corridor) return;
    state.selectCorridor(corridor.id);
    state.setCorridorTab(path[2] === 'plans' ? 'plans' : 'layout');
    if (path[2] === 'plans' && typeof path[3] === 'number') {
      const plan = corridor.plans[path[3]];
      if (plan) state.selectPlan(plan.id);
    }
    state.requestFocus(path);
    return;
  }
  if (path[0] !== 'intersections') {
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
