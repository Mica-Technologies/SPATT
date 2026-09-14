import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { addIntersection, commitField, createProject, problems, saved, TEMPLATES, watchErrors } from './app';

let errors: string[] = [];

test.beforeEach(({ page }) => {
  errors = watchErrors(page);
});

test.afterEach(() => {
  expect(errors).toEqual([]);
});

test('adds every template and opens each tab', async ({ page }) => {
  await createProject(page, 'Templates');
  for (const template of TEMPLATES) {
    await addIntersection(page, template);
  }
  const sidebar = page.getByRole('navigation', { name: 'Intersections' });
  await expect(sidebar.getByRole('button', { name: / \d+ phases / })).toHaveCount(TEMPLATES.length);

  for (const name of ['Main St & Side St', 'Harbor Rd & Split Ave', 'Elm St & 3rd Ave', 'CSM ASC-3 default']) {
    await sidebar.getByRole('button', { name: new RegExp(`^${name.replace(/[&]/g, '\\&')} \\d+ phases`) }).click();
    await expect(page.getByRole('main').getByRole('heading', { level: 2, name })).toBeVisible();
    for (const tab of ['Phases', 'Rings & Barriers', 'Patterns', 'Schedule']) {
      await page.getByRole('tab', { name: tab }).click();
      await expect(page.getByRole('tab', { name: tab })).toHaveAttribute('aria-selected', 'true');
    }
    await expect(problems(page).getByText('None')).toBeVisible();
  }
});

test('edits a phase, follows a problem to its field, and undoes and redoes', async ({ page }) => {
  await createProject(page, 'Edits');
  await addIntersection(page, 'Standard eight-phase');

  // Min green 30 s + 6 s clearance no longer fits phase 2's 35 s split.
  await commitField(page, 'Min green, phase 2', '30');
  const issue = problems(page).getByRole('button', { name: /phase 2/i }).first();
  await expect(issue).toBeVisible();
  await issue.click();
  await expect(page.getByRole('tab', { name: 'Patterns' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByLabel('Split, phase 2', { exact: true })).toBeFocused();

  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(problems(page).getByText('None')).toBeVisible();
  await page.getByRole('tab', { name: 'Phases' }).click();
  await expect(page.getByLabel('Min green, phase 2', { exact: true })).toHaveValue('10.0');

  await page.getByRole('button', { name: 'Redo' }).click();
  await expect(page.getByLabel('Min green, phase 2', { exact: true })).toHaveValue('30.0');
  await page.locator('body').click({ position: { x: 800, y: 60 } });
  await page.keyboard.press('Control+z');
  await expect(page.getByLabel('Min green, phase 2', { exact: true })).toHaveValue('10.0');
});

test('moves phases between rings by menu and by drag', async ({ page }) => {
  await createProject(page, 'Rings');
  await addIntersection(page, 'Standard eight-phase');
  await page.getByRole('tab', { name: 'Rings & Barriers' }).click();

  // Lag the ring 1 left: menu "Move later".
  const group11 = page.getByLabel('Ring 1, barrier group 1', { exact: true });
  await group11.getByRole('button', { name: 'Phase 1 actions' }).click();
  await page.getByRole('menuitem', { name: 'Move later' }).click();
  await expect(group11.getByLabel(/^Phase \d, /)).toHaveText([/2/, /1/]);

  // Drag phase 3 out to the unassigned tray: the problems panel reports it.
  await page.getByLabel(/^Phase 3, /).dragTo(page.getByLabel('Unassigned phases', { exact: true }));
  await expect(page.getByLabel('Unassigned phases', { exact: true }).getByLabel(/^Phase 3, /)).toBeVisible();
  await expect(problems(page).getByText('None')).toBeHidden();

  // And back into ring 1, group 2.
  await page.getByLabel(/^Phase 3, /).dragTo(page.getByLabel('Ring 1, barrier group 2', { exact: true }));
  await expect(page.getByLabel('Ring 1, barrier group 2', { exact: true }).getByLabel(/^Phase 3, /)).toBeVisible();
});

test('creates a pattern, distributes and balances its splits, and schedules it', async ({ page }) => {
  await createProject(page, 'Patterns');
  await addIntersection(page, 'Standard eight-phase');
  await page.getByRole('tab', { name: 'Patterns' }).click();

  await page.getByRole('button', { name: 'Add pattern' }).first().click();
  await commitField(page, 'Cycle length', '120');
  await page.getByRole('button', { name: 'Distribute evenly' }).click();
  await expect(page.getByRole('status')).toHaveText('Splits fill the cycle');

  await commitField(page, 'Split, phase 1', '0');
  await expect(page.getByRole('status')).not.toHaveText('Splits fill the cycle');
  await page.getByRole('button', { name: 'Balance' }).click();
  await expect(page.getByLabel('Split, phase 1', { exact: true })).toHaveValue('10.0');
  await expect(page.getByRole('status')).toHaveText('Splits fill the cycle');
  await expect(problems(page).getByText('None')).toBeVisible();

  await page.getByRole('tab', { name: 'Schedule' }).click();
  await page.getByRole('button', { name: 'Add entry' }).click();
  await expect(page.getByLabel(/^Start time, entry at /)).toHaveCount(3);
});

test('autosaves, reloads, exports and imports a project', async ({ page }) => {
  await createProject(page, 'Round trip');
  await addIntersection(page, 'Split-phase side street');
  await commitField(page, 'Min green, phase 4', '12');
  await saved(page);

  await page.reload();
  await page.getByRole('button', { name: /^Round trip/ }).click();
  await expect(page.getByLabel('Min green, phase 4', { exact: true })).toHaveValue('12.0');

  // An edit made just before leaving is flushed on pagehide, not lost to the autosave delay.
  await commitField(page, 'Min green, phase 8', '13');
  await page.reload();
  await page.getByRole('button', { name: /^Round trip/ }).click();
  await expect(page.getByLabel('Min green, phase 8', { exact: true })).toHaveValue('13.0');

  const downloading = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export project' }).click();
  const download = await downloading;
  expect(download.suggestedFilename()).toBe('Round trip.spatt.json');
  const file = await download.path();
  const exported = JSON.parse(await readFile(file, 'utf8')) as { name: string; intersections: { phases: { number: number; minGreen: number }[] }[] };
  expect(exported.intersections[0]!.phases.find((p) => p.number === 4)!.minGreen).toBe(120);

  await page.getByRole('button', { name: 'All projects' }).click();
  const choosing = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Import' }).click();
  await (await choosing).setFiles(file);
  await expect(page.getByLabel('Min green, phase 4', { exact: true })).toHaveValue('12.0');
  await page.getByRole('button', { name: 'All projects' }).click();
  await expect(page.getByRole('button', { name: /^Round trip/ })).toHaveCount(2);
});
