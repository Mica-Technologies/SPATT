import { describe, expect, it } from 'vitest';
import { newLaneGroup, standardEightPhase, twoPhase, validateIntersection, type Intersection } from '../model';
import { analyzePattern, criticalAnalysis, levelOfService, saturationFlow, suggestedPattern, suggestTiming } from './capacity';

/**
 * The two-phase template (70 s, splits 40/30, 6 s of yellow + red per phase) with an AM count:
 * EB (2) and WB (6) two through lanes, 1000 and 800 veh/h; SB (4) one lane, 400; NB (8) one shared
 * through-right lane, 250 through + 50 right. Base conditions otherwise, PHF 1.
 *
 * Worked by hand from the HCM 2000 formulas:
 * - s(EB, WB) = 1900 × 2 × fLU 0.952 = 3617.6; s(SB) = 1900; s(NB) = 1900 × (1 − 0.15 × 50/300) = 1852.5
 * - y: EB 0.27643, WB 0.22114, SB 0.21053, NB 0.16194 → Y = 0.27643 + 0.21053 = 0.48695
 * - L = 12 s → Webster C₀ = (1.5 × 12 + 5) / (1 − Y) = 44.83 s → 45 s
 * - At 70 s, EB: g = 34 s, c = 3617.6 × 34 / 70 = 1757.1, X = 0.5691,
 *   d1 = 0.5 × 70 × (1 − 34/70)² / (1 − 0.5691 × 34/70) = 12.794, d2 = 1.344 → 14.14 s/veh (B)
 * - SB: g = 24 s, c = 651.43, X = 0.6140, d1 = 19.145, d2 = 4.290 → 23.43 s/veh (C)
 * - Intersection: (14.137 × 1000 + 12.739 × 800 + 23.435 × 400 + 20.545 × 300) / 2500 = 15.95 s/veh (B)
 * - Xc = Y × 70 / (70 − 12) = 0.5877
 */
function counted(): Intersection {
  const i = twoPhase();
  const phase = (n: number) => i.phases.find((p) => p.number === n)!;
  i.laneGroups.push(
    { ...newLaneGroup('eb', phase(2)), lanes: 2, heavyVehiclesPercent: 0 },
    { ...newLaneGroup('sb', phase(4)), heavyVehiclesPercent: 0 },
    { ...newLaneGroup('wb', phase(6)), lanes: 2, heavyVehiclesPercent: 0 },
    { ...newLaneGroup('nb', phase(8)), movements: { left: false, through: true, right: true }, heavyVehiclesPercent: 0 },
  );
  i.volumeSets.push({
    id: 'am',
    name: 'AM',
    peakHourFactor: 1,
    volumes: {
      eb: { left: 0, through: 1000, right: 0 },
      sb: { left: 0, through: 400, right: 0 },
      wb: { left: 0, through: 800, right: 0 },
      nb: { left: 0, through: 250, right: 50 },
    },
  });
  i.patterns[0]!.volumeSetId = 'am';
  return i;
}

describe('saturationFlow', () => {
  it('applies the base-condition factors', () => {
    const i = counted();
    const [eb, , , nb] = i.laneGroups;
    expect(saturationFlow(i, eb!, i.volumeSets[0]!.volumes['eb']).value).toBeCloseTo(3617.6, 6);
    expect(saturationFlow(i, nb!, i.volumeSets[0]!.volumes['nb']).value).toBeCloseTo(1852.5, 6);
  });

  it('applies lane width, heavy vehicles, grade and area type', () => {
    // 1900 × (1 + (3.3 − 3.6)/9) × 100/110 × (1 − 4/200) × 0.9 = 1472.67
    const i = counted();
    i.capacity.centralBusinessDistrict = true;
    const group = { ...i.laneGroups[1]!, laneWidth: 3.3, heavyVehiclesPercent: 10, gradePercent: 4 };
    const result = saturationFlow(i, group, undefined);
    expect(result.value).toBeCloseTo(1472.6727, 3);
    expect(result.factors).toMatchObject({ areaType: 0.9, grade: 0.98, laneUtilization: 1, leftTurn: 1, rightTurn: 1 });
  });

  it('uses exclusive-lane turn factors, flags permitted lefts, and honours an override', () => {
    const i = standardEightPhase();
    const phase = (n: number) => i.phases.find((p) => p.number === n)!;
    const bay = { ...newLaneGroup('l', phase(1)), lanes: 2 };
    expect(saturationFlow(i, bay, undefined)).toMatchObject({ permittedLefts: false, factors: { leftTurn: 0.95, laneUtilization: 0.971 } });
    const shared = { ...newLaneGroup('t', phase(2)), movements: { left: true, through: true, right: false }, saturationFlow: 1500 };
    const result = saturationFlow(i, shared, { left: 100, through: 400, right: 0 });
    expect(result.factors.leftTurn).toBeCloseTo(1 / 1.01, 10);
    expect(result).toMatchObject({ permittedLefts: true, overridden: true, value: 1500 });
  });
});

describe('criticalAnalysis', () => {
  it('sums the critical ring per barrier group and finds the Webster cycle', () => {
    const i = counted();
    const result = criticalAnalysis(i, i.volumeSets[0]!);
    expect(result.groups.map((g) => [g.group, g.ring, g.phases, g.lostTime])).toEqual([
      [0, 0, [2], 60],
      [1, 0, [4], 60],
    ]);
    expect(result.flowRatio).toBeCloseTo(0.486953, 5);
    expect(result.lostTime).toBe(120);
    expect(result.webster).toBe(450);
  });

  it('has no Webster cycle when demand reaches saturation', () => {
    const i = counted();
    i.volumeSets[0]!.volumes['sb']!.through = 1500;
    expect(criticalAnalysis(i, i.volumeSets[0]!).webster).toBeNull();
  });
});

describe('analyzePattern', () => {
  it('reports v/c, HCM 2000 delay and level of service', () => {
    const result = analyzePattern(counted(), 'all-day');
    if (!result.ok) throw new Error(result.reason);
    const eb = result.laneGroups[0]!;
    expect(eb.effectiveGreen).toBe(34);
    expect(eb.capacity).toBeCloseTo(1757.12, 6);
    expect(eb.volumeToCapacity).toBeCloseTo(0.569113, 5);
    expect(eb.uniformDelay).toBeCloseTo(12.7936, 3);
    expect(eb.incrementalDelay).toBeCloseTo(1.3437, 3);
    expect(eb.los).toBe('B');
    const sb = result.laneGroups[1]!;
    expect(sb.delay).toBeCloseTo(23.4347, 3);
    expect(sb.los).toBe('C');
    expect(result.delay).toBeCloseTo(15.9463, 3);
    expect(result.los).toBe('B');
    expect(result.criticalVolumeToCapacity).toBeCloseTo(0.5877, 4);
  });

  it('divides volumes by the peak hour factor', () => {
    const i = counted();
    i.volumeSets[0]!.peakHourFactor = 0.8;
    const result = analyzePattern(i, 'all-day');
    expect(result.ok && result.laneGroups[0]!.flow).toBe(1250);
  });

  it('explains what is missing', () => {
    const i = counted();
    i.patterns[0]!.volumeSetId = null;
    expect(analyzePattern(i, 'all-day')).toEqual({ ok: false, reason: 'no-volume-set' });
    expect(analyzePattern(twoPhase(), 'all-day')).toEqual({ ok: false, reason: 'no-volume-set' });
  });

  it('grades delay on the HCM scale', () => {
    expect([10, 10.1, 20, 35, 55, 80, 80.1].map(levelOfService)).toEqual(['A', 'B', 'B', 'C', 'D', 'E', 'F']);
  });
});

describe('suggestTiming', () => {
  const withoutPedestrians = (i: Intersection) => {
    for (const p of i.phases) p.pedestrian.enabled = false;
    return i;
  };

  it('gives the Webster cycle with green in proportion to critical flow ratios', () => {
    // 45 s, 33 s of green: 330 × 0.27643/0.48695 = 187.33 → 187, 142.67 → 143 tenths; + 6 s lost each.
    const i = withoutPedestrians(counted());
    const result = suggestTiming(i, 'all-day');
    if (!result.ok) throw new Error(result.reason);
    expect(result).toMatchObject({ cycle: 450, limitedBy: null, splits: { 2: 247, 4: 203, 6: 247, 8: 203 } });
    i.patterns.push(suggestedPattern(i.patterns[0]!, result, 'am-suggested', 'All Day (suggested)'));
    expect(validateIntersection(i).filter((x) => x.severity === 'error')).toEqual([]);
  });

  it('makes room for pedestrian intervals, recalled or not', () => {
    // Walk 7 s + clearance 16 s (EB/WB) or 12 s (NB/SB) + 6 s: minimums of 29 s and 25 s, so 54 s.
    // 42 s of green: 238.4 → 238 and 181.6 → 182 tenths; SB's 24.2 s rises to 25 s and the 0.8 s comes
    // off the coordinated EB/WB phases, which are left at their 29 s minimum.
    const i = counted();
    const result = suggestTiming(i, 'all-day');
    expect(result).toMatchObject({ ok: true, cycle: 540, limitedBy: 'phase-minimums', splits: { 2: 290, 4: 250, 6: 290, 8: 250 } });
    if (!result.ok) return;
    i.patterns.push(suggestedPattern(i.patterns[0]!, result, 'am-suggested', 'All Day (suggested)'));
    expect(validateIntersection(i)).toEqual([]);
  });

  it('keeps the cycle within bounds and above the phase minimums', () => {
    const light = withoutPedestrians(counted());
    for (const v of Object.values(light.volumeSets[0]!.volumes)) v.through = 50;
    // Webster ≈ 25 s, raised to the 40 s default minimum.
    expect(suggestTiming(light, 'all-day')).toMatchObject({ ok: true, cycle: 400, limitedBy: 'minimum' });
    // With a 20 s minimum, the two 16 s split floors (10 s minimum green + 6 s) win: 32 s.
    expect(suggestTiming(light, 'all-day', { minCycle: 200 })).toMatchObject({ ok: true, cycle: 320, limitedBy: 'phase-minimums' });

    const heavy = withoutPedestrians(counted());
    heavy.volumeSets[0]!.volumes['sb']!.through = 1500;
    expect(suggestTiming(heavy, 'all-day')).toMatchObject({ ok: true, cycle: 1800, limitedBy: 'oversaturated' });
  });

  it('needs a coordinated pattern with counted volumes', () => {
    const free = counted();
    free.patterns[0]!.mode = 'free';
    expect(suggestTiming(free, 'all-day')).toEqual({ ok: false, reason: 'not-coordinated' });
    const empty = counted();
    for (const v of Object.values(empty.volumeSets[0]!.volumes)) Object.assign(v, { through: 0, right: 0 });
    expect(suggestTiming(empty, 'all-day')).toEqual({ ok: false, reason: 'no-volumes' });
  });
});
