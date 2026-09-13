import { useMemo } from 'react';
import { validateProject, type Issue } from '../../model';
import { useWorkspace } from './workspace';

/** Validation issues for the open project, recomputed once per change. */
export function useIssues(): Issue[] {
  const project = useWorkspace((s) => s.project);
  return useMemo(() => (project ? validateProject(project) : []), [project]);
}

/** The issues of one intersection, with paths still rooted at the project. */
export function useIntersectionIssues(intersectionIndex: number): Issue[] {
  const issues = useIssues();
  return useMemo(() => issues.filter((i) => i.path[0] === 'intersections' && i.path[1] === intersectionIndex), [issues, intersectionIndex]);
}
