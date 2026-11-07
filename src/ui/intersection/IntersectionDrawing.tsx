/**
 * Draws an intersection scene as SVG in plan or oblique (isometric) view, with every signal head
 * and stop bar coloured by its current interval. The road layer depends only on the scene and the
 * view and is memoised; only the signal layer redraws as the cycle plays.
 */
import { memo, type ReactElement } from 'react';
import Box from '@mui/material/Box';
import {
  boxFaces,
  headSignal,
  paintersOrder,
  projectorFor,
  sceneExtent,
  signalFor,
  type HeadStates,
  type IntersectionScene,
  type ProjectedFace,
  type SceneBounds,
  type SceneSignalHead,
  type ScenePoint,
  type ScenePoint3,
  type SceneView,
} from '../../engine';
import { drawingSx, LAMP, lampOf, type Lamp } from './drawingStyle';

const PAD = 3;
/** How far the oblique road slab's edge shows below its surface. */
const SLAB = 0.7;
const HEAD = { x: 1.2, y: 1.2, z: 3.2 };
const PED_HEAD = { x: 0.9, y: 0.9, z: 1.0 };
const POLE = 0.35;
const LABEL_SIZE = 2.6;

const n = (value: number) => Math.round(value * 100) / 100;
const pointsAttr = (points: ScenePoint[]) => points.map((p) => `${n(p.x)},${n(p.y)}`).join(' ');

export interface IntersectionDrawingProps {
  scene: IntersectionScene;
  view: SceneView;
  states: HeadStates | null;
  /** Whether a flashing don't-walk hand is lit at this moment. */
  flashOn: boolean;
  label: string;
}

export default function IntersectionDrawing({ scene, view, states, flashOn, label }: IntersectionDrawingProps) {
  const b = sceneExtent(scene, view, PAD);
  const viewBox = `${n(b.minX)} ${n(b.minY)} ${n(b.maxX - b.minX)} ${n(b.maxY - b.minY)}`;
  return (
    <Box component="svg" viewBox={viewBox} role="img" aria-label={label} sx={drawingSx}>
      <Ground scene={scene} view={view} extent={b} />
      <Signals scene={scene} view={view} states={states} flashOn={flashOn} />
    </Box>
  );
}

/** The ground, roads, markings and labels: everything that does not change as the cycle plays. */
const Ground = memo(function Ground({ scene, view, extent }: { scene: IntersectionScene; view: SceneView; extent: SceneBounds }) {
  const project = projectorFor(view);
  const poly = (points: ScenePoint[]) => pointsAttr(points.map(project));
  const line = (from: ScenePoint, to: ScenePoint) => {
    const a = project(from);
    const c = project(to);
    return { x1: n(a.x), y1: n(a.y), x2: n(c.x), y2: n(c.y) };
  };
  const surfaces = [scene.box, ...scene.corners, ...scene.legs.map((leg) => leg.surface)];
  return (
    <g aria-hidden="true">
      {view === 'plan' ? (
        <rect className="ground" x={n(extent.minX)} y={n(extent.minY)} width={n(extent.maxX - extent.minX)} height={n(extent.maxY - extent.minY)} rx={1.5} />
      ) : (
        // The road as a slab: its surface drawn again, lower, as the visible edge.
        <g className="road-side" transform={`translate(0 ${SLAB})`}>
          {surfaces.map((points, i) => (
            <polygon key={i} points={poly(points)} />
          ))}
        </g>
      )}
      <g className="road">
        {surfaces.map((points, i) => (
          <polygon key={i} points={poly(points)} />
        ))}
      </g>
      {scene.legs.map((leg) => (
        <g key={leg.side}>
          {leg.medianArea ? <polygon className="median" points={poly(leg.medianArea)} /> : null}
          {leg.markings.map((m, i) => (
            <line
              key={i}
              {...line(m.from, m.to)}
              className={m.kind === 'centre' ? 'centre' : 'paint-line'}
              strokeWidth={m.kind === 'centre' ? 0.25 : m.kind === 'edge' ? 0.18 : 0.15}
              strokeDasharray={m.kind === 'lane' ? '2 2.5' : undefined}
            />
          ))}
          {leg.arrows.map((arrow, i) => (
            <g key={`a${i}`}>
              <polyline className="paint-line" points={poly(arrow.shaft)} strokeWidth={0.3} strokeLinejoin="round" />
              <polygon className="paint-fill" points={poly(arrow.head)} />
            </g>
          ))}
        </g>
      ))}
      <g className="paint-fill">
        {scene.crosswalks.flatMap((c) => c.stripes.map((stripe, i) => <polygon key={`${c.leg}${i}`} points={poly(stripe)} />))}
      </g>
      <LaneLabels scene={scene} view={view} />
      <Compass view={view} extent={extent} />
    </g>
  );
});

/** Each approach's phase numbers, painted on its lanes near the end of the leg. */
function LaneLabels({ scene, view }: { scene: IntersectionScene; view: SceneView }) {
  const project = projectorFor(view);
  const labels: ReactElement[] = [];
  for (const leg of scene.legs) {
    const byPhase = new Map<number, number[]>();
    for (const lane of leg.inbound) {
      if (lane.phase !== null) byPhase.set(lane.phase, [...(byPhase.get(lane.phase) ?? []), lane.offset]);
    }
    for (const [phase, offsets] of byPhase) {
      const offset = offsets.reduce((s, o) => s + o, 0) / offsets.length;
      const distance = leg.end - 3;
      const p = project({ x: leg.axis.x * distance + leg.across.x * offset, y: leg.axis.y * distance + leg.across.y * offset });
      labels.push(
        <text key={`${leg.side}${phase}`} x={n(p.x)} y={n(p.y)} className="label-on-road" fontSize={LABEL_SIZE} fontWeight={500} textAnchor="middle" dominantBaseline="central">
          {phase}
        </text>,
      );
    }
  }
  return <g>{labels}</g>;
}

/** A north arrow in the top-right corner, pointing the way north lies in this view. */
function Compass({ view, extent }: { view: SceneView; extent: SceneBounds }) {
  const project = projectorFor(view);
  const origin = project({ x: 0, y: 0 });
  const northward = project({ x: 0, y: -1 });
  const length = Math.hypot(northward.x - origin.x, northward.y - origin.y);
  const d = { x: (northward.x - origin.x) / length, y: (northward.y - origin.y) / length };
  const side = { x: -d.y, y: d.x };
  const c = { x: extent.maxX - 3.5, y: extent.minY + 4 };
  const at = (along: number, across: number) => ({ x: c.x + d.x * along + side.x * across, y: c.y + d.y * along + side.y * across });
  return (
    <g className="compass">
      <polygon points={pointsAttr([at(2.6, 0), at(-1.6, 1.2), at(-0.8, 0), at(-1.6, -1.2)])} stroke="none" />
      <text x={n(c.x - d.x * 3.4)} y={n(c.y - d.y * 3.4)} fontSize={2} textAnchor="middle" dominantBaseline="central" stroke="none">
        N
      </text>
    </g>
  );
}

function Signals({ scene, view, states, flashOn }: { scene: IntersectionScene; view: SceneView; states: HeadStates | null; flashOn: boolean }) {
  const project = projectorFor(view);
  const lampFor = (head: SceneSignalHead): Lamp => {
    const signal = headSignal(head, states);
    if (signal === 'pedestrianClearance' && !flashOn) return 'off';
    return lampOf(signal);
  };
  const heads = new Map(scene.heads.map((h) => [h.id, h]));

  // Stop bars take the colour of the lane's signal, so the plan reads at a glance.
  const stopBars = scene.legs.flatMap((leg) =>
    leg.inbound.map((lane) => {
      if (!lane.stopBar) return null;
      const lamp = lane.phase === null ? 'off' : lampOf(signalFor(states, lane.phase).vehicle);
      const [a, c] = lane.stopBar;
      const along = (p: ScenePoint, d: number) => ({
        x: p.x + leg.axis.x * d,
        y: p.y + leg.axis.y * d,
      });
      const quad = [along(a, -0.3), along(c, -0.3), along(c, 0.3), along(a, 0.3)].map(project);
      return <polygon key={`${leg.side}${lane.index}`} points={pointsAttr(quad)} fill={lamp === 'off' ? undefined : LAMP[lamp]} className={lamp === 'off' ? 'paint-fill' : undefined} stroke="none" />;
    }),
  );

  if (view === 'plan') {
    return (
      <g aria-hidden="true">
        {stopBars}
        {scene.poles.map((pole, i) => (
          <g key={i} className="pole">
            {pole.arm ? <line x1={n(pole.base.x)} y1={n(pole.base.y)} x2={n(pole.arm.x)} y2={n(pole.arm.y)} strokeWidth={0.35} strokeLinecap="round" /> : null}
            <circle cx={n(pole.base.x)} cy={n(pole.base.y)} r={0.55} stroke="none" />
          </g>
        ))}
        {scene.heads.map((head) => (head.kind === 'vehicle' ? <PlanVehicleHead key={head.id} head={head} lamp={lampFor(head)} /> : <PlanPedHead key={head.id} head={head} lamp={lampFor(head)} />))}
      </g>
    );
  }

  // Oblique: each pole with its arm and heads, poles painted far to near.
  return (
    <g aria-hidden="true">
      {stopBars}
      {paintersOrder(scene.poles, (pole) => pole.base).map((pole, i) => {
        const mounted = pole.heads.map((id) => heads.get(id)).filter((h): h is SceneSignalHead => h !== undefined);
        const top = { ...pole.base, z: pole.height };
        return (
          <g key={i}>
            <Faces faces={boxFaces({ ...pole.base, z: 0 }, { x: POLE, y: POLE, z: pole.height })} pole />
            {pole.arm ? <ArmLine from={{ ...pole.base, z: pole.armHeight }} to={{ ...pole.arm, z: pole.armHeight }} /> : null}
            {pole.arm ? null : <Faces faces={boxFaces({ ...top, z: top.z - 0.05 }, { x: POLE * 1.4, y: POLE * 1.4, z: 0.1 })} pole />}
            {paintersOrder(mounted, (h) => h.position).map((head) => (
              <ObliqueHead key={head.id} head={head} lamp={lampFor(head)} armHeight={pole.arm ? pole.armHeight : null} />
            ))}
          </g>
        );
      })}
    </g>
  );
}

function ArmLine({ from, to }: { from: ScenePoint3; to: ScenePoint3 }) {
  const project = projectorFor('oblique');
  const a = project(from);
  const c = project(to);
  return <line className="pole" x1={n(a.x)} y1={n(a.y)} x2={n(c.x)} y2={n(c.y)} strokeWidth={0.3} strokeLinecap="round" />;
}

function Faces({ faces, pole = false }: { faces: ProjectedFace[]; pole?: boolean }) {
  return (
    <>
      {faces.map((f) => (
        <polygon key={f.face} points={pointsAttr(f.points)} className={pole ? (f.face === 'south' ? 'pole-shade' : 'pole') : `housing-${f.face}`} stroke="none" />
      ))}
    </>
  );
}

/** Lamps go on whichever face the viewer can see that is closest to the way the head faces. */
const lampFace = (head: SceneSignalHead): 'east' | 'south' => (head.facing.x > head.facing.y ? 'east' : 'south');

function ObliqueHead({ head, lamp, armHeight }: { head: SceneSignalHead; lamp: Lamp; armHeight: number | null }) {
  const project = projectorFor('oblique');
  const size = head.kind === 'vehicle' ? HEAD : PED_HEAD;
  const baseZ = armHeight !== null && head.kind === 'vehicle' ? armHeight - size.z - 0.1 : head.position.z - size.z / 2;
  const base = { x: head.position.x, y: head.position.y, z: baseZ };
  const face = lampFace(head);
  // A point on the lamp face, `h` of the way up the housing.
  const onFace = (h: number): ScenePoint => project(face === 'east' ? { x: base.x + size.x / 2, y: base.y, z: baseZ + size.z * h } : { x: base.x, y: base.y + size.y / 2, z: baseZ + size.z * h });
  const hanger = armHeight !== null && head.kind === 'vehicle' ? [project({ ...base, z: armHeight }), project({ ...base, z: baseZ + size.z })] : null;
  const lamps: { at: number; lamp: Lamp }[] =
    head.kind === 'vehicle'
      ? [
          { at: 5 / 6, lamp: lamp === 'red' ? 'red' : 'off' },
          { at: 3 / 6, lamp: lamp === 'yellow' ? 'yellow' : 'off' },
          { at: 1 / 6, lamp: lamp === 'green' ? 'green' : 'off' },
        ]
      : [{ at: 0.5, lamp }];
  return (
    <g>
      {hanger ? <line className="pole" x1={n(hanger[0]!.x)} y1={n(hanger[0]!.y)} x2={n(hanger[1]!.x)} y2={n(hanger[1]!.y)} strokeWidth={0.12} /> : null}
      <Faces faces={boxFaces(base, size)} />
      {lamps.map(({ at, lamp: l }) => {
        const c = onFace(at);
        return <circle key={at} cx={n(c.x)} cy={n(c.y)} r={head.kind === 'vehicle' ? 0.36 : 0.34} fill={LAMP[l]} />;
      })}
    </g>
  );
}

function PlanVehicleHead({ head, lamp }: { head: SceneSignalHead; lamp: Lamp }) {
  const { x, y } = head.position;
  // A turn arrow on the lamp for a turn phase: the facing vector points back at the driver, so the
  // driver's left is the facing turned clockwise (y south).
  const turn = head.movement === 'left' ? { x: head.facing.y, y: -head.facing.x } : head.movement === 'right' ? { x: -head.facing.y, y: head.facing.x } : null;
  const forward = { x: -head.facing.x, y: -head.facing.y };
  return (
    <g>
      <circle cx={n(x)} cy={n(y)} r={1.05} className="housing" strokeWidth={0.2} />
      <circle cx={n(x)} cy={n(y)} r={0.8} fill={LAMP[lamp]} />
      {turn ? <TurnGlyph x={x} y={y} turn={turn} forward={forward} lamp={lamp} /> : null}
    </g>
  );
}

function TurnGlyph({ x, y, turn, forward, lamp }: { x: number; y: number; turn: ScenePoint; forward: ScenePoint; lamp: Lamp }) {
  const at = (f: number, t: number) => ({
    x: x + forward.x * f + turn.x * t,
    y: y + forward.y * f + turn.y * t,
  });
  const stroke = lamp === 'off' || lamp === 'red' ? 'hsl(0, 0%, 100%)' : 'hsl(220, 35%, 8%)';
  return (
    <g fill="none" stroke={stroke} strokeWidth={0.18} strokeLinecap="round" strokeLinejoin="round">
      <polyline points={pointsAttr([at(0, -0.45), at(0, 0.45)])} />
      <polyline points={pointsAttr([at(-0.28, 0.17), at(0, 0.45), at(0.28, 0.17)])} />
    </g>
  );
}

function PlanPedHead({ head, lamp }: { head: SceneSignalHead; lamp: Lamp }) {
  const { x, y } = head.position;
  return (
    <g>
      <rect x={n(x - 0.75)} y={n(y - 0.75)} width={1.5} height={1.5} rx={0.25} className="housing" strokeWidth={0.18} />
      <rect x={n(x - 0.5)} y={n(y - 0.5)} width={1} height={1} rx={0.15} fill={LAMP[lamp]} />
    </g>
  );
}
