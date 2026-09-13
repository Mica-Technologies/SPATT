import type { Intersection, Issue } from '../../model';

/** Props every workspace tab receives. Issue paths are rooted at the project. */
export interface TabProps {
  intersection: Intersection;
  intersectionIndex: number;
  issues: readonly Issue[];
}
