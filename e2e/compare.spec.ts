import { expect, test } from '@playwright/test';
import { addIntersection, commitField, createProject, watchErrors } from './app';

let errors: string[] = [];
test.beforeEach(({ page }) => {
  errors = watchErrors(page);
});
test.afterEach(() => {
  expect(errors).toEqual([]);
});

test('compares two patterns of an intersection and highlights what changed', async ({ page }) => {
  await createProject(page, 'Compare');
  await addIntersection(page, 'Standard eight-phase');
  await page.getByRole('tab', { name: 'Patterns' }).click();
  await page.getByRole('button', { name: 'Actions for AM Peak', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Duplicate' }).click();
  await commitField(page, 'Offset', '12');

  await page.getByRole('button', { name: 'Actions for AM Peak', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Compare…' }).click();

  await expect(page.getByLabel('Pattern A')).toHaveText('AM Peak');
  await expect(page.getByRole('status')).toHaveText(/1 value differs/);
  const pattern = page.getByRole('region', { name: 'Pattern' });
  await expect(pattern.getByRole('row', { name: /Offset 0\.0 12\.0/ })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Ring-barrier diagrams' }).getByRole('img')).toHaveCount(2);

  await page.getByLabel('Only differences').check();
  await expect(pattern.getByRole('row')).toHaveCount(2);

  await page.getByRole('button', { name: 'Back to editor' }).click();
  await expect(page.getByRole('tab', { name: 'Patterns' })).toHaveAttribute('aria-selected', 'true');
});

test('compares the same intersection across two projects in the library', async ({ page }) => {
  await createProject(page, 'Proposal');
  await addIntersection(page, 'Standard eight-phase');
  await commitField(page, 'Yellow, phase 2', '4.5');
  await expect(page.getByRole('banner').getByText('Saved', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'All projects' }).click();

  await createProject(page, 'Existing');
  await addIntersection(page, 'Standard eight-phase');
  await page.getByRole('button', { name: 'Actions for Main St & Side St', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Compare plans…' }).click();
  await page.getByRole('button', { name: 'Another project' }).click();
  await page.getByLabel('Project B').click();
  await page.getByRole('option', { name: 'Proposal' }).click();

  await expect(page.getByLabel('Intersection B')).toHaveText('Main St & Side St');
  await expect(page.getByRole('status')).toHaveText(/1 value differs/);
  await expect(page.getByRole('cell', { name: 'Yellow, phase 2: 4.0 to 4.5' })).toBeVisible();
});
