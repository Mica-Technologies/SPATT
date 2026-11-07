/**
 * Projections from scene coordinates (metres; x east, y south, z up) to the drawing plane.
 *
 * - **Plan**: straight down, `(x, y)`; height is ignored.
 * - **Oblique**: a fixed isometric view from above the south-east corner,
 *   `x' = (x − y)·cos 30°`, `y' = (x + y)·sin 30° − z`. Larger `x + y` is nearer the viewer, so
 *   solids are painted in increasing `x + y` (painter's order).
 */
import type { SceneBounds, ScenePoint, ScenePoint3 } from './scene';

export type SceneView = 'plan' | 'oblique';

const COS30 = Math.cos(Math.PI / 6);
const SIN30 = 0.5;

const heightOf = (p: ScenePoint | ScenePoint3): number => ('z' in p ? p.z : 0);

export function planProject(p: ScenePoint | ScenePoint3): ScenePoint {
  return { x: p.x, y: p.y };
}

export function isoProject(p: ScenePoint | ScenePoint3): ScenePoint {
  return { x: (p.x - p.y) * COS30, y: (p.x + p.y) * SIN30 - heightOf(p) };
}

export const projectorFor = (view: SceneView): ((p: ScenePoint | ScenePoint3) => ScenePoint) => (view === 'plan' ? planProject : isoProject);

/** Distance toward the oblique viewer: paint smaller first. */
export const isoDepth = (p: ScenePoint | ScenePoint3): number => p.x + p.y;

/** Sorts items far to near for the oblique view (stable for equal depths). */
export function paintersOrder<T>(items: readonly T[], at: (item: T) => ScenePoint | ScenePoint3): T[] {
  return items
    .map((item, index) => ({ item, index, depth: isoDepth(at(item)) }))
    .sort((a, b) => a.depth - b.depth || a.index - b.index)
    .map((entry) => entry.item);
}

export type BoxFace = 'top' | 'east' | 'south';

export interface ProjectedFace {
  face: BoxFace;
  points: ScenePoint[];
}

/**
 * The faces of an axis-aligned box the oblique viewer can see (east, south, then top, the order
 * to paint them), projected. `base` is the centre of the box's bottom; `size` is its extent along
 * x, along y and up.
 */
export function boxFaces(base: ScenePoint3, size: { x: number; y: number; z: number }): ProjectedFace[] {
  const x0 = base.x - size.x / 2;
  const x1 = base.x + size.x / 2;
  const y0 = base.y - size.y / 2;
  const y1 = base.y + size.y / 2;
  const z0 = base.z;
  const z1 = base.z + size.z;
  const p = (x: number, y: number, z: number) => isoProject({ x, y, z });
  return [
    { face: 'east', points: [p(x1, y0, z0), p(x1, y1, z0), p(x1, y1, z1), p(x1, y0, z1)] },
    { face: 'south', points: [p(x0, y1, z0), p(x1, y1, z0), p(x1, y1, z1), p(x0, y1, z1)] },
    { face: 'top', points: [p(x0, y0, z1), p(x1, y0, z1), p(x1, y1, z1), p(x0, y1, z1)] },
  ];
}

/** The projected bounding rectangle of the scene's ground plus anything up to `height` above it. */
export function projectedBounds(bounds: SceneBounds, view: SceneView, height = 0): SceneBounds {
  const project = projectorFor(view);
  const corners = [
    { x: bounds.minX, y: bounds.minY },
    { x: bounds.maxX, y: bounds.minY },
    { x: bounds.maxX, y: bounds.maxY },
    { x: bounds.minX, y: bounds.maxY },
  ];
  const points = corners.flatMap((c) => [project({ ...c, z: 0 }), project({ ...c, z: view === 'plan' ? 0 : height })]);
  return {
    minX: Math.min(...points.map((p) => p.x)),
    minY: Math.min(...points.map((p) => p.y)),
    maxX: Math.max(...points.map((p) => p.x)),
    maxY: Math.max(...points.map((p) => p.y)),
  };
}
