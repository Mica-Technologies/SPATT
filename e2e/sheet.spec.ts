import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import { watchErrors } from './app';

const fixture = (name: string) => fileURLToPath(new URL(`../test/fixtures/projects/${name}.spatt.json`, import.meta.url));

let errors: string[] = [];

test.beforeEach(({ page }) => {
  errors = watchErrors(page);
});

test.afterEach(() => {
  expect(errors).toEqual([]);
});

test('opens a fixture, draws its diagram and previews the timing sheet for print', async ({ page }, testInfo) => {
  await page.goto('/');
  const choosing = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Import' }).click();
  await (await choosing).setFiles(fixture('lead-lag-8-phase'));

  const panel = page.getByRole('complementary', { name: 'Ring-barrier diagram' });
  await expect(panel.getByRole('img', { name: 'Ring-barrier diagram, 90.0 s cycle' })).toBeVisible();
  await expect(panel.getByRole('img', { name: /^Cycle clock: local zero at / })).toBeVisible();
  // Lead-lag: ring 1 runs phase 2 before phase 1, so phase 2's group comes first in the lane.
  const ring1Phases = await panel.locator('svg[aria-label^="Ring-barrier"] [data-phase]').evaluateAll((groups) => groups.map((g) => Number(g.getAttribute('data-phase'))));
  expect(ring1Phases.slice(0, 2)).toEqual([2, 1]);

  await page.getByRole('button', { name: 'Timing sheet' }).click();
  const sheet = page.getByRole('article', { name: /^Timing sheet, / });
  await expect(sheet).toHaveCount(1);
  await expect(sheet.getByRole('heading', { level: 4, name: 'PM Peak (lead-lag)' })).toBeVisible();
  await expect(sheet.getByRole('img', { name: 'Ring-barrier diagram, 90.0 s cycle' })).toBeVisible();

  await page.emulateMedia({ media: 'print' });
  await expect(page.getByRole('button', { name: 'Print' })).toBeHidden();
  await testInfo.attach('timing-sheet-print', { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' });
  await page.emulateMedia({ media: 'screen' });

  await page.getByRole('button', { name: 'Back to editor' }).click();
  await expect(page.getByRole('tab', { name: 'Phases' })).toBeVisible();
});

test('prints every intersection, one after another', async ({ page }) => {
  await page.goto('/');
  for (const name of ['standard-8-phase', 'split-phase-side-street']) {
    const choosing = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: 'Import' }).click();
    await (await choosing).setFiles(fixture(name));
    await expect(page.getByRole('button', { name: 'Timing sheet' })).toBeVisible();
    await page.getByRole('button', { name: 'All projects' }).click();
  }
  // Each fixture is its own project; open one, add the other template, and print both.
  await page.getByRole('button', { name: /^Harbor Rd/ }).first().click();
  await page.getByRole('button', { name: 'Add intersection' }).click();
  await page.getByRole('menuitem', { name: 'Two-phase', exact: true }).click();
  await page.getByRole('button', { name: 'Timing sheet' }).click();
  await page.getByRole('button', { name: 'All (2)' }).click();
  await expect(page.getByRole('article', { name: /^Timing sheet, / })).toHaveText([/Harbor Rd & Split Ave/, /Elm St & 3rd Ave/]);
  await page.getByRole('button', { name: 'A4' }).click();
  await expect(page.getByRole('button', { name: 'A4' })).toHaveAttribute('aria-pressed', 'true');
});
