/** The intersection templates offered when adding an intersection. */
import { csmDefault, leadLagEightPhase, splitPhaseSideStreet, standardEightPhase, twoPhase, type Intersection } from '../../model';

export interface IntersectionTemplate {
  label: string;
  description: string;
  build: (id: string) => Intersection;
}

export const TEMPLATES: IntersectionTemplate[] = [
  { label: 'Standard eight-phase', description: 'Protected lefts leading on both streets, 90 s coordinated on 2 and 6', build: standardEightPhase },
  { label: 'Eight-phase, lead-lag', description: 'As standard, with the ring 1 main-street left lagging', build: leadLagEightPhase },
  { label: 'Split-phase side street', description: 'Leading lefts on the main street, each side-street approach on its own', build: splitPhaseSideStreet },
  { label: 'Two-phase', description: 'Main street then side street, no protected lefts', build: twoPhase },
  { label: 'CSM ASC-3 default', description: 'What a new CSM controller starts with: eight phases, running free', build: csmDefault },
];
