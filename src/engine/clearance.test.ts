import { describe, expect, it } from 'vitest';
import { ceilTenths, pedestrianClearance, pedestrianTotalMinimum, redClearance, yellowChange } from './clearance';

describe('ceilTenths', () => {
  it('rounds up to the next tenth but not on floating-point noise', () => {
    expect(ceilTenths(3.5667)).toBe(36);
    expect(ceilTenths(3.2000000000000003)).toBe(32);
    expect(ceilTenths(3.21)).toBe(33);
  });
});

describe('yellowChange', () => {
  it('35 mph, level: 1 + 51.33 / 20 = 3.57 → 3.6 s', () => {
    expect(yellowChange({ approachSpeed: 35, units: 'us' })).toBe(36);
  });

  it('30 mph, level: 1 + 44 / 20 = 3.2 s exactly', () => {
    expect(yellowChange({ approachSpeed: 30, units: 'us' })).toBe(32);
  });

  it('45 mph on a 3% downgrade: 1 + 66 / (20 − 1.932) = 4.65 → 4.7 s', () => {
    expect(yellowChange({ approachSpeed: 45, gradePercent: -3, units: 'us' })).toBe(47);
  });

  it('an upgrade shortens the interval', () => {
    expect(yellowChange({ approachSpeed: 45, gradePercent: 3, units: 'us' })).toBeLessThan(yellowChange({ approachSpeed: 45, units: 'us' }));
  });

  it('50 km/h, level: 1 + 13.89 / 6.1 = 3.28 → 3.3 s', () => {
    expect(yellowChange({ approachSpeed: 50, units: 'metric' })).toBe(33);
  });

  it('rejects a zero speed', () => {
    expect(() => yellowChange({ approachSpeed: 0, units: 'us' })).toThrow(RangeError);
  });
});

describe('redClearance', () => {
  it('35 mph across 60 ft with a 20 ft vehicle: 80 / 51.33 = 1.56 → 1.6 s', () => {
    expect(redClearance({ approachSpeed: 35, intersectionWidth: 60, units: 'us' })).toBe(16);
  });

  it('50 km/h across 20 m with a 6 m vehicle: 26 / 13.89 = 1.87 → 1.9 s', () => {
    expect(redClearance({ approachSpeed: 50, intersectionWidth: 20, units: 'metric' })).toBe(19);
  });
});

describe('pedestrian clearance', () => {
  it('63 ft at 3.5 ft/s is exactly 18 s', () => {
    expect(pedestrianClearance({ crossingDistance: 63, units: 'us' })).toBe(180);
  });

  it('50 ft at 3.5 ft/s: 14.29 → 14.3 s', () => {
    expect(pedestrianClearance({ crossingDistance: 50, units: 'us' })).toBe(143);
  });

  it('honours a slower walking speed', () => {
    expect(pedestrianClearance({ crossingDistance: 63, walkingSpeed: 3.0, units: 'us' })).toBe(210);
  });

  it('MUTCD pushbutton check: (63 + 6) / 3.0 = 23 s of walk plus clearance', () => {
    expect(pedestrianTotalMinimum({ crossingDistance: 63, units: 'us' })).toBe(230);
  });
});
