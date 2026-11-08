import { describe, expect, it } from 'vitest';
import { newLaneGroup, twoPhase, type Intersection } from '../../model';
import { NemaController, simulate, type PedestrianRecord, type SimulationResult, type VehicleRecord } from '../sim';
import { buildScene, type IntersectionScene } from './scene';
import { prepareTraffic, trafficAt, vehiclePositions, VEHICLE_LENGTH } from './traffic';

/** Two-phase with one eastbound through lane (lane group `eb`) and a walk beside phase 2. */
function setUp(): { intersection: Intersection; scene: IntersectionScene } {
  const intersection = twoPhase();
  const eb = intersection.phases.find((p) => p.number === 2)!;
  eb.pedestrian.enabled = true;
  intersection.laneGroups.push({ ...newLaneGroup('eb', eb), lanes: 1 });
  return { intersection, scene: buildScene(intersection) };
}

const s = (seconds: number) => seconds * 20;
const vehicle = (id: number, arrive: number, depart: number | null): VehicleRecord => ({ id, laneGroupId: 'eb', movement: 'through', arrive: s(arrive), depart: depart === null ? null : s(depart) });
const trace = (vehicles: VehicleRecord[], pedestrians: PedestrianRecord[] = []): SimulationResult['trace'] => ({ spans: [], queues: {}, vehicles, pedestrians, detailUntil: s(3600) });

describe('vehiclePositions', () => {
  const { scene } = setUp();
  const west = scene.legs.find((l) => l.side === 'W')!;
  const bar = west.inbound[0]!.centreline[1]!;
  /** Distance of a vehicle's centre behind the west stop bar (eastbound, so bar.x − x). */
  const behind = (x: number) => Math.round((bar.x - x) * 100) / 100;
  const queue = trace([vehicle(0, 100, 110), vehicle(1, 101, 112), vehicle(2, 102, 114), vehicle(3, 200, 200)]);

  it('approaches at the link speed', () => {
    const frame = vehiclePositions(queue, scene, 99);
    expect(frame.vehicles.map((v) => [v.id, behind(v.x), v.state])).toEqual([
      [0, 12 + VEHICLE_LENGTH / 2, 'moving'],
    ]);
    // Arriving at 101 and 102, 24 and 36 m out: beyond the drawn 20 m leg, so not drawn.
    expect(frame.overflow).toEqual([]);
    expect(frame.vehicles[0]!.y).toBe(bar.y);
    expect(frame.vehicles[0]!.heading).toBeCloseTo(0);
    expect(frame.vehicles[0]!.laneKey).toBe('W-0');
  });

  it('queues 7 m apart behind the stop bar while waiting', () => {
    const frame = vehiclePositions(queue, scene, 105);
    expect(frame.vehicles.map((v) => [v.id, behind(v.x), v.state])).toEqual([
      [0, 2.25, 'queued'],
      [1, 9.25, 'queued'],
      [2, 16.25, 'queued'],
    ]);
  });

  it('moves the queue up as it discharges, with no jump at the stop bar', () => {
    const at = (t: number) => vehiclePositions(queue, scene, t).vehicles.find((v) => v.id === 1)!;
    let previous = at(110).x;
    for (let t = 110.05; t <= 113; t += 0.05) {
      const x = at(t).x;
      expect(x).toBeGreaterThanOrEqual(previous - 1e-9);
      expect(x - previous).toBeLessThan(0.8);
      previous = x;
    }
    // Leaving from a stop: 1 m in the first second.
    const first = vehiclePositions(queue, scene, 111).vehicles.find((v) => v.id === 0)!;
    expect(behind(first.x)).toBeCloseTo(VEHICLE_LENGTH / 2 - 1);
  });

  it('keeps the link speed through a green it meets without stopping, along its turn path', () => {
    const frame = vehiclePositions(queue, scene, 201);
    const v = frame.vehicles.find((p) => p.id === 3)!;
    expect(behind(v.x)).toBeCloseTo(-(12 - VEHICLE_LENGTH / 2));
    expect(v.heading).toBeCloseTo(0);
    // Gone once past the end of the east leg.
    expect(vehiclePositions(queue, scene, 215).vehicles).toEqual([]);
  });

  it('follows a left turn round its curve', () => {
    const left = { ...setUp() };
    left.intersection.laneGroups[0]!.movements = { left: true, through: true, right: false };
    const sc = buildScene(left.intersection);
    const path = sc.turnPaths.find((p) => p.from === 'W' && p.movement === 'left')!;
    const tr = trace([{ ...vehicle(0, 100, 100), movement: 'left' }]);
    const late = vehiclePositions(tr, sc, 100 + path.turnLength / 12 + 0.5).vehicles[0]!;
    // Heading north (y south, so −π/2) once round the turn.
    expect(late.heading).toBeCloseTo(-Math.PI / 2, 1);
  });

  it('counts a queue longer than the drawn leg at its end, and draws it on a longer leg', () => {
    const long = trace(Array.from({ length: 10 }, (_, k) => vehicle(k, 100 + k, null)));
    const frame = vehiclePositions(long, scene, 130);
    // 20 m of leg holds three queued vehicles (centres 2.25, 9.25, 16.25 m back).
    expect(frame.vehicles).toHaveLength(3);
    expect(frame.overflow).toEqual([{ laneKey: 'W-0', count: 7, at: { x: bar.x - 20, y: bar.y }, heading: 0 }]);
    const longer = buildScene(setUp().intersection, { approachLength: 80 });
    expect(vehiclePositions(long, longer, 130).vehicles).toHaveLength(10);
  });

  it('agrees with prepare-then-frame, and leaves out vehicles it has no lane for', () => {
    const prepared = prepareTraffic(queue, scene);
    expect(trafficAt(prepared, 105)).toEqual(vehiclePositions(queue, scene, 105));
    const stray = trace([{ ...vehicle(0, 100, null), laneGroupId: 'nowhere' }]);
    expect(vehiclePositions(stray, scene, 101).vehicles).toEqual([]);
  });
});

describe('pedestrian positions', () => {
  const { scene } = setUp();
  const crossing = scene.crosswalks.find((c) => c.phases.includes(2))!;
  const [a, b] = crossing.ends;
  const length = Math.hypot(b.x - a.x, b.y - a.y);
  const tr = trace([], [{ id: 0, phase: 2, press: s(50), start: s(60), end: s(80) }]);

  it('waits at the curb from the press, walks the crosswalk on the walk, and is gone across', () => {
    expect(vehiclePositions(tr, scene, 49).pedestrians).toEqual([]);
    const waiting = vehiclePositions(tr, scene, 55).pedestrians[0]!;
    expect(waiting.state).toBe('waiting');
    expect(Math.hypot(waiting.x - a.x, waiting.y - a.y)).toBeLessThan(1.5);
    const halfway = 60 + (length / 2 + 0.6) / 1.2;
    const walking = vehiclePositions(tr, scene, halfway).pedestrians[0]!;
    expect(walking.state).toBe('crossing');
    expect(Math.hypot(walking.x - (a.x + b.x) / 2, walking.y - (a.y + b.y) / 2)).toBeLessThan(1.2);
    expect(vehiclePositions(tr, scene, 60 + (length + 2) / 1.2 + 1).pedestrians).toEqual([]);
  });
});

describe('positions from a simulation', () => {
  it('draws every queued vehicle in its lane group’s lanes, or counts it past the leg', () => {
    const { intersection } = setUp();
    intersection.laneGroups[0]!.lanes = 2;
    intersection.volumeSets.push({ id: 'am', name: 'AM', peakHourFactor: 1, volumes: { eb: { left: 0, through: 1400, right: 0 } } });
    const settings = { patternId: 'all-day', volumeSetId: 'am', durationSeconds: 900, warmUpSeconds: 0, seed: 2, pedestrianCallsPerHour: { 2: 60 }, detail: { seconds: 900, limit: 10_000 } };
    const result = simulate(intersection, settings, new NemaController(intersection, { patternId: 'all-day' }));
    const scene = buildScene(intersection);
    const prepared = prepareTraffic(result.trace, scene);
    for (let second = 100; second < 900; second += 37) {
      const frame = trafficAt(prepared, second);
      const queued = frame.vehicles.filter((v) => v.state === 'queued' && v.laneKey.startsWith('W-')).length;
      const waiting = result.trace.vehicles!.filter((v) => v.arrive <= second * 20 && (v.depart === null || v.depart > second * 20)).length;
      const counted = frame.overflow.reduce((sum, o) => sum + o.count, 0);
      // Every vehicle in the point queue is drawn queued or counted beyond the leg; vehicles
      // still rolling up to the back of the queue are drawn queued too.
      expect(queued + counted).toBeGreaterThanOrEqual(waiting);
      for (const lane of ['W-0', 'W-1']) {
        const xs = frame.vehicles
          .filter((v) => v.laneKey === lane)
          .map((v) => v.x)
          .sort((p, q) => p - q);
        for (let k = 1; k < xs.length; k++) expect(xs[k]! - xs[k - 1]!).toBeGreaterThan(VEHICLE_LENGTH);
      }
    }
  });
});
