import { describe, expect, it } from 'vitest';
import { formatSeconds, secondsToTenths, tenthsToTicks, ticksToTenths } from './units';

describe('units', () => {
  it('rounds typed seconds to the nearest tenth', () => {
    expect(secondsToTenths(4.5)).toBe(45);
    expect(secondsToTenths(3.04)).toBe(30);
    expect(secondsToTenths(0.35)).toBe(4);
  });

  it('rejects non-finite input', () => {
    expect(() => secondsToTenths(Number.NaN)).toThrow(RangeError);
  });

  it('converts tenths to CSM ticks exactly', () => {
    expect(tenthsToTicks(35)).toBe(70); // 3.5 s yellow = 70 ticks
    expect(tenthsToTicks(900)).toBe(1800); // 90 s cycle
  });

  it('flags odd tick counts as inexact', () => {
    expect(ticksToTenths(70)).toEqual({ tenths: 35, exact: true });
    expect(ticksToTenths(71)).toEqual({ tenths: 36, exact: false });
  });

  it('formats with one decimal', () => {
    expect(formatSeconds(45)).toBe('4.5');
    expect(formatSeconds(900)).toBe('90.0');
  });
});
