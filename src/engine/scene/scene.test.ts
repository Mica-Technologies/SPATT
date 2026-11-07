import { describe, expect, it } from 'vitest';
import { csmDefault, DEFAULT_LANE_WIDTH, makePhase, splitPhaseSideStreet, standardEightPhase, twoPhase, type Intersection, type LaneGroup } from '../../model';
import { buildScene, oppositeSide, rightOf, type IntersectionScene, type SceneLeg } from './scene';

const leg = (scene: IntersectionScene, side: string): SceneLeg => {
  const found = scene.legs.find((l) => l.side === side);
  if (!found) throw new Error(`no ${side} leg`);
  return found;
};

const laneGroup = (id: string, phase: number, lanes: number, movements: LaneGroup['movements'], laneWidth = 3.3): LaneGroup => ({
  id,
  label: id,
  phase,
  movements,
  lanes,
  laneWidth,
  heavyVehiclesPercent: 2,
  gradePercent: 0,
  saturationFlow: null,
});

describe('compass helpers', () => {
  it('turns directions', () => {
    expect(oppositeSide('E')).toBe('W');
    expect(oppositeSide('NE')).toBe('SW');
    expect(rightOf('E')).toBe('S');
    expect(rightOf('N')).toBe('E');
    expect(rightOf('NW')).toBe('NE');
  });
});

describe('buildScene — standard eight-phase', () => {
  const scene = buildScene(standardEightPhase());

  it('has a leg on each side traffic arrives from', () => {
    expect(scene.legs.map((l) => l.side)).toEqual(['N', 'E', 'S', 'W']);
    expect(leg(scene, 'W').axis).toEqual({ x: -1, y: 0 });
    // An eastbound driver arriving on the west leg has the south side on the right.
    expect(leg(scene, 'W').across).toEqual({ x: 0, y: 1 });
    expect(scene.unplacedPhases).toEqual([]);
  });

  it('infers a left-turn lane and two through lanes per approach when there are no lane groups', () => {
    const west = leg(scene, 'W');
    expect(west.inbound.map((l) => [l.phase, l.movements])).toEqual([
      [5, ['left']],
      [2, ['through']],
      [2, ['through', 'right']],
    ]);
    expect(west.inboundWidth).toBeCloseTo(3 * DEFAULT_LANE_WIDTH);
    // Outbound lanes match the through lanes arriving from the east.
    expect(west.outbound).toHaveLength(2);
    expect(west.outboundWidth).toBeCloseTo(2 * DEFAULT_LANE_WIDTH);
    expect(scene.assumptions.join(' ')).toMatch(/No lane groups/);
  });

  it('keeps the conflict area clear of the crossing road and puts the stop bar behind the crosswalk', () => {
    const north = leg(scene, 'N');
    // The east leg's inbound (westbound) lanes are the crossing road's north half: 3 lanes.
    expect(north.edge).toBeCloseTo(3 * DEFAULT_LANE_WIDTH);
    expect(north.stopBar).toBeGreaterThan(north.edge + 3);
    expect(north.end).toBeGreaterThan(north.stopBar);
    // Lane centrelines run toward the intersection and end at the stop bar.
    const lane = north.inbound[0]!;
    expect(lane.centreline.at(-1)!.y).toBeCloseTo(-north.stopBar);
    expect(lane.centreline[0]!.y).toBeLessThan(lane.centreline.at(-1)!.y);
  });

  it('places one vehicle head per phase over its lanes, facing the approaching traffic', () => {
    const vehicle = scene.heads.filter((h) => h.kind === 'vehicle');
    expect(vehicle.map((h) => h.phases[0]!).sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    const eb = vehicle.find((h) => h.phases[0] === 2)!;
    expect(eb.leg).toBe('W');
    expect(eb.movement).toBe('through');
    expect(eb.facing).toEqual({ x: -1, y: 0 });
    expect(eb.position.x).toBeLessThan(0);
    expect(eb.position.z).toBeGreaterThan(4);
    const ebLeft = vehicle.find((h) => h.phases[0] === 5)!;
    expect(ebLeft.movement).toBe('left');
    // The left-turn head is over the lane next to the centre line, north of the through head.
    expect(ebLeft.position.y).toBeLessThan(eb.position.y);
  });

  it('crosses the leg on the right of each pedestrian phase, with a head at each end', () => {
    expect(scene.crosswalks.map((c) => [c.leg, c.phases])).toEqual([
      ['N', [6]],
      ['E', [8]],
      ['S', [2]],
      ['W', [4]],
    ]);
    const south = scene.crosswalks.find((c) => c.leg === 'S')!;
    expect(south.stripes.length).toBeGreaterThan(10);
    const ped = scene.heads.filter((h) => h.kind === 'pedestrian' && h.leg === 'S');
    expect(ped).toHaveLength(2);
    expect(ped.every((h) => h.phases[0] === 2)).toBe(true);
    expect(ped[0]!.facing).toEqual({ x: -ped[1]!.facing.x, y: -ped[1]!.facing.y });
  });

  it('mounts heads on poles and curbs every corner', () => {
    const headIds = new Set(scene.heads.map((h) => h.id));
    const mounted = scene.poles.flatMap((p) => p.heads);
    expect(new Set(mounted)).toEqual(headIds);
    expect(scene.poles.filter((p) => p.arm !== null)).toHaveLength(4);
    expect(scene.corners).toHaveLength(4);
    expect(scene.box.length).toBeGreaterThanOrEqual(4);
  });

  it('bounds the drawing', () => {
    for (const l of scene.legs) {
      for (const p of l.surface) {
        expect(p.x).toBeGreaterThanOrEqual(scene.bounds.minX);
        expect(p.x).toBeLessThanOrEqual(scene.bounds.maxX);
        expect(p.y).toBeGreaterThanOrEqual(scene.bounds.minY);
        expect(p.y).toBeLessThanOrEqual(scene.bounds.maxY);
      }
    }
  });
});

describe('buildScene — inference', () => {
  it('builds lanes from lane groups, lefts nearest the centre line and rights at the curb', () => {
    const x = twoPhase();
    x.laneGroups = [laneGroup('eb-right', 2, 1, { left: false, through: false, right: true }, 3.0), laneGroup('eb', 2, 2, { left: true, through: true, right: false })];
    const west = leg(buildScene(x), 'W');
    expect(west.inbound.map((l) => [l.movements, l.width])).toEqual([
      [['left', 'through'], 3.3],
      [['through'], 3.3],
      [['right'], 3.0],
    ]);
    expect(west.inboundWidth).toBeCloseTo(9.6);
  });

  it('places phases with no direction by standard NEMA numbering, and says so', () => {
    const scene = buildScene(csmDefault());
    expect(scene.legs.map((l) => l.side)).toEqual(['N', 'E', 'S', 'W']);
    expect(scene.heads.find((h) => h.phases[0] === 2 && h.kind === 'vehicle')!.leg).toBe('W');
    expect(scene.assumptions[0]).toMatch(/standard NEMA numbering/);
  });

  it('lists phases it cannot place', () => {
    const x = twoPhase();
    x.phases.push(makePhase(9, { label: 'Extra', approach: null, kind: 'through', minGreen: 50, maxGreen1: 200, yellow: 30, redClear: 10 }));
    expect(buildScene(x).unplacedPhases).toEqual([9]);
  });

  it('draws a T: no south leg, the main-street crosswalks move to the north leg', () => {
    const x = twoPhase();
    x.phases = x.phases.filter((p) => p.number !== 8);
    x.phases.find((p) => p.number === 4)!.movement.kind = 'left';
    x.laneGroups = [laneGroup('sb', 4, 1, { left: true, through: false, right: true })];
    const scene = buildScene(x);
    expect(scene.legs.map((l) => l.side)).toEqual(['N', 'E', 'W']);
    expect(leg(scene, 'N').inbound.map((l) => l.movements)).toEqual([['left', 'right']]);
    expect(scene.crosswalks.map((c) => [c.leg, c.phases])).toEqual([
      ['N', [2, 6]],
      ['W', [4]],
    ]);
    // Corners N–E and W–N; the straight south side has no curb return.
    expect(scene.corners).toHaveLength(2);
  });

  it('draws split phasing like any other: one head per phase on each approach', () => {
    const scene = buildScene(splitPhaseSideStreet());
    expect(scene.legs.map((l) => l.side)).toEqual(['N', 'E', 'S', 'W']);
    expect(scene.heads.filter((h) => h.kind === 'vehicle' && h.leg === 'N').map((h) => h.phases)).toEqual([[4]]);
  });

  it('sets the stop bar back to the intersection width entered for clearances, in project units', () => {
    const plain = leg(buildScene(twoPhase()), 'W').stopBar;
    const x = twoPhase();
    x.phases.find((p) => p.number === 2)!.clearanceBasis = { intersectionWidth: 120 };
    const inFeet = leg(buildScene(x, { lengthUnit: 'ft' }), 'W');
    const inMetres = leg(buildScene(x, { lengthUnit: 'm' }), 'W');
    expect(inFeet.stopBar).toBeGreaterThan(plain);
    expect(inMetres.stopBar).toBeGreaterThan(inFeet.stopBar);
    // Stop bar to the far side of the crossing road is the 120 ft entered.
    const far = Math.max(...buildScene(x, { lengthUnit: 'ft' }).box.map((p) => p.x));
    expect(inFeet.stopBar + far).toBeCloseTo(120 * 0.3048, 1);
  });

  it('takes lane widths from a crossing distance when the leg has no lane groups', () => {
    const x = twoPhase();
    // Phase 2 (eastbound) walks across the south leg: 2 lanes in, 2 out.
    x.phases.find((p) => p.number === 2)!.clearanceBasis = { crossingDistance: 12 };
    const south = leg(buildScene(x, { lengthUnit: 'm' }), 'S');
    expect(south.inbound.map((l) => l.width)).toEqual([3, 3]);
    expect(south.outboundWidth).toBeCloseTo(6);
  });

  it('handles diagonal approaches', () => {
    const x = twoPhase();
    x.phases.find((p) => p.number === 2)!.movement.approach = 'NE';
    x.phases.find((p) => p.number === 6)!.movement.approach = 'SW';
    const scene = buildScene(x);
    const sw = leg(scene, 'SW');
    expect(sw.axis.x).toBeCloseTo(-Math.SQRT1_2);
    expect(sw.axis.y).toBeCloseTo(Math.SQRT1_2);
    expect(scene.legs.map((l) => l.side)).toEqual(['N', 'NE', 'S', 'SW']);
  });

  it('gives an empty scene for an intersection with no phases', () => {
    const empty: Intersection = { ...twoPhase(), phases: [], laneGroups: [] };
    const scene = buildScene(empty);
    expect(scene.legs).toEqual([]);
    expect(scene.heads).toEqual([]);
    expect(scene.box.length).toBeGreaterThan(0);
  });

  it('leaves disabled phases out', () => {
    const x = standardEightPhase();
    x.phases.find((p) => p.number === 5)!.enabled = false;
    const west = leg(buildScene(x), 'W');
    expect(west.inbound.map((l) => l.movements)).toEqual([['left', 'through'], ['through', 'right']]);
  });
});
