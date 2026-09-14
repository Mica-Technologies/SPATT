import { describe, expect, it } from 'vitest';
import { splitPhaseSideStreet, type Issue } from '../../model';
import { flaggedPhases } from './flags';

const issue = (path: Issue['path']): Issue => ({ severity: 'error', code: 'x', message: 'x', path });

describe('flaggedPhases', () => {
  it('reads phase numbers from split paths and phase indexes', () => {
    const intersection = splitPhaseSideStreet(); // phases 1, 2, 4, 5, 6, 8
    const flagged = flaggedPhases(intersection, [issue(['patterns', 0, 'splits', '4']), issue(['phases', 5, 'minGreen']), issue(['patterns', 0, 'cycle']), issue(['schedule', 0])]);
    expect([...flagged]).toEqual([4, 8]);
  });
});
