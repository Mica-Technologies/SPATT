/**
 * The intersection during a simulation: the scene with every head showing the simulated signals
 * at the playback cursor, and the simulated vehicles and pedestrians drawn over it on a canvas
 * that follows the cursor frame by frame.
 */
import { memo, useMemo, type RefObject } from 'react';
import Typography from '@mui/material/Typography';
import { buildScene, overlapStatesFrom, prepareTraffic, TICKS_PER_SECOND, type HeadStates, type OverlapStates, type ScenePedestrianSignal, type SceneVehicleSignal, type SceneView, type SimulationResult } from '../../../engine';
import type { Intersection } from '../../../model';
import IntersectionDrawing from '../../intersection/IntersectionDrawing';
import { drawingExtent } from '../../intersection/extent';
import TrafficLayer from '../../intersection/TrafficLayer';
import { useWorkspace } from '../../state/workspace';
import type { SpanIndex } from './spanIndex';

/** Shortest and longest leg drawn, metres behind the stop bar. */
const MIN_APPROACH = 20;
const MAX_APPROACH = 40;

export interface SimIntersectionProps {
  intersection: Intersection;
  result: SimulationResult;
  view: SceneView;
  /** The run's signal spans, indexed. */
  index: SpanIndex;
  /** The cursor, whole ticks (for the signals). */
  tick: number;
  /** The cursor, seconds, read every frame (for the traffic). */
  timeRef: RefObject<number>;
  reducedMotion: boolean;
}

export default memo(function SimIntersection({ intersection, result, view, index, tick, timeRef, reducedMotion }: SimIntersectionProps) {
  const lengthUnit = useWorkspace((s) => s.project?.units.length ?? 'm');
  // Legs long enough for the longest queue in a lane, within reason; longer queues are counted.
  const approachLength = useMemo(() => {
    const perLane = Math.max(0, ...result.laneGroups.map((l) => l.maxQueue / (intersection.laneGroups.find((g) => g.id === l.laneGroupId)?.lanes ?? 1)));
    return Math.min(MAX_APPROACH, Math.max(MIN_APPROACH, Math.ceil(perLane) * 7 + 6));
  }, [result, intersection.laneGroups]);
  const scene = useMemo(() => buildScene(intersection, { lengthUnit, approachLength }), [intersection, lengthUnit, approachLength]);
  const traffic = useMemo(() => prepareTraffic(result.trace, scene), [result, scene]);
  const extent = useMemo(() => drawingExtent(scene, view), [scene, view]);

  // What every head shows, as a key that changes only when a signal does, so the drawing
  // re-renders on signal changes rather than on every step of the cursor.
  const atCursor = index.at(tick);
  const phaseKey = intersection.phases
    .filter((p) => p.enabled)
    .map((p) => {
      const signals = atCursor.filter((s) => s.phase === p.number).map((s) => s.signal);
      const vehicle: SceneVehicleSignal = signals.includes('green') ? 'green' : signals.includes('yellow') ? 'yellow' : 'red';
      const pedestrian: ScenePedestrianSignal | '' = p.pedestrian.enabled ? (signals.includes('walk') ? 'walk' : signals.includes('clearance') ? 'pedestrianClearance' : 'dontWalk') : '';
      return `${p.number}:${vehicle}:${pedestrian}`;
    })
    .join(',');
  const overlapKey = [...overlapStatesFrom(result.trace.overlaps ?? [], intersection.overlaps, tick)].map(([id, s]) => `${id}:${s}`).join(',');
  const flashOn = reducedMotion || !phaseKey.includes('pedestrianClearance') || Math.floor(tick / (TICKS_PER_SECOND / 2)) % 2 === 0;
  const states: HeadStates = useMemo(() => new Map(phaseKey.split(',').filter(Boolean).map((entry) => entry.split(':')).map(([n, v, p]) => [Number(n), { vehicle: v as SceneVehicleSignal, pedestrian: p ? (p as ScenePedestrianSignal) : null }])), [phaseKey]);
  const overlaps: OverlapStates = useMemo(() => new Map(overlapKey.split(',').filter(Boolean).map((entry) => entry.split(':') as [string, SceneVehicleSignal])), [overlapKey]);
  const label = `${view === 'plan' ? 'Plan' : 'Oblique'} view of ${intersection.name} with the simulated traffic`;
  const drawing = useMemo(
    () => <IntersectionDrawing scene={scene} view={view} states={states} overlaps={overlaps} flashOn={flashOn} label={label} layer={<TrafficLayer traffic={traffic} view={view} extent={extent} timeRef={timeRef} />} />,
    [scene, view, states, overlaps, flashOn, label, traffic, extent, timeRef],
  );

  if (scene.legs.length === 0) {
    return (
      <Typography variant="body2" sx={{ color: 'text.secondary' }}>
        Give the phases directions of travel on the Phases tab to draw the intersection.
      </Typography>
    );
  }
  const until = result.trace.detailUntil;
  return (
    <>
      {drawing}
      {until !== undefined && until < result.ticks ? (
        <Typography variant="caption" sx={{ color: 'text.secondary' }}>
          Vehicles and pedestrians are drawn for the first {Math.floor(until / TICKS_PER_SECOND / 60)} min of the run, as many as the playback keeps.
        </Typography>
      ) : null}
    </>
  );
});
