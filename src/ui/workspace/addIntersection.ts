import { randomId, uniqueName, type Intersection } from '../../model';
import { useWorkspace } from '../state/workspace';

/**
 * Adds an intersection built from a template and selects it. `renamed` is true when its name was
 * taken and it got a numbered one, so the caller can offer to rename it.
 */
export function addTemplateIntersection(build: (id: string) => Intersection): { id: string; name: string; renamed: boolean } {
  const { project, edit, selectIntersection } = useWorkspace.getState();
  const intersection = build(randomId('i'));
  const taken = project?.intersections.map((i) => i.name) ?? [];
  const name = uniqueName(intersection.name, taken);
  const renamed = name !== intersection.name;
  intersection.name = name;
  edit(`Add ${name}`, (p) => p.intersections.push(intersection));
  selectIntersection(intersection.id);
  return { id: intersection.id, name, renamed };
}
