import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import { addIntersection, createProject, watchErrors } from './app';

const fixture = fileURLToPath(new URL('../test/fixtures/csm/standard-8-phase.csm.json', import.meta.url));

let errors: string[] = [];
test.beforeEach(({ page }) => {
  errors = watchErrors(page);
});
test.afterEach(() => {
  expect(errors).toEqual([]);
});

test('imports a CSM plan and exports the same plan again', async ({ page }) => {
  await createProject(page, 'CSM round trip');
  const planText = await readFile(fixture, 'utf8');

  await page.getByRole('button', { name: 'Add intersection' }).click();
  await page.getByRole('menuitem', { name: 'Import from CSM ASC-3…' }).click();
  const importDialog = page.getByRole('dialog', { name: 'Import from CSM ASC-3' });
  await importDialog.getByLabel('Plan').fill(planText);
  await expect(importDialog.getByText('Main St & Side St: 8 phases, 1 pattern.')).toBeVisible();
  await importDialog.getByRole('button', { name: 'Add intersection' }).click();

  await expect(page.getByRole('main').getByRole('heading', { level: 2, name: 'Main St & Side St' })).toBeVisible();
  await expect(page.getByLabel('Walk, phase 2', { exact: true })).toHaveValue('7.0');

  await page.getByRole('button', { name: 'Actions for Main St & Side St', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Export for CSM ASC-3…' }).click();
  const exportDialog = page.getByRole('dialog', { name: 'Export for CSM ASC-3' });
  await expect(exportDialog.getByText('Ready to export. The controller can run this plan as it is.')).toBeVisible();
  const downloading = page.waitForEvent('download');
  await exportDialog.getByRole('button', { name: 'Download' }).click();
  const download = await downloading;
  expect(download.suggestedFilename()).toBe('Main St Side St.csm.json');
  expect(await readFile(await download.path(), 'utf8')).toBe(planText);
});

test('explains what blocks an export', async ({ page }) => {
  await createProject(page, 'CSM blocked');
  await addIntersection(page, 'Standard eight-phase');
  await page.getByRole('tab', { name: 'Schedule' }).click();
  await page.getByLabel('Start time, entry at 06:00').fill('06:30');
  await page.getByLabel('Start time, entry at 06:00').press('Enter');

  await page.getByRole('button', { name: /^Actions for / }).first().click();
  await page.getByRole('menuitem', { name: 'Export for CSM ASC-3…' }).click();
  const dialog = page.getByRole('dialog', { name: 'Export for CSM ASC-3' });
  await expect(dialog.getByText('1 problem must be fixed first.')).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Download' })).toBeDisabled();
  await dialog.getByRole('button', { name: /whole hours/ }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole('tab', { name: 'Schedule' })).toHaveAttribute('aria-selected', 'true');
});
