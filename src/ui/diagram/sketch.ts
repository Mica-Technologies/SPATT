/**
 * The projection the live diagram draws. When the only thing stopping a projection is that the
 * splits do not add up to the cycle, the pattern is projected over the splits' own total instead,
 * so the diagram can still be drawn with the entered cycle marked against it.
 */
import { projectCycle, type ProjectionResult } from '../../engine';
import { effectiveSequence, type Intersection, type Tenths } from '../../model';

export interface DiagramProjection {
  result: ProjectionResult;
  /** The pattern's cycle when the drawing uses the splits' total instead; otherwise null. */
  enteredCycle: Tenths | null;
}

export function projectForDiagram(intersection: Intersection, patternId: string): DiagramProjection {
  const result = projectCycle(intersection, patternId);
  const pattern = intersection.patterns.find((p) => p.id === patternId);
  if (result.ok || !pattern || result.issues.length === 0 || !result.issues.every((i) => i.code === 'pattern.cycle-sum')) {
    return { result, enteredCycle: null };
  }
  // As validation: each barrier group lasts as long as the first ring that serves it.
  const enabled = new Set(intersection.phases.filter((p) => p.enabled).map((p) => p.number));
  const sequence = effectiveSequence(pattern, intersection.rings);
  const groups = sequence[0]?.groups.length ?? 0;
  let total = 0;
  for (let g = 0; g < groups; g++) {
    const serving = sequence.map((ring) => (ring.groups[g] ?? []).filter((n) => enabled.has(n))).find((list) => list.length > 0) ?? [];
    total += serving.reduce((sum, n) => sum + (pattern.splits[String(n)] ?? 0), 0);
  }
  if (total <= 0) {
    return { result, enteredCycle: null };
  }
  const sketch = structuredClone(intersection);
  const sketchPattern = sketch.patterns.find((p) => p.id === patternId)!;
  sketchPattern.cycle = total;
  sketchPattern.offset = Math.min(sketchPattern.offset, total - 1);
  const drawn = projectCycle(sketch, patternId);
  if (!drawn.ok) {
    return { result, enteredCycle: null };
  }
  return { result: { ...drawn, issues: [...result.issues, ...drawn.issues] }, enteredCycle: pattern.cycle };
}
