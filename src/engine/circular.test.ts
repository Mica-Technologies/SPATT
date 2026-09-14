import { describe, expect, it } from 'vitest';
import { intersect, longestRun, normalize, shift } from './circular';

describe('circular spans', () => {
  it('normalizes: clips, sorts and merges touching spans', () => {
    expect(normalize([[50, 60], [-5, 10], [10, 20], [55, 120]], 100)).toEqual([[0, 20], [50, 100]]);
    expect(normalize([[30, 30]], 100)).toEqual([]);
  });

  it('shifts around the cycle, splitting at its end', () => {
    expect(shift([[60, 90]], 20, 100)).toEqual([[0, 10], [80, 100]]);
    expect(shift([[10, 30]], -30, 100)).toEqual([[80, 100]]);
    expect(shift([[10, 30]], -20, 100)).toEqual([[0, 10], [90, 100]]); // [−10, 10) wraps
    expect(shift([[0, 100]], 37, 100)).toEqual([[0, 100]]);
  });

  it('intersects two sets', () => {
    expect(intersect([[0, 34]], [[30, 64]])).toEqual([[30, 34]]);
    expect(intersect([[0, 10], [40, 70]], [[5, 50]])).toEqual([[5, 10], [40, 50]]);
    expect(intersect([[0, 10]], [[10, 20]])).toEqual([]);
  });

  it('finds the longest run, joining across the cycle end', () => {
    expect(longestRun([[0, 4], [40, 70]], 70)).toEqual({ start: 40, length: 34 });
    expect(longestRun([[10, 20], [30, 45]], 70)).toEqual({ start: 30, length: 15 });
    expect(longestRun([], 70)).toBeNull();
  });
});
