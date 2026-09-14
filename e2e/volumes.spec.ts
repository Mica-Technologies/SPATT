import { expect, test } from '@playwright/test';
import { addIntersection, commitField, createProject, problems, watchErrors } from './app';

let errors: string[] = [];
test.beforeEach(({ page }) => {
  errors = watchErrors(page);
});
test.afterEach(() => {
  expect(errors).toEqual([]);
});

test('analyses a pattern against a count and suggests timing from it', async ({ page }) => {
  await createProject(page, 'Demand');
  await addIntersection(page, 'Two-phase');
  await page.getByRole('tab', { name: 'Volumes' }).click();

  // One lane group per phase, then the hand-worked case from capacity.test.ts.
  await page.getByRole('button', { name: 'Add for 4 phases' }).click();
  const groups = page.getByRole('table', { name: 'Lane groups' });
  await expect(groups.getByRole('row')).toHaveCount(5);
  for (const name of ['EB', 'SB', 'WB', 'NB']) {
    await commitField(page, `Heavy vehicles in ${name}`, '0');
  }
  await commitField(page, 'Lanes in EB', '2');
  await commitField(page, 'Lanes in WB', '2');
  await page.getByLabel('NB carries right turns', { exact: true }).check();
  // Two lanes at base conditions: 1900 × 2 × 0.952.
  await expect(page.getByLabel('Saturation flow of EB', { exact: true })).toHaveAttribute('placeholder', '3618');

  // The first count links the intersection's pattern.
  await page.getByRole('button', { name: 'Add count' }).click();
  await commitField(page, 'Peak hour factor', '1');
  for (const [label, value] of [
    ['Through volume, EB', '1000'],
    ['Through volume, SB', '400'],
    ['Through volume, WB', '800'],
    ['Through volume, NB', '250'],
    ['Right volume, NB', '50'],
  ]) {
    await commitField(page, label!, value!);
  }
  await expect(page.getByLabel('Left volume, EB', { exact: true })).toBeDisabled();

  const analysis = page.getByRole('region', { name: 'Analysis' });
  await expect(analysis.getByRole('group', { name: 'Intersection delay' })).toContainText('15.9 s · LOS B');
  await expect(analysis.getByRole('group', { name: 'Critical v/c' })).toContainText('0.59');
  await expect(analysis.getByRole('group', { name: 'Webster cycle' })).toContainText('45.0 s');
  const sb = analysis.getByRole('table', { name: 'Lane group analysis' }).getByRole('row', { name: /^SB/ });
  await expect(sb).toContainText('23.4 s');
  await expect(sb).toContainText('C');

  // Suggest: Webster's 45 s cannot fit the pedestrian intervals, so 54 s; a new pattern, selected
  // and analysed, with no problems, and one undo step.
  await analysis.getByRole('button', { name: 'Suggest timing' }).click();
  await expect(analysis.getByRole('alert')).toContainText('Added pattern “All Day (suggested)” with a 54.0 s cycle');
  await expect(analysis.getByRole('alert')).toContainText('could not fit every phase’s minimum split');
  await expect(analysis.getByRole('group', { name: 'Cycle', exact: true })).toContainText('54 s');
  await expect(problems(page).getByText('All Day (suggested)', { exact: false })).toHaveCount(0);
  await page.getByRole('tab', { name: 'Patterns' }).click();
  await expect(page.getByLabel('Cycle length', { exact: true })).toHaveValue('54.0');
  await expect(page.getByLabel('Volume count', { exact: true })).toHaveValue(/count-/);
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(page.getByLabel('Cycle length', { exact: true })).toHaveValue('70.0');
});
