import { describe, expect, it } from 'vitest';
import { parseSeconds } from './parseSeconds';

describe('parseSeconds', () => {
  it.each([
    ['4', 40],
    ['4.5', 45],
    ['.5', 5],
    ['4.50', 45],
    [' 12.0 ', 120],
    ['0', 0],
    ['3600', 36000],
  ])('%j → %i tenths', (text, tenths) => {
    expect(parseSeconds(text)).toBe(tenths);
  });

  it.each(['4.55', 'abc', '-1', '1e3', '4,5', '3600.1'])('rejects %j', (text) => {
    expect(parseSeconds(text)).toBeNull();
  });

  it('maps an empty field to the given empty value', () => {
    expect(parseSeconds('', 0)).toBe(0);
    expect(parseSeconds('  ')).toBeNull();
  });
});
