/** The intersection drawing's extent, shared by the SVG drawing and the traffic canvas over it. */
import { sceneExtent, type IntersectionScene, type SceneBounds, type SceneView } from '../../engine';

/** Margin round the scene, metres. */
const PAD = 3;

/** The drawing's extent in projected metres: what its viewBox shows. */
export const drawingExtent = (scene: IntersectionScene, view: SceneView): SceneBounds => sceneExtent(scene, view, PAD);
