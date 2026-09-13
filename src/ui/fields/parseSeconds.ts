import { MAX_TENTHS, secondsToTenths, type Tenths } from '../../model';

/**
 * Parses what a user typed into a seconds field. Accepts "4", "4.5", ".5", "4.50" and surrounding
 * spaces; an empty string is `emptyValue`. Returns null for anything else, including values with
 * more precision than a tenth ("4.55") rather than silently rounding them.
 */
export function parseSeconds(text: string, emptyValue: Tenths | null = null): Tenths | null {
  const trimmed = text.trim();
  if (trimmed === '') {
    return emptyValue;
  }
  if (!/^(\d+(\.\d*)?|\.\d+)$/.test(trimmed)) {
    return null;
  }
  const [, decimals = ''] = trimmed.split('.');
  if (decimals.replace(/0+$/, '').length > 1) {
    return null;
  }
  const tenths = secondsToTenths(Number(trimmed));
  return tenths <= MAX_TENTHS ? tenths : null;
}
