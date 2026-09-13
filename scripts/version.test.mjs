import { describe, expect, it } from 'vitest';
import { computeVersions } from './version.mjs';

const at = (iso) => new Date(iso);

describe('computeVersions', () => {
  it('names the first release of a day by its date', () => {
    const v = computeVersions({ now: at('2026-09-13T16:18:00Z'), shortSha: 'b182c98', existingTags: [], release: true });
    expect(v).toEqual({
      prerelease: false,
      tag: '2026.09.13',
      display: '2026.09.13',
      semver: '2026.9.1300',
      msi: '26.9.1300.9999',
    });
  });

  it('numbers later releases the same day', () => {
    const tags = ['2026.09.13', '2026.09.13+1', '2026.09.12+4', '2026.09.13+x'];
    const v = computeVersions({ now: at('2026-09-13T20:00:00Z'), shortSha: 'b182c98', existingTags: tags, release: true });
    expect(v.tag).toBe('2026.09.13+2');
    expect(v.semver).toBe('2026.9.1302');
    expect(v.msi).toBe('26.9.1302.9999');
  });

  it('builds a pre-release that sorts before the release it leads to', () => {
    const v = computeVersions({ now: at('2026-09-13T09:05:00Z'), shortSha: 'b182c98', existingTags: ['2026.09.13'], release: false });
    expect(v.prerelease).toBe(true);
    expect(v.tag).toBe('2026.09.13-pre.0905+b182c98');
    // The next release that day is +1, so the pre-release is 2026.9.1301-pre.905 < 2026.9.1301.
    expect(v.semver).toBe('2026.9.1301-pre.905');
    expect(v.msi).toBe('26.9.1301.905');
  });

  it('keeps semver numeric identifiers free of leading zeros', () => {
    const v = computeVersions({ now: at('2026-01-02T00:07:00Z'), shortSha: 'abcdef1', existingTags: [], release: false });
    expect(v.semver).toBe('2026.1.200-pre.7');
    expect(v.semver).toMatch(/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(-[0-9A-Za-z-]+(\.(0|[1-9]\d*|[0-9A-Za-z-]*[A-Za-z-][0-9A-Za-z-]*))*)?$/);
  });

  it('stays within MSI field limits on the largest date', () => {
    const v = computeVersions({ now: at('2026-12-31T23:59:00Z'), shortSha: 'abcdef1', existingTags: [], release: false });
    const [major, minor, patch, build] = v.msi.split('.').map(Number);
    expect(major).toBeLessThanOrEqual(255);
    expect(minor).toBeLessThanOrEqual(255);
    expect(patch).toBeLessThanOrEqual(65535);
    expect(build).toBeLessThanOrEqual(65535);
  });

  it('rejects a missing sha for pre-releases', () => {
    expect(() => computeVersions({ now: at('2026-09-13T00:00:00Z'), shortSha: '', existingTags: [], release: false })).toThrow();
  });
});
