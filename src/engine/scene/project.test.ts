import { describe, expect, it } from 'vitest';
import { standardEightPhase } from '../../model';
import { boxFaces, isoDepth, isoProject, paintersOrder, planProject, projectedBounds, projectorFor, sceneExtent } from './project';
import { buildScene } from './scene';

const COS30 = Math.cos(Math.PI / 6);

describe('projections', () => {
  it('projects isometrically: x′ = (x − y)·cos 30°, y′ = (x + y)·sin 30° − z', () => {
    expect(isoProject({ x: 1, y: 0, z: 0 })).toEqual({ x: COS30, y: 0.5 });
    expect(isoProject({ x: 0, y: 1, z: 0 })).toEqual({ x: -COS30, y: 0.5 });
    expect(isoProject({ x: 0, y: 0, z: 2 })).toEqual({ x: 0, y: -2 });
    expect(isoProject({ x: 2, y: 2 })).toEqual({ x: 0, y: 2 });
  });

  it('projects a plan straight down', () => {
    expect(planProject({ x: 3, y: -4, z: 9 })).toEqual({ x: 3, y: -4 });
    expect(projectorFor('plan')).toBe(planProject);
    expect(projectorFor('oblique')).toBe(isoProject);
  });

  it('paints far to near', () => {
    const items = [
      { id: 'near', p: { x: 5, y: 5 } },
      { id: 'far', p: { x: -5, y: -5 } },
      { id: 'middle-a', p: { x: 2, y: -2 } },
      { id: 'middle-b', p: { x: -2, y: 2 } },
    ];
    expect(paintersOrder(items, (i) => i.p).map((i) => i.id)).toEqual(['far', 'middle-a', 'middle-b', 'near']);
    expect(isoDepth({ x: 1, y: 2 })).toBe(3);
  });

  it('extrudes a box into its three visible faces, top last', () => {
    const faces = boxFaces({ x: 0, y: 0, z: 1 }, { x: 2, y: 2, z: 3 });
    expect(faces.map((f) => f.face)).toEqual(['east', 'south', 'top']);
    // The top is lifted by the box's base height plus its own.
    const top = faces[2]!.points;
    expect(top[0]).toEqual(isoProject({ x: -1, y: -1, z: 4 }));
    expect(faces.every((f) => f.points.length === 4)).toBe(true);
  });

  it('bounds the projected scene, including heights in the oblique view', () => {
    const bounds = { minX: -10, minY: -10, maxX: 10, maxY: 10 };
    expect(projectedBounds(bounds, 'plan', 6)).toEqual(bounds);
    const oblique = projectedBounds(bounds, 'oblique', 6);
    expect(oblique.minX).toBeCloseTo(-20 * COS30);
    expect(oblique.maxX).toBeCloseTo(20 * COS30);
    expect(oblique.minY).toBeCloseTo(-10 - 6);
    expect(oblique.maxY).toBeCloseTo(10);
  });
});

describe('sceneExtent', () => {
  it('fits the drawn scene more tightly than its rectangle in the oblique view, and takes in the poles', () => {
    const scene = buildScene(standardEightPhase());
    const plan = sceneExtent(scene, 'plan', 0);
    expect(plan.minX).toBeCloseTo(Math.min(...scene.legs.flatMap((l) => l.surface.map((p) => p.x))));
    const oblique = sceneExtent(scene, 'oblique', 0);
    const loose = projectedBounds(scene.bounds, 'oblique');
    expect(oblique.maxX - oblique.minX).toBeLessThan(loose.maxX - loose.minX);
    const poleTops = scene.poles.map((p) => isoProject({ ...p.base, z: p.height }).y);
    expect(oblique.minY).toBeLessThanOrEqual(Math.min(...poleTops));
  });
});
