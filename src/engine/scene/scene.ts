/**
 * The intersection scene: a schematic plan of the intersection in metres, inferred from the data a
 * timing plan already has. Legs come from the phases' directions of travel, lanes from the lane
 * groups (or from the phases when there are none), crosswalks from the phases with pedestrian
 * service, and signal heads from the phases that serve each approach.
 *
 * Coordinates are plan coordinates: `x` east, `y` **south** (the way a plan is drawn on screen),
 * `z` up, origin at the centre of the intersection. Everything is plain points and polylines so
 * any renderer (SVG plan, the oblique view, a later canvas layer) can draw it.
 *
 * The scene is schematic: it shows which lanes each phase serves and where its heads are, not a
 * surveyed layout. Traffic drives on the right.
 */
import { DEFAULT_LANE_WIDTH, toMetres, type Approach, type Intersection, type LaneGroup, type LengthUnit, type MovementKind, type Phase } from '../../model';

export interface ScenePoint {
  x: number;
  y: number;
}

export interface ScenePoint3 extends ScenePoint {
  z: number;
}

export type TurnMovement = 'left' | 'through' | 'right';

export interface SceneLane {
  /** Inbound lanes approach the intersection; outbound lanes leave it. */
  direction: 'inbound' | 'outbound';
  /** 0 is the lane next to the centre line. */
  index: number;
  width: number;
  /** Lateral offset of the lane's centre from the leg's centre line, positive toward the inbound side. */
  offset: number;
  /** In the direction of travel, ending at the stop bar (inbound) or the leg's end (outbound). */
  centreline: ScenePoint[];
  /** Movements the lane carries (inbound only). */
  movements: TurnMovement[];
  /** The phase whose green the lane moves on (inbound only). */
  phase: number | null;
  /** The lane's piece of the stop bar (inbound only). */
  stopBar: [ScenePoint, ScenePoint] | null;
}

export type SceneMarkingKind = 'centre' | 'lane' | 'edge';

export interface SceneMarking {
  kind: SceneMarkingKind;
  from: ScenePoint;
  to: ScenePoint;
}

export interface SceneArrow {
  /** The shaft as a polyline, from its tail to its tip. */
  shaft: ScenePoint[];
  /** The arrowhead as a closed polygon. */
  head: ScenePoint[];
}

export interface SceneLeg {
  /** The side of the intersection the leg is on (`W`: the west leg, where eastbound traffic arrives). */
  side: Approach;
  /** Unit vector from the centre out along the leg. */
  axis: ScenePoint;
  /** Unit vector across the leg toward its inbound lanes (an approaching driver's right). */
  across: ScenePoint;
  inboundWidth: number;
  /** Includes the painted median. */
  outboundWidth: number;
  /** A painted median between the centre line and the outbound lanes, as wide as the opposite approach's left-turn lanes so the through lanes line up across the intersection. */
  median: number;
  /** Distance from the centre to the edge of the conflict area, where the crosswalk begins. */
  edge: number;
  /** Distance from the centre to the stop bar. */
  stopBar: number;
  /** Distance from the centre to the end of the drawn leg. */
  end: number;
  /** The road surface from the conflict area's edge to the end of the leg. */
  surface: ScenePoint[];
  /** The painted median, when there is one. */
  medianArea: ScenePoint[] | null;
  inbound: SceneLane[];
  outbound: SceneLane[];
  markings: SceneMarking[];
  arrows: SceneArrow[];
}

export interface SceneCrosswalk {
  leg: Approach;
  /** The phases whose walk serves this crosswalk. */
  phases: number[];
  /** The crosswalk's centre line, curb to curb. */
  ends: [ScenePoint, ScenePoint];
  width: number;
  /** The painted bars, as closed polygons. */
  stripes: ScenePoint[][];
}

export interface SceneSignalHead {
  id: string;
  kind: 'vehicle' | 'pedestrian';
  /** The phases it shows (one for a vehicle head; a crosswalk may be served by several). */
  phases: number[];
  leg: Approach;
  movement: TurnMovement | 'pedestrian';
  /** The centre of the head's housing. */
  position: ScenePoint3;
  /** Unit vector the lamps face (toward the traffic or the people it signals). */
  facing: ScenePoint;
}

export interface ScenePole {
  base: ScenePoint;
  height: number;
  /** Where a mast arm reaches to, at `armHeight`; `null` for a pedestal. */
  arm: ScenePoint | null;
  armHeight: number;
  heads: string[];
}

export interface SceneBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface IntersectionScene {
  legs: SceneLeg[];
  /** The conflict area, a convex polygon. */
  box: ScenePoint[];
  /** Curb returns between neighbouring legs, as closed polygons of road surface. */
  corners: ScenePoint[][];
  crosswalks: SceneCrosswalk[];
  heads: SceneSignalHead[];
  poles: ScenePole[];
  bounds: SceneBounds;
  /** Plain-language notes on what had to be assumed, for display. */
  assumptions: string[];
  /** Enabled phases the scene could not place (no direction, or not a vehicle or pedestrian movement it knows). */
  unplacedPhases: number[];
}

export interface SceneOptions {
  /** The unit of the phases' clearance-basis lengths (the project's length unit). */
  lengthUnit?: LengthUnit;
}

const DEFAULT_THROUGH_LANES = 2;
const MIN_EDGE = 3;
const MAX_EDGE = 40;
const CROSSWALK_SETBACK = 0.6;
const CROSSWALK_WIDTH = 3;
const STOP_BAR_SETBACK = 1.2;
const APPROACH_LENGTH = 20;
const CURB_RADIUS = 5;
const MAX_FILLET_ANGLE = (135 * Math.PI) / 180;
const STRIPE_WIDTH = 0.5;
const STRIPE_GAP = 0.6;
const POLE_SETBACK = 1.5;
const VEHICLE_HEAD_HEIGHT = 5.6;
const MAST_HEIGHT = 6.6;
const PED_HEAD_HEIGHT = 2.7;
const PEDESTAL_HEIGHT = 3.3;

const S = Math.SQRT1_2;
/** Unit vectors toward each compass direction, in plan coordinates (y south). */
const COMPASS: Record<Approach, ScenePoint> = {
  N: { x: 0, y: -1 },
  NE: { x: S, y: -S },
  E: { x: 1, y: 0 },
  SE: { x: S, y: S },
  S: { x: 0, y: 1 },
  SW: { x: -S, y: S },
  W: { x: -1, y: 0 },
  NW: { x: -S, y: -S },
};
const ORDER: Approach[] = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
const turn = (direction: Approach, eighths: number): Approach => ORDER[(ORDER.indexOf(direction) + eighths + 8) % 8]!;
/** The opposite compass direction. */
export const oppositeSide = (direction: Approach): Approach => turn(direction, 4);
/** The compass direction on a traveller's right. */
export const rightOf = (direction: Approach): Approach => turn(direction, 2);

/**
 * Standard NEMA numbering, used for phases that have no direction: 2 and 6 the main-street
 * throughs (eastbound, westbound), 4 and 8 the side street (southbound, northbound), and each odd
 * phase the left turn that crosses the even phase before it in its ring.
 */
const NEMA_DIRECTION: Record<number, Approach> = { 1: 'W', 2: 'E', 3: 'N', 4: 'S', 5: 'E', 6: 'W', 7: 'S', 8: 'N' };

interface PlacedPhase {
  phase: Phase;
  /** Direction of travel. */
  direction: Approach;
  kind: TurnMovement;
  assumed: boolean;
}

const add = (a: ScenePoint, b: ScenePoint): ScenePoint => ({ x: a.x + b.x, y: a.y + b.y });
const scale = (a: ScenePoint, k: number): ScenePoint => ({ x: a.x * k, y: a.y * k });
const dot = (a: ScenePoint, b: ScenePoint): number => a.x * b.x + a.y * b.y;
const cross = (a: ScenePoint, b: ScenePoint): number => a.x * b.y - a.y * b.x;
const round = (value: number): number => Math.round(value * 1000) / 1000;
const tidy = (p: ScenePoint): ScenePoint => ({ x: round(p.x) + 0, y: round(p.y) + 0 });

/** A point on a leg: `distance` out from the centre along the axis, `offset` across it. */
function onLeg(axis: ScenePoint, across: ScenePoint, distance: number, offset: number): ScenePoint {
  return tidy(add(scale(axis, distance), scale(across, offset)));
}

/** The leg's across vector: the right of a driver heading in (against the axis). With y south, right of (dx, dy) is (−dy, dx). */
const acrossOf = (axis: ScenePoint): ScenePoint => ({ x: axis.y + 0, y: -axis.x + 0 });

function placePhase(phase: Phase): PlacedPhase | null {
  const { approach, kind } = phase.movement;
  if (kind === 'pedestrian') {
    return null;
  }
  const turnKind: TurnMovement = kind === 'left' || kind === 'right' ? kind : 'through';
  if (approach !== null) {
    return { phase, direction: approach, kind: turnKind, assumed: false };
  }
  const direction = NEMA_DIRECTION[phase.number];
  if (direction === undefined) {
    return null;
  }
  const nemaKind: MovementKind = kind === 'other' ? (phase.number % 2 === 1 ? 'left' : 'through') : kind;
  return { phase, direction, kind: nemaKind === 'left' || nemaKind === 'right' ? nemaKind : 'through', assumed: true };
}

interface LaneSpec {
  width: number;
  movements: TurnMovement[];
  phase: number;
}

const laneOrder = (g: LaneGroup): number => {
  const { left, through, right } = g.movements;
  if (left && !through && !right) return 0;
  if (left && through) return 1;
  if (through && !right) return 2;
  if (through && right) return 3;
  return right && !left ? 4 : 2;
};

function lanesFromGroups(groups: LaneGroup[]): LaneSpec[] {
  const lanes: LaneSpec[] = [];
  for (const group of [...groups].sort((a, b) => laneOrder(a) - laneOrder(b))) {
    const { left, through, right } = group.movements;
    for (let i = 0; i < group.lanes; i++) {
      const first = i === 0;
      const last = i === group.lanes - 1;
      const movements: TurnMovement[] = [];
      if (left && (first || (!through && !right))) movements.push('left');
      if (through) movements.push('through');
      if (right && (last || (!through && !left))) movements.push('right');
      if (movements.length === 0) movements.push(left ? 'left' : 'right');
      lanes.push({ width: group.laneWidth, movements, phase: group.phase });
    }
  }
  return lanes;
}

function lanesFromPhases(placed: PlacedPhase[], width: number): LaneSpec[] {
  const left = placed.find((p) => p.kind === 'left');
  const through = placed.find((p) => p.kind === 'through');
  const right = placed.find((p) => p.kind === 'right');
  const lanes: LaneSpec[] = [];
  if (left) lanes.push({ width, movements: ['left'], phase: left.phase.number });
  if (through) {
    for (let i = 0; i < DEFAULT_THROUGH_LANES; i++) {
      const movements: TurnMovement[] = [];
      if (!left && i === 0) movements.push('left');
      movements.push('through');
      if (!right && i === DEFAULT_THROUGH_LANES - 1) movements.push('right');
      lanes.push({ width, movements, phase: through.phase.number });
    }
  }
  if (right) lanes.push({ width, movements: ['right'], phase: right.phase.number });
  if (lanes.length === 0 && left === undefined && placed[0]) {
    lanes.push({ width, movements: [placed[0].kind], phase: placed[0].phase.number });
  }
  return lanes;
}

interface LegDraft {
  side: Approach;
  axis: ScenePoint;
  across: ScenePoint;
  inbound: LaneSpec[];
  outboundLanes: number;
  outboundLaneWidth: number;
  inboundWidth: number;
  outboundWidth: number;
  median: number;
  /** The widest through phase's clearance basis (metres), if any. */
  basisWidth: number | null;
  edge: number;
}

const sum = (values: number[]): number => values.reduce((total, v) => total + v, 0);

/**
 * Builds the scene for an intersection. Never throws: an intersection with no phases gives an
 * empty scene, and phases it cannot place are listed in `unplacedPhases`.
 */
export function buildScene(intersection: Intersection, options: SceneOptions = {}): IntersectionScene {
  const unit = options.lengthUnit ?? 'm';
  const metres = (value: number | undefined): number | null => (value === undefined || value <= 0 ? null : toMetres(value, unit));
  const enabled = intersection.phases.filter((p) => p.enabled);
  const assumptions: string[] = [];
  const unplacedPhases: number[] = [];

  const placed: PlacedPhase[] = [];
  for (const phase of enabled) {
    const p = placePhase(phase);
    if (p) {
      placed.push(p);
    } else if (phase.movement.kind !== 'pedestrian') {
      unplacedPhases.push(phase.number);
    }
  }
  const assumed = placed.filter((p) => p.assumed).map((p) => p.phase.number);
  if (assumed.length > 0) {
    assumptions.push(`Phase${assumed.length === 1 ? '' : 's'} ${assumed.join(', ')} ha${assumed.length === 1 ? 's' : 've'} no direction; placed by standard NEMA numbering.`);
  }

  // Lane groups belong to the leg their phase arrives on.
  const placedByNumber = new Map(placed.map((p) => [p.phase.number, p]));
  const groupsBySide = new Map<Approach, LaneGroup[]>();
  for (const group of intersection.laneGroups) {
    const p = placedByNumber.get(group.phase);
    if (!p) continue;
    const side = oppositeSide(p.direction);
    groupsBySide.set(side, [...(groupsBySide.get(side) ?? []), group]);
  }

  // Legs: every side traffic arrives from, and every side a through movement leaves on.
  const sides = new Set<Approach>();
  for (const p of placed) {
    sides.add(oppositeSide(p.direction));
    if (p.kind === 'through') sides.add(p.direction);
  }
  const inboundLaneSource = { groups: 0, phases: 0 };
  const drafts: LegDraft[] = ORDER.filter((side) => sides.has(side)).map((side) => {
    const axis = COMPASS[side];
    const arriving = placed.filter((p) => oppositeSide(p.direction) === side);
    const groups = groupsBySide.get(side) ?? [];
    const inbound = groups.length > 0 ? lanesFromGroups(groups) : lanesFromPhases(arriving, DEFAULT_LANE_WIDTH);
    if (arriving.length > 0) inboundLaneSource[groups.length > 0 ? 'groups' : 'phases']++;
    const basis = arriving
      .filter((p) => p.kind === 'through')
      .map((p) => metres(p.phase.clearanceBasis?.intersectionWidth))
      .filter((w): w is number => w !== null);
    return {
      side,
      axis,
      across: acrossOf(axis),
      inbound,
      outboundLanes: 0,
      outboundLaneWidth: DEFAULT_LANE_WIDTH,
      inboundWidth: sum(inbound.map((l) => l.width)),
      outboundWidth: 0,
      median: 0,
      basisWidth: basis.length > 0 ? Math.max(...basis) : null,
      edge: MIN_EDGE,
    };
  });
  if (inboundLaneSource.phases > 0) {
    assumptions.push(
      inboundLaneSource.groups > 0
        ? `Approaches without lane groups are drawn with ${DEFAULT_THROUGH_LANES} through lanes and one lane per turn phase.`
        : `No lane groups: each approach is drawn with ${DEFAULT_THROUGH_LANES} through lanes and one lane per turn phase.`,
    );
  }

  // Outbound lanes match the through lanes arriving from the opposite side.
  const draftBySide = new Map(drafts.map((d) => [d.side, d]));
  for (const draft of drafts) {
    const throughLanes = (lanes: LaneSpec[]) => lanes.filter((l) => l.movements.includes('through'));
    const feeding = throughLanes(draftBySide.get(oppositeSide(draft.side))?.inbound ?? []);
    const source = feeding.length > 0 ? feeding : throughLanes(draft.inbound);
    draft.outboundLanes = Math.max(1, source.length);
    draft.outboundLaneWidth = source.length > 0 ? sum(source.map((l) => l.width)) / source.length : DEFAULT_LANE_WIDTH;
    // Opposite the other approach's left-turn bay, a painted median keeps the through lanes in line.
    const opposite = draftBySide.get(oppositeSide(draft.side))?.inbound ?? [];
    draft.median = sum(opposite.filter((l) => l.movements.length === 1 && l.movements[0] === 'left').map((l) => l.width));
    draft.outboundWidth = draft.median + draft.outboundLanes * draft.outboundLaneWidth;
  }

  // Crosswalks: a phase with pedestrian service walks beside its traffic, across the leg on its
  // right (eastbound crosses the south leg); if that leg is missing, across the one on its left.
  // A pedestrian phase with no direction (an exclusive walk) crosses every leg.
  const crosswalkPhases = new Map<Approach, Set<number>>();
  const addCrossing = (side: Approach, phase: number) => {
    if (!draftBySide.has(side)) return false;
    crosswalkPhases.set(side, (crosswalkPhases.get(side) ?? new Set()).add(phase));
    return true;
  };
  const crossingBasis = new Map<Approach, number>();
  for (const phase of enabled) {
    if (!phase.pedestrian.enabled) continue;
    const p = placedByNumber.get(phase.number);
    const direction = phase.movement.kind === 'pedestrian' ? phase.movement.approach : (p?.direction ?? null);
    const sidesCrossed: Approach[] = [];
    if (direction === null) {
      if (phase.movement.kind === 'pedestrian') sidesCrossed.push(...drafts.map((d) => d.side));
    } else if (addCrossing(rightOf(direction), phase.number)) {
      sidesCrossed.push(rightOf(direction));
    } else if (addCrossing(turn(direction, -2), phase.number)) {
      sidesCrossed.push(turn(direction, -2));
    }
    for (const side of sidesCrossed) {
      addCrossing(side, phase.number);
      const distance = metres(phase.clearanceBasis?.crossingDistance);
      if (distance !== null) crossingBasis.set(side, Math.max(crossingBasis.get(side) ?? 0, distance));
    }
  }

  // Without lane groups on a leg, a known crossing distance sets its lane width.
  for (const draft of drafts) {
    const distance = crossingBasis.get(draft.side);
    if (distance === undefined || groupsBySide.has(draft.side) || groupsBySide.has(oppositeSide(draft.side))) continue;
    const lanes = draft.inbound.length + draft.outboundLanes;
    const width = Math.min(4.5, Math.max(2.75, distance / lanes));
    for (const lane of draft.inbound) lane.width = width;
    draft.outboundLaneWidth = width;
    draft.inboundWidth = width * draft.inbound.length;
    draft.outboundWidth = draft.median + width * draft.outboundLanes;
  }

  // How far each leg's conflict-area edge sits from the centre: clear of every crossing road.
  const reach = (draft: LegDraft, toward: ScenePoint): number => {
    let edge = MIN_EDGE;
    for (const other of drafts) {
      if (other === draft) continue;
      const sin = Math.abs(cross(draft.axis, other.axis));
      if (sin < 0.2) continue;
      const cos = Math.abs(dot(draft.axis, other.axis));
      const extent = dot(toward, other.across) > 0 ? other.inboundWidth : other.outboundWidth;
      const half = Math.max(draft.inboundWidth, draft.outboundWidth);
      edge = Math.max(edge, extent / sin + (half * cos) / sin);
    }
    return edge;
  };
  for (const draft of drafts) {
    draft.edge = reach(draft, draft.axis);
    if (draft.basisWidth !== null) {
      const far = reach(draft, scale(draft.axis, -1));
      draft.edge = Math.min(MAX_EDGE, Math.max(draft.edge, draft.basisWidth - far - CROSSWALK_SETBACK - CROSSWALK_WIDTH - STOP_BAR_SETBACK));
    }
  }
  if (drafts.some((d) => d.basisWidth !== null)) {
    assumptions.push('Stop bars are set back to match the intersection widths entered for clearance calculations.');
  }

  const legs = drafts.map((draft) => buildLeg(draft));
  const crosswalks: SceneCrosswalk[] = [];
  const heads: SceneSignalHead[] = [];
  const poles: ScenePole[] = [];

  for (const leg of legs) {
    const at = (distance: number, offset: number) => onLeg(leg.axis, leg.across, distance, offset);
    const armDistance = leg.edge + CROSSWALK_SETBACK + CROSSWALK_WIDTH / 2;
    const curbRight = leg.inboundWidth + POLE_SETBACK;
    const curbLeft = -leg.outboundWidth - POLE_SETBACK;

    // Vehicle heads: one per phase serving the leg's inbound lanes, over the middle of its lanes,
    // on a mast arm from the near-side right corner.
    const byPhase = new Map<number, SceneLane[]>();
    for (const lane of leg.inbound) {
      if (lane.phase !== null) byPhase.set(lane.phase, [...(byPhase.get(lane.phase) ?? []), lane]);
    }
    const vehicleHeads: SceneSignalHead[] = [...byPhase.entries()].map(([phase, lanes]) => {
      const offset = sum(lanes.map((l) => l.offset)) / lanes.length;
      const placedPhase = placedByNumber.get(phase);
      const p = at(armDistance, offset);
      return {
        id: `${leg.side}-${phase}`,
        kind: 'vehicle',
        phases: [phase],
        leg: leg.side,
        movement: placedPhase?.kind ?? 'through',
        position: { ...p, z: VEHICLE_HEAD_HEIGHT },
        facing: leg.axis,
      };
    });
    heads.push(...vehicleHeads);
    const rightPole: ScenePole = { base: at(armDistance, curbRight), height: MAST_HEIGHT, arm: null, armHeight: MAST_HEIGHT - 0.4, heads: vehicleHeads.map((h) => h.id) };
    if (vehicleHeads.length > 0) {
      const innermost = Math.min(...vehicleHeads.map((h) => dot(h.position, leg.across)));
      rightPole.arm = at(armDistance, Math.min(innermost, curbRight) - 0.8);
      poles.push(rightPole);
    }

    const phases = crosswalkPhases.get(leg.side);
    if (phases && phases.size > 0) {
      const list = [...phases].sort((a, b) => a - b);
      const a = at(armDistance, -leg.outboundWidth);
      const b = at(armDistance, leg.inboundWidth);
      crosswalks.push({ leg: leg.side, phases: list, ends: [a, b], width: CROSSWALK_WIDTH, stripes: stripes(leg, armDistance) });
      const near: SceneSignalHead = {
        id: `${leg.side}-ped-right`,
        kind: 'pedestrian',
        phases: list,
        leg: leg.side,
        movement: 'pedestrian',
        position: { ...at(armDistance, curbRight), z: PED_HEAD_HEIGHT },
        facing: scale(leg.across, -1),
      };
      const far: SceneSignalHead = { ...near, id: `${leg.side}-ped-left`, position: { ...at(armDistance, curbLeft), z: PED_HEAD_HEIGHT }, facing: leg.across };
      heads.push(near, far);
      if (vehicleHeads.length > 0) {
        rightPole.heads.push(near.id);
      } else {
        poles.push({ base: at(armDistance, curbRight), height: PEDESTAL_HEIGHT, arm: null, armHeight: 0, heads: [near.id] });
      }
      poles.push({ base: at(armDistance, curbLeft), height: PEDESTAL_HEIGHT, arm: null, armHeight: 0, heads: [far.id] });
    }
  }

  const box = convexHull([
    ...legs.flatMap((leg) => [onLeg(leg.axis, leg.across, leg.edge, leg.inboundWidth), onLeg(leg.axis, leg.across, leg.edge, -leg.outboundWidth)]),
    { x: -MIN_EDGE, y: -MIN_EDGE },
    { x: MIN_EDGE, y: -MIN_EDGE },
    { x: MIN_EDGE, y: MIN_EDGE },
    { x: -MIN_EDGE, y: MIN_EDGE },
  ]);

  const points = [...box, ...legs.flatMap((l) => l.surface), ...poles.map((p) => p.base)];
  const bounds: SceneBounds =
    points.length > 0
      ? {
          minX: Math.min(...points.map((p) => p.x)),
          minY: Math.min(...points.map((p) => p.y)),
          maxX: Math.max(...points.map((p) => p.x)),
          maxY: Math.max(...points.map((p) => p.y)),
        }
      : { minX: -10, minY: -10, maxX: 10, maxY: 10 };

  return { legs, box, corners: corners(legs), crosswalks, heads, poles, bounds, assumptions, unplacedPhases };
}

function buildLeg(draft: LegDraft): SceneLeg {
  const { axis, across, edge, side } = draft;
  const stopBar = edge + CROSSWALK_SETBACK + CROSSWALK_WIDTH + STOP_BAR_SETBACK;
  const end = stopBar + APPROACH_LENGTH;
  const at = (distance: number, offset: number) => onLeg(axis, across, distance, offset);

  let offset = 0;
  const inbound: SceneLane[] = draft.inbound.map((spec, index) => {
    const centre = offset + spec.width / 2;
    offset += spec.width;
    return {
      direction: 'inbound',
      index,
      width: spec.width,
      offset: round(centre),
      centreline: [at(end, centre), at(stopBar, centre)],
      movements: spec.movements,
      phase: spec.phase,
      stopBar: [at(stopBar, centre - spec.width / 2), at(stopBar, centre + spec.width / 2)],
    };
  });
  const outbound: SceneLane[] = Array.from({ length: draft.outboundLanes }, (_, index) => {
    const centre = -(draft.median + (index + 0.5) * draft.outboundLaneWidth);
    return { direction: 'outbound', index, width: draft.outboundLaneWidth, offset: round(centre), centreline: [at(edge, centre), at(end, centre)], movements: [], phase: null, stopBar: null };
  });

  const inboundWidth = round(draft.inboundWidth);
  const outboundWidth = round(draft.outboundWidth);
  const markings: SceneMarking[] = [];
  if (inbound.length > 0 && outbound.length > 0) {
    markings.push({ kind: 'centre', from: at(stopBar, 0), to: at(end, 0) });
    if (draft.median > 0) markings.push({ kind: 'centre', from: at(stopBar, -draft.median), to: at(end, -draft.median) });
  }
  let line = 0;
  inbound.slice(0, -1).forEach((lane) => {
    line += lane.width;
    markings.push({ kind: 'lane', from: at(stopBar, line), to: at(end, line) });
  });
  outbound.slice(0, -1).forEach((lane, i) => {
    const offset = -(draft.median + (i + 1) * lane.width);
    markings.push({ kind: 'lane', from: at(stopBar, offset), to: at(end, offset) });
  });
  markings.push({ kind: 'edge', from: at(stopBar, inboundWidth), to: at(end, inboundWidth) });
  markings.push({ kind: 'edge', from: at(stopBar, -outboundWidth), to: at(end, -outboundWidth) });

  const arrows = inbound.flatMap((lane) => lane.movements.map((movement) => laneArrow(axis, across, stopBar + 2, lane.offset, lane.width, movement)));

  return {
    side,
    axis,
    across,
    inboundWidth,
    outboundWidth,
    median: round(draft.median),
    edge: round(edge),
    stopBar: round(stopBar),
    end: round(end),
    surface: [at(edge, -outboundWidth), at(end, -outboundWidth), at(end, inboundWidth), at(edge, inboundWidth)],
    medianArea: draft.median > 0 ? [at(stopBar, 0), at(end, 0), at(end, -draft.median), at(stopBar, -draft.median)] : null,
    inbound,
    outbound,
    markings,
    arrows,
  };
}

/** A pavement arrow for one movement, its tip `tip` metres out from the centre. */
function laneArrow(axis: ScenePoint, across: ScenePoint, tip: number, offset: number, width: number, movement: TurnMovement): SceneArrow {
  const at = (distance: number, lateral: number) => onLeg(axis, across, distance, offset + lateral);
  const length = 4.5;
  const headLength = 1.2;
  const headHalf = Math.min(0.6, width * 0.2);
  if (movement === 'through') {
    return {
      shaft: [at(tip + length, 0), at(tip + headLength, 0)],
      head: [at(tip, 0), at(tip + headLength, headHalf), at(tip + headLength, -headHalf)],
    };
  }
  // A turn: up the lane, then bend toward the turn (left is toward the centre line, negative offset).
  const sign = movement === 'left' ? -1 : 1;
  const bend = tip + 1.2;
  const reach = Math.min(1.4, width * 0.4) * sign;
  const tipPoint = at(bend, reach);
  return {
    shaft: [at(tip + length, 0), at(bend + 0.6, 0), at(bend, reach - headLength * 0.8 * sign)],
    head: [tipPoint, at(bend + headHalf, reach - headLength * sign), at(bend - headHalf, reach - headLength * sign)],
  };
}

/** Continental crosswalk bars across a leg, centred `distance` out from the centre. */
function stripes(leg: SceneLeg, distance: number): ScenePoint[][] {
  const from = -leg.outboundWidth + 0.3;
  const to = leg.inboundWidth - 0.3;
  const count = Math.max(1, Math.floor((to - from + STRIPE_GAP) / (STRIPE_WIDTH + STRIPE_GAP)));
  const used = count * STRIPE_WIDTH + (count - 1) * STRIPE_GAP;
  const start = from + (to - from - used) / 2;
  const near = distance - CROSSWALK_WIDTH / 2;
  const far = distance + CROSSWALK_WIDTH / 2;
  return Array.from({ length: count }, (_, i) => {
    const a = start + i * (STRIPE_WIDTH + STRIPE_GAP);
    const b = a + STRIPE_WIDTH;
    return [onLeg(leg.axis, leg.across, near, a), onLeg(leg.axis, leg.across, far, a), onLeg(leg.axis, leg.across, far, b), onLeg(leg.axis, leg.across, near, b)];
  });
}

/** Curb returns: a curved fill between each pair of neighbouring legs less than 135° apart. */
function corners(legs: SceneLeg[]): ScenePoint[][] {
  if (legs.length < 2) return [];
  const angle = (leg: SceneLeg) => Math.atan2(leg.axis.y, leg.axis.x);
  const sorted = [...legs].sort((a, b) => angle(a) - angle(b));
  const result: ScenePoint[][] = [];
  sorted.forEach((first, i) => {
    const second = sorted[(i + 1) % sorted.length]!;
    if (second === first) return;
    let gap = angle(second) - angle(first);
    if (gap <= 0) gap += 2 * Math.PI;
    if (gap > MAX_FILLET_ANGLE) return;
    const side = (leg: SceneLeg, toward: SceneLeg) => (dot(toward.axis, leg.across) > 0 ? leg.inboundWidth : -leg.outboundWidth);
    const p1 = onLeg(first.axis, first.across, first.edge, side(first, second));
    const p2 = onLeg(second.axis, second.across, second.edge, side(second, first));
    const a = add(p1, scale(first.axis, CURB_RADIUS));
    const b = add(p2, scale(second.axis, CURB_RADIUS));
    // Cubic Bézier b → a with control points p2, p1, sampled.
    const curve: ScenePoint[] = [];
    for (let k = 1; k < 8; k++) {
      const t = k / 8;
      const u = 1 - t;
      curve.push(tidy(add(add(scale(b, u * u * u), scale(p2, 3 * u * u * t)), add(scale(p1, 3 * u * t * t), scale(a, t * t * t)))));
    }
    result.push([a, p1, p2, b, ...curve]);
  });
  return result;
}

/** Andrew's monotone chain; the hull in order, without repeating the first point. */
function convexHull(points: ScenePoint[]): ScenePoint[] {
  const sorted = [...points].sort((a, b) => a.x - b.x || a.y - b.y);
  const turnOf = (o: ScenePoint, a: ScenePoint, b: ScenePoint) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const half = (list: ScenePoint[]) => {
    const out: ScenePoint[] = [];
    for (const p of list) {
      while (out.length >= 2 && turnOf(out[out.length - 2]!, out[out.length - 1]!, p) <= 0) out.pop();
      out.push(p);
    }
    out.pop();
    return out;
  };
  return [...half(sorted), ...half([...sorted].reverse())];
}
