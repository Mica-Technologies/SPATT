import { expect, test } from '@playwright/test';
import { addIntersection, createProject, watchErrors } from './app';

let errors: string[] = [];
test.beforeEach(({ page }) => {
  errors = watchErrors(page);
});
test.afterEach(() => {
  expect(errors).toEqual([]);
});

test('draws the intersection with its signals at a point in the cycle', async ({ page }) => {
  await createProject(page, 'Intersection view');
  await addIntersection(page, 'Standard eight-phase');
  const panel = page.getByRole('complementary', { name: 'Ring-barrier diagram' });
  await panel.getByRole('button', { name: 'Intersection' }).click();

  await expect(panel.getByRole('img', { name: 'Plan view of Main St & Side St' })).toBeVisible();
  const heads = panel.getByRole('list', { name: 'Signal heads' }).getByRole('listitem');
  await expect(heads).toHaveCount(8);
  // Local zero is the start of coordinated green: 2 and 6 green and walking.
  await expect(heads.filter({ hasText: 'Phase 2 EB Thru' })).toHaveText('Phase 2 EB Thru: green, walk');
  await expect(heads.filter({ hasText: 'Phase 4 SB Thru' })).toHaveText("Phase 4 SB Thru: red, don't walk");

  // 30 s on (Page Up steps 5 s), phase 2 is in its yellow: its green ends 29 s after it starts.
  const slider = panel.getByRole('slider', { name: 'Cycle time' });
  await slider.focus();
  for (let i = 0; i < 6; i++) await page.keyboard.press('PageUp');
  await expect(slider).toHaveAttribute('aria-valuenow', '300');
  await expect(heads.filter({ hasText: 'Phase 2 EB Thru' })).toHaveText("Phase 2 EB Thru: yellow, don't walk");

  await panel.getByRole('button', { name: 'Oblique' }).click();
  await expect(panel.getByRole('img', { name: 'Oblique view of Main St & Side St' })).toBeVisible();

  await panel.getByRole('button', { name: 'Play cycle' }).click();
  await expect(slider).not.toHaveAttribute('aria-valuenow', '300');
  await panel.getByRole('button', { name: 'Pause cycle' }).click();

  // The ring-barrier diagram is one click away.
  await panel.getByRole('button', { name: 'Ring-barrier' }).click();
  await expect(panel.getByRole('img', { name: 'Ring-barrier diagram, 90.0 s cycle' })).toBeVisible();
});

test('draws a free pattern with dark heads', async ({ page }) => {
  await createProject(page, 'Free pattern');
  await addIntersection(page, 'CSM ASC-3 default');
  const panel = page.getByRole('complementary', { name: 'Ring-barrier diagram' });
  await panel.getByRole('button', { name: 'Intersection' }).click();
  await expect(panel.getByRole('img', { name: 'Plan view of CSM ASC-3 default' })).toBeVisible();
  await expect(panel.getByText('This pattern runs free')).toBeVisible();
  await expect(panel.getByRole('list', { name: 'Signal heads' }).getByRole('listitem').first()).toHaveText('Phase 1: dark, pedestrian signal dark');
});
