import { expect, test } from '@playwright/test';
import { addIntersection, createProject, problems, saved, watchErrors } from './app';

let errors: string[] = [];
test.beforeEach(({ page }) => {
  errors = watchErrors(page);
});
test.afterEach(() => {
  expect(errors).toEqual([]);
});

test('builds a corridor: stops, links in project units, through phases and a timing plan', async ({ page }) => {
  await createProject(page, 'Corridor');
  await addIntersection(page, 'Standard eight-phase');
  await addIntersection(page, 'Two-phase');

  await page.getByRole('button', { name: 'Project settings' }).click();
  await page.getByLabel('Units').click();
  await page.getByRole('option', { name: 'Metric (m, km/h)' }).click();
  await page.getByRole('button', { name: 'Save' }).click();

  await page.getByRole('button', { name: 'Add corridor' }).click();
  const dialog = page.getByRole('dialog', { name: 'Add corridor' });
  await dialog.getByLabel('Corridor name').fill('Main Street');
  await dialog.getByRole('button', { name: 'Add corridor' }).click();

  await expect(page.getByRole('main').getByRole('heading', { level: 2, name: 'Main Street' })).toBeVisible();
  // Eastbound outbound: phase 2 (EB thru) out, 6 (WB thru) in, suggested from approaches.
  const first = page.getByRole('row', { name: /^Stop 1, Main St & Side St/ });
  await expect(first.getByRole('group', { name: 'Outbound through phases at Main St & Side St' }).getByRole('button', { name: 'Phase 2' })).toHaveAttribute('aria-pressed', 'true');
  await expect(first.getByRole('group', { name: 'Inbound through phases at Main St & Side St' }).getByRole('button', { name: 'Phase 6' })).toHaveAttribute('aria-pressed', 'true');

  // The default link, in metres and km/h.
  const distance = page.getByLabel('Distance to Elm St & 3rd Ave', { exact: true });
  await expect(distance).toHaveValue('300');
  await expect(page.getByLabel('Outbound speed to Elm St & 3rd Ave', { exact: true })).toHaveValue('48.2');
  await distance.fill('450');
  await distance.press('Enter');
  await saved(page);

  // Switch to US units: the same distance reads in feet.
  await page.getByRole('button', { name: 'Project settings' }).click();
  await page.getByLabel('Units').click();
  await page.getByRole('option', { name: 'US customary (ft, mph)' }).click();
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(distance).toHaveValue('1476.4');

  // Reorder: Elm first. The new first stop has no link; the old first gets the default one.
  await page.getByRole('button', { name: 'Move Elm St & 3rd Ave earlier' }).click();
  await expect(page.getByRole('row', { name: /^Stop 1, Elm St & 3rd Ave/ })).toBeVisible();
  await expect(page.getByLabel('Distance to Main St & Side St', { exact: true })).toHaveValue('984.3');

  // The plan pairs each intersection's pattern; the cycles differ (90 s vs 70 s).
  await page.getByRole('tab', { name: 'Timing plans' }).click();
  await expect(page.getByLabel('Pattern at Main St & Side St', { exact: true })).toHaveValue('am-peak');
  await expect(page.getByRole('list', { name: 'Plan problems' }).getByText(/run different cycles/)).toBeVisible();
  await expect(problems(page).getByText('Main Street · Timing plans')).toBeVisible();
  await page.getByLabel('Pattern at Elm St & 3rd Ave', { exact: true }).selectOption({ label: 'Not in this plan' });
  await expect(page.getByRole('list', { name: 'Plan problems' }).getByText(/leaves Elm St & 3rd Ave out/)).toBeVisible();

  // Undo keeps the corridor open.
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(page.getByLabel('Pattern at Elm St & 3rd Ave', { exact: true })).toHaveValue('all-day');
  await expect(page.getByRole('main').getByRole('heading', { level: 2, name: 'Main Street' })).toBeVisible();
});
