import { expect, test } from '@playwright/test';
import { addIntersection, commitField, createProject, watchErrors } from './app';

let errors: string[] = [];
test.beforeEach(({ page }) => {
  errors = watchErrors(page);
});
test.afterEach(() => {
  expect(errors).toEqual([]);
});

test('simulates the controller against a count and plays it back', async ({ page }) => {
  await createProject(page, 'Simulation');
  await addIntersection(page, 'Two-phase');
  await page.getByRole('tab', { name: 'Simulate' }).click();
  await expect(page.getByText('Add lane groups and a count on the Volumes tab to simulate traffic.')).toBeVisible();

  await page.getByRole('tab', { name: 'Volumes' }).click();
  await page.getByRole('button', { name: 'Add for 4 phases' }).click();
  await page.getByRole('button', { name: 'Add count' }).click();
  for (const [label, value] of [
    ['Through volume, EB', '800'],
    ['Through volume, SB', '300'],
    ['Through volume, WB', '700'],
    ['Through volume, NB', '250'],
  ]) {
    await commitField(page, label!, value!);
  }

  await page.getByRole('tab', { name: 'Simulate' }).click();
  await page.getByLabel('Minutes').fill('15');
  await page.getByLabel('Phase 4').fill('30');
  await page.getByRole('button', { name: 'Run' }).click();

  const results = page.getByRole('region', { name: 'Results · NEMA' });
  await expect(results).toBeVisible();
  await expect(results.getByRole('group', { name: 'Mean delay' })).toContainText(/\d+\.\d s/);
  await expect(results.getByRole('group', { name: 'Mean delay' })).toContainText('HCM');
  await expect(results.getByRole('group', { name: 'Cycle' })).toContainText('70.0');
  await expect(results.getByRole('table', { name: 'Phase results' }).getByRole('row')).toHaveCount(5);
  await expect(results.getByRole('table', { name: 'Lane group results' }).getByRole('row', { name: /^EB/ })).toBeVisible();

  const playback = page.getByRole('region', { name: 'Playback' });
  await expect(playback.getByRole('img', { name: /^Signal playback at / })).toBeVisible();
  const slider = playback.getByRole('slider', { name: 'Playback time' });
  await slider.focus();
  await page.keyboard.press('End');
  await expect(playback.getByRole('img', { name: 'Signal playback at 20:00' })).toBeVisible();
  await expect(playback.getByRole('list', { name: 'Signals at the cursor' }).getByRole('listitem')).toHaveCount(4);
});
