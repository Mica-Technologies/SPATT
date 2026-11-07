import { describe, expect, it } from 'vitest';
import { fromMetres, fromMetresPerSecond } from '../../model';
import { defaultLink } from './linkDefaults';

describe('defaultLink', () => {
  it('rounds the default link to whole units of each system', () => {
    const us = defaultLink({ length: 'ft', speed: 'mph' });
    expect(fromMetres(us.distance, 'ft')).toBeCloseTo(1000, 6);
    expect(fromMetresPerSecond(us.speed, 'mph')).toBeCloseTo(30, 6);
    const metric = defaultLink({ length: 'm', speed: 'km/h' });
    expect(metric.distance).toBe(300);
    expect(fromMetresPerSecond(metric.speed, 'km/h')).toBeCloseTo(50, 6);
  });

  it('leaves CSM block units exact', () => {
    expect(defaultLink({ length: 'block', speed: 'block/s' })).toEqual({ distance: 300, speed: 13.4 });
  });
});
