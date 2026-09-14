import { expect, test } from '@playwright/test';
import { addIntersection, createProject, problems, saved, watchErrors } from './app';

let errors: string[] = [];
test.beforeEach(({ page }) => {
  errors = watchErrors(page);
});
test.afterEach(() => {
  expect(errors).toEqual([]);
});

test('shows progression bands on the time-space diagram and moves offsets by typing and dragging', async ({ page }) => {
  await createProject(page, 'Green wave');
  await addIntersection(page, 'Two-phase');
  await addIntersection(page, 'Two-phase');
  await page.getByRole('button', { name: 'Project settings' }).click();
  await page.getByLabel('Units').click();
  await page.getByRole('option', { name: 'Metric (m, km/h)' }).click();
  await page.getByRole('button', { name: 'Save' }).click();

  await page.getByRole('button', { name: 'Add corridor' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Add corridor' }).click();
  // 300 m at 36 km/h (10 m/s) both ways: 30 s of travel.
  for (const direction of ['Outbound', 'Inbound']) {
    const speed = page.getByLabel(`${direction} speed to Elm St & 3rd Ave (2)`, { exact: true });
    await speed.fill('36');
    await speed.press('Enter');
  }

  await page.getByRole('tab', { name: 'Time-space diagram' }).click();
  const outbound = page.getByRole('group', { name: 'EB band' });
  const inbound = page.getByRole('group', { name: 'WB band' });
  // Both at offset 0: EB leaves A in [0, 34) s and must reach B in [0, 34) after 30 s: 4 s.
  await expect(outbound).toContainText('4.0 s');

  // B's offset at the travel time: the whole 34 s green each way outbound, 24 s inbound.
  const offsetB = page.getByLabel('Offset at Elm St & 3rd Ave (2)', { exact: true });
  await offsetB.fill('30');
  await offsetB.press('Enter');
  await expect(outbound).toContainText('34.0 s');
  await expect(outbound).toContainText('49 % of the cycle');
  await expect(inbound).toContainText('24.0 s');

  // Drag B to the left: the offset moves in whole seconds as one undo step.
  const diagram = page.getByRole('img', { name: /^Time-space diagram/ });
  const box = (await diagram.boundingBox())!;
  const rowY = box.y + box.height * (24 / 440); // B, the last stop, is drawn at the top
  await page.mouse.move(box.x + box.width * 0.6, rowY);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.5, rowY, { steps: 6 });
  await page.mouse.up();
  const moved = Number(await offsetB.inputValue());
  expect(moved).toBeLessThan(30);
  expect(Number.isInteger(moved)).toBe(true);
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(offsetB).toHaveValue('30.0');

  // Optimize, balanced: 29 s each way at B = 35 s, run in the worker and applied as one undo step.
  await page.getByRole('button', { name: 'Optimize offsets…' }).click();
  const optimize = page.getByRole('dialog', { name: /^Optimize offsets/ });
  await optimize.getByRole('radio', { name: /^Balanced/ }).check();
  await optimize.getByRole('button', { name: 'Optimize', exact: true }).click();
  const results = optimize.getByRole('table', { name: 'Optimization results' });
  await expect(results.getByRole('row', { name: /^Elm St & 3rd Ave \(2\)/ })).toContainText('30.0 s35.0 s');
  await expect(results.getByRole('row', { name: /^EB band/ })).toContainText('34.0 s29.0 s');
  await optimize.getByRole('button', { name: 'Apply offsets' }).click();
  await expect(optimize).toBeHidden();
  await expect(offsetB).toHaveValue('35.0');
  await expect(outbound).toContainText('29.0 s');
  await expect(inbound).toContainText('29.0 s');
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(offsetB).toHaveValue('30.0');

  // The time-space sheet: the plan's bands, diagram, offsets and links, on Legal paper too.
  await page.getByRole('button', { name: 'Time-space sheet' }).click();
  const sheet = page.getByRole('article', { name: /^Time-space sheet, / });
  await expect(sheet).toHaveCount(1);
  await expect(sheet).toContainText('EB band 34.0 s (49 %)');
  await expect(sheet).toContainText('WB band 24.0 s (34 %)');
  await expect(sheet.getByRole('img', { name: /^Time-space diagram/ })).toBeVisible();
  await expect(sheet.getByRole('row', { name: /^Elm St & 3rd Ave \(2\)/ })).toContainText('30.0');
  await expect(sheet.getByRole('row', { name: /→ Elm St & 3rd Ave \(2\)/ })).toContainText('3003636');
  await page.getByRole('button', { name: 'Legal' }).click();
  await expect(page.getByRole('button', { name: 'Legal' })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Back to editor' }).click();
  await expect(page.getByRole('tab', { name: 'Time-space diagram' })).toBeVisible();
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
