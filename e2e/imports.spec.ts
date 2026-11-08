import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import { addIntersection, createProject, watchErrors } from './app';

const fixture = (path: string) => fileURLToPath(new URL(`../test/fixtures/${path}`, import.meta.url));

let errors: string[] = [];
test.beforeEach(({ page }) => {
  errors = watchErrors(page);
});
test.afterEach(() => {
  expect(errors).toEqual([]);
});

test('imports intersections from a Synchro UTDF file as one undo step', async ({ page }) => {
  await createProject(page, 'UTDF import');
  await page.getByRole('button', { name: 'Add intersection' }).first().click();
  await page.getByRole('menuitem', { name: 'Import from Synchro UTDF…' }).click();
  const dialog = page.getByRole('dialog', { name: 'Import from Synchro UTDF' });
  await dialog.getByLabel('UTDF (CSV)').fill(await readFile(fixture('utdf/two-intersections.utdf.csv'), 'utf8'));
  await expect(dialog.getByRole('status')).toHaveText(/Found 2 signalized intersections/);
  await expect(dialog.getByRole('region', { name: 'Main St & 1st Ave' })).toContainText('8 phases in 2 rings');
  await expect(dialog.getByRole('region', { name: 'Whole file' })).toContainText('Nodes without signal phasing were skipped: 3.');
  await dialog.getByRole('button', { name: 'Add 2 intersections' }).click();

  await expect(page.getByRole('main').getByRole('heading', { level: 2, name: 'Main St & 1st Ave' })).toBeVisible();
  const sidebar = page.getByRole('navigation', { name: 'Intersections' });
  await expect(sidebar.getByRole('button', { name: /^Main St & 2nd Ave/ })).toBeVisible();
  await page.getByRole('tab', { name: 'Patterns' }).click();
  await expect(page.getByLabel('Cycle length')).toHaveValue('100.0');

  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(sidebar.getByRole('button', { name: /^Main St & / })).toHaveCount(0);
});

test('imports a turning-movement count, finds the peak hour and maps it to lane groups', async ({ page }) => {
  await createProject(page, 'Count import');
  await addIntersection(page, 'Standard eight-phase');
  await page.getByRole('tab', { name: 'Volumes' }).click();
  await page.getByRole('button', { name: 'Import CSV…' }).click();
  const dialog = page.getByRole('dialog', { name: 'Import turning-movement counts' });
  const chooser = page.waitForEvent('filechooser');
  await dialog.getByRole('button', { name: 'Open CSV file…' }).click();
  await (await chooser).setFiles(fixture('counts/wide-15min.csv'));

  await expect(dialog.getByRole('status')).toHaveText(/Peak hour 07:30–08:30/);
  await expect(dialog.getByLabel('Count name')).toHaveValue('AM peak 07:30');
  await expect(dialog.getByLabel('Lane group for NB Left')).toHaveText('New lane group, phase 3 NB Left');
  await dialog.getByLabel('Lane group for NB Right').click();
  await page.getByRole('option', { name: 'Not imported' }).click();
  await dialog.getByRole('button', { name: 'Add count' }).click();

  await expect(dialog).toBeHidden();
  const counts = page.getByRole('region', { name: 'Counts' });
  await expect(counts.getByLabel('Count', { exact: true })).toHaveText('AM peak 07:30');
  const laneGroups = page.getByRole('region', { name: 'Lane groups' });
  await expect(laneGroups.getByRole('row')).toHaveCount(9);

  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(laneGroups.getByRole('row')).not.toHaveCount(9);
  await expect(counts.getByText('AM peak 07:30')).toHaveCount(0);
});
