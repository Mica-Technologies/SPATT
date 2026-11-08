/**
 * Where the simulator's vehicles and pedestrians are at a moment, for drawing them on the scene.
 *
 * The simulator's queues are point queues: a vehicle "arrives" at the stop bar and later departs
 * from it. Here each vehicle gets a place in one of its lane group's lanes (a lane carrying its
 * movement) and moves along a route: up the inbound lane at the link speed, stopping a car length
 * and a gap behind the vehicle ahead or at the stop bar, and from its departure along its turn
 * path, accelerating up to the link speed, until it leaves the end of the outbound leg. A vehicle
 * queued beyond the drawn leg is counted at the leg's end instead (queue spillback).
 *
 * Pedestrians wait at the curb from their press and walk the crosswalk at walking speed from the
 * start of the walk that served them.
 *
 * Distances are metres and times seconds; the trace is in simulator ticks.
 */
import { TICKS_PER_SECOND, type PedestrianRecord, type SimulationResult, type VehicleRecord } from '../sim';
import type { IntersectionScene, SceneLane, SceneLeg, ScenePoint, SceneTurnPath } from './scene';

export interface TrafficOptions {
  /** Link speed, m/s (default 12, about 43 km/h). */
  speed?: number;
  /** Front-to-front spacing of queued vehicles, m (default 7). */
  spacing?: number;
  /** Acceleration from a stop, m/s² (default 2). */
  acceleration?: number;
  /** Walking speed, m/s (default 1.2). */
  walkingSpeed?: number;
}

/** A vehicle's centre and heading (radians in plan coordinates, `atan2(dy, dx)`). */
export interface VehiclePosition {
  id: number;
  x: number;
  y: number;
  heading: number;
  /** The inbound lane it uses, `<leg>-<index>`. */
  laneKey: string;
  /** `queued`: stopped or creeping up behind the stop bar; `moving`: approaching freely or departed. */
  state: 'moving' | 'queued';
}

export interface PedestrianPosition {
  id: number;
  x: number;
  y: number;
  heading: number;
  state: 'waiting' | 'crossing';
}

/** Vehicles queued beyond the end of the drawn leg, counted at the lane's end. */
export interface QueueOverflow {
  laneKey: string;
  count: number;
  /** The lane's end, where the count goes. */
  at: ScenePoint;
  heading: number;
}

export interface TrafficFrame {
  vehicles: VehiclePosition[];
  pedestrians: PedestrianPosition[];
  overflow: QueueOverflow[];
}

export const VEHICLE_LENGTH = 4.5;
export const VEHICLE_WIDTH = 1.9;

interface Route {
  key: string;
  leg: SceneLeg;
  lane: SceneLane;
  /** The stop bar point of the lane. */
  bar: ScenePoint;
  /** Drawn length of the lane behind the stop bar. */
  approach: number;
  paths: Partial<Record<VehicleRecord['movement'], { path: SceneTurnPath; cumulative: number[] }>>;
}

interface Placed {
  id: number;
  movement: VehicleRecord['movement'];
  arrive: number;
  depart: number | null;
  /** Speed at departure. */
  u0: number;
}

interface LaneTraffic {
  route: Route;
  /** In arrival order, which is also departure order. */
  vehicles: Placed[];
}

export interface PreparedTraffic {
  lanes: LaneTraffic[];
  pedestrians: { record: PedestrianRecord; from: ScenePoint; to: ScenePoint; length: number; side: number }[];
  options: Required<TrafficOptions>;
}

/** Longest a queue takes to move up one place, seconds. */
const MOVE_UP = 2.5;
/** Closest a moving vehicle follows the one ahead, front to front, metres. */
const MOVING_GAP = VEHICLE_LENGTH + 0.3;
/** A heading from a direction (`+ 0` turns −0 into 0). */
const angle = (dy: number, dx: number): number => Math.atan2(dy, dx) + 0;
const DEFAULTS: Required<TrafficOptions> = { speed: 12, spacing: 7, acceleration: 2, walkingSpeed: 1.2 };

/** Distance covered `tau` seconds after leaving at speed `u0`, accelerating to `v`. */
function travelled(tau: number, u0: number, v: number, a: number): number {
  if (tau <= 0) return 0;
  const toSpeed = Math.max(0, (v - u0) / a);
  if (tau <= toSpeed) return u0 * tau + 0.5 * a * tau * tau;
  return u0 * toSpeed + 0.5 * a * toSpeed * toSpeed + v * (tau - toSpeed);
}

/**
 * Indexes a trace on a scene: each vehicle's lane, and where it was when it left the stop bar.
 * Do this once per trace and scene, then call `trafficAt` per frame.
 */
export function prepareTraffic(trace: SimulationResult['trace'], scene: IntersectionScene, options: TrafficOptions = {}): PreparedTraffic {
  const o = { ...DEFAULTS, ...options };
  const routes = new Map<string, Route[]>();
  for (const leg of scene.legs) {
    const bar = (lane: SceneLane) => lane.centreline[lane.centreline.length - 1]!;
    for (const lane of leg.inbound) {
      if (lane.laneGroupId === null) continue;
      const paths: Route['paths'] = {};
      for (const path of scene.turnPaths) {
        if (path.from !== leg.side || path.laneIndex !== lane.index) continue;
        const cumulative = [0];
        for (let k = 1; k < path.points.length; k++) cumulative.push(cumulative[k - 1]! + Math.hypot(path.points[k]!.x - path.points[k - 1]!.x, path.points[k]!.y - path.points[k - 1]!.y));
        paths[path.movement] = { path, cumulative };
      }
      const route: Route = { key: `${leg.side}-${lane.index}`, leg, lane, bar: bar(lane), approach: leg.end - leg.stopBar, paths };
      routes.set(lane.laneGroupId, [...(routes.get(lane.laneGroupId) ?? []), route]);
    }
  }

  const byRoute = new Map<Route, Placed[]>();
  for (const v of trace.vehicles ?? []) {
    const candidates = (routes.get(v.laneGroupId) ?? []).filter((r) => r.lane.movements.includes(v.movement));
    const route = candidates.length > 0 ? candidates[v.id % candidates.length]! : (routes.get(v.laneGroupId)?.[0] ?? null);
    if (!route) continue;
    const list = byRoute.get(route) ?? [];
    list.push({ id: v.id, movement: v.movement, arrive: v.arrive / TICKS_PER_SECOND, depart: v.depart === null ? null : v.depart / TICKS_PER_SECOND, u0: 0 });
    byRoute.set(route, list);
  }

  const lanes: LaneTraffic[] = [];
  for (const [route, vehicles] of byRoute) {
    vehicles.sort((a, b) => a.arrive - b.arrive || a.id - b.id);
    // Speed crossing the stop bar: the link speed for a vehicle that meets a green without
    // stopping, the move-up speed in a discharging queue, else from a stop.
    vehicles.forEach((v, k) => {
      if (v.depart === null) return;
      const previous = k > 0 ? vehicles[k - 1]!.depart : null;
      const headway = previous === null ? Number.POSITIVE_INFINITY : v.depart - previous;
      if (v.depart - v.arrive < 0.25 && headway > MOVE_UP) v.u0 = o.speed;
      else if (headway <= MOVE_UP) v.u0 = Math.min(o.speed, o.spacing / Math.max(0.5, headway));
      else v.u0 = 0;
    });
    lanes.push({ route, vehicles });
  }

  const pedestrians: PreparedTraffic['pedestrians'] = [];
  for (const record of trace.pedestrians ?? []) {
    const crossings = scene.crosswalks.filter((c) => c.phases.includes(record.phase));
    if (crossings.length === 0) continue;
    const crossing = crossings[record.id % crossings.length]!;
    const reverse = Math.floor(record.id / crossings.length) % 2 === 1;
    const [a, b] = reverse ? [crossing.ends[1], crossing.ends[0]] : crossing.ends;
    pedestrians.push({ record, from: a, to: b, length: Math.hypot(b.x - a.x, b.y - a.y), side: reverse ? -1 : 1 });
  }
  return { lanes, pedestrians, options: o };
}

function onRoute(route: Route, movement: VehicleRecord['movement'], r: number): { point: ScenePoint; heading: number } | null {
  const { leg, bar } = route;
  if (r <= 0) {
    return { point: { x: bar.x + leg.axis.x * -r, y: bar.y + leg.axis.y * -r }, heading: angle(-leg.axis.y, -leg.axis.x) };
  }
  const entry = route.paths[movement];
  if (!entry) return null;
  const { path, cumulative } = entry;
  const total = cumulative[cumulative.length - 1]!;
  if (r >= total) return null;
  let k = 1;
  while (k < cumulative.length - 1 && cumulative[k]! < r) k++;
  const a = path.points[k - 1]!;
  const b = path.points[k]!;
  const segment = cumulative[k]! - cumulative[k - 1]!;
  const f = segment > 0 ? (r - cumulative[k - 1]!) / segment : 0;
  return { point: { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f }, heading: angle(b.y - a.y, b.x - a.x) };
}

/** First index whose vehicle had not departed by `t` (vehicles depart in order, `null` last). */
function firstDepartingAfter(vehicles: Placed[], t: number): number {
  let lo = 0;
  let hi = vehicles.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    const d = vehicles[mid]!.depart;
    if (d !== null && d <= t) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** Everything's position at `t` seconds from the start of the run. */
export function trafficAt(prepared: PreparedTraffic, t: number): TrafficFrame {
  const o = prepared.options;
  const vehicles: VehiclePosition[] = [];
  const overflow: QueueOverflow[] = [];
  for (const { route, vehicles: list } of prepared.lanes) {
    const longest = Math.max(0, ...Object.values(route.paths).map((p) => p!.cumulative[p!.cumulative.length - 1]!));
    // Time to clear the longest path from a standstill, generously.
    const horizon = Math.sqrt((2 * longest) / o.acceleration) + longest / o.speed + 2;
    const push = (v: Placed, r: number, state: VehiclePosition['state']) => {
      // The vehicle's centre is half a length behind its front bumper.
      const at = onRoute(route, v.movement, r - VEHICLE_LENGTH / 2);
      if (at) vehicles.push({ id: v.id, x: at.point.x, y: at.point.y, heading: at.heading, laneKey: route.key, state });
    };
    const head = firstDepartingAfter(list, t);
    let beyond = 0;
    let ahead = Number.POSITIVE_INFINITY; // route position of the front bumper of the vehicle ahead
    // Departed vehicles still on their paths, never closer than a car length and a little to the one ahead.
    for (let k = firstDepartingAfter(list, t - horizon); k < head; k++) {
      const v = list[k]!;
      const r = Math.min(travelled(t - v.depart!, v.u0, o.speed, o.acceleration), ahead - MOVING_GAP);
      ahead = r;
      push(v, r, 'moving');
    }
    // The queue moves up one place between departures (taking at most MOVE_UP seconds), so its
    // head reaches the stop bar as it departs.
    const last = head > 0 ? list[head - 1]!.depart! : null;
    const next = list[head]?.depart ?? null;
    const step = last === null ? MOVE_UP : Math.min(MOVE_UP, Math.max(0.5, (next ?? Number.POSITIVE_INFINITY) - last));
    const moving = last === null ? 0 : Math.min(1, Math.max(0, 1 - (t - last) / step));
    let behind: number | null = null; // distance of the vehicle ahead's front bumper behind the stop bar
    for (let k = head; k < list.length; k++) {
      const v = list[k]!;
      const free = o.speed * (v.arrive - t);
      const queued = behind === null ? Math.max(o.spacing * moving, MOVING_GAP - ahead) : behind + o.spacing;
      const d = Math.max(0, free, queued);
      if (d + VEHICLE_LENGTH / 2 > route.approach) {
        // Beyond the drawn leg, and so is everything after it: count those already in the queue.
        for (let j = k; j < list.length && list[j]!.arrive <= t; j++) beyond++;
        break;
      }
      behind = d;
      push(v, -d, d > free + 0.01 || t >= v.arrive ? 'queued' : 'moving');
    }
    if (beyond > 0) {
      const end = { x: route.bar.x + route.leg.axis.x * route.approach, y: route.bar.y + route.leg.axis.y * route.approach };
      overflow.push({ laneKey: route.key, count: beyond, at: end, heading: angle(-route.leg.axis.y, -route.leg.axis.x) });
    }
  }

  const pedestrians: PedestrianPosition[] = [];
  for (const p of prepared.pedestrians) {
    const press = p.record.press / TICKS_PER_SECOND;
    if (t < press) continue;
    const dx = (p.to.x - p.from.x) / (p.length || 1);
    const dy = (p.to.y - p.from.y) / (p.length || 1);
    // Side by side: each direction keeps to its own half of the crosswalk, spread a little by id.
    const lateral = p.side * (0.5 + (p.record.id % 3) * 0.3);
    const nx = -dy * lateral;
    const ny = dx * lateral;
    const start = p.record.start === null ? null : p.record.start / TICKS_PER_SECOND;
    if (start === null || t < start) {
      // Off to the side of the pushbutton pole while waiting.
      const aside = p.side * (1 + (p.record.id % 3) * 0.3);
      pedestrians.push({ id: p.record.id, x: p.from.x - dx * 0.6 - dy * aside, y: p.from.y - dy * 0.6 + dx * aside, heading: angle(dy, dx), state: 'waiting' });
      continue;
    }
    const walked = (t - start) * o.walkingSpeed - 0.6;
    if (walked > p.length + 0.6) continue;
    pedestrians.push({ id: p.record.id, x: p.from.x + dx * walked + nx, y: p.from.y + dy * walked + ny, heading: angle(dy, dx), state: 'crossing' });
  }
  return { vehicles, pedestrians, overflow };
}

/** Positions at `tSeconds`, preparing the trace each call; use `prepareTraffic` and `trafficAt` per frame instead. */
export function vehiclePositions(trace: SimulationResult['trace'], scene: IntersectionScene, tSeconds: number, options: TrafficOptions = {}): TrafficFrame {
  return trafficAt(prepareTraffic(trace, scene, options), tSeconds);
}
