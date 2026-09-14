/** Shared steps for the end-to-end specs. */
import { expect, type Page } from '@playwright/test';

export const TEMPLATES = ['Standard eight-phase', 'Eight-phase, lead-lag', 'Split-phase side street', 'Two-phase', 'CSM ASC-3 default'] as const;

/**
 * Fails the test on any uncaught page error or console error. The browser host probes
 * `/api/health` to detect the SPATT server, and the dev server answers that with a 404.
 */
export function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(`page error: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error' && !message.text().includes('404 (Not Found)')) {
      errors.push(`console error: ${message.text()}`);
    }
  });
  return errors;
}

export async function createProject(page: Page, name: string): Promise<void> {
  await page.goto('/');
  await page.getByRole('button', { name: 'New project' }).click();
  await page.getByLabel('Project name').fill(name);
  await page.getByRole('button', { name: 'Create' }).click();
  await expect(page.getByRole('banner').getByText(name)).toBeVisible();
}

export async function addIntersection(page: Page, template: (typeof TEMPLATES)[number]): Promise<void> {
  await page.getByRole('button', { name: 'Add intersection' }).click();
  await page.getByRole('menuitem', { name: template, exact: true }).click();
}

export const problems = (page: Page) => page.getByRole('region', { name: 'Problems' });

/** Types into a grid input and commits it the way a user does, with Enter. */
export async function commitField(page: Page, label: string, value: string): Promise<void> {
  const field = page.getByLabel(label, { exact: true });
  await field.fill(value);
  await field.press('Enter');
}

/** Waits for autosave to report the project saved. */
export async function saved(page: Page): Promise<void> {
  await expect(page.getByRole('banner').getByText('Saved', { exact: true })).toBeVisible();
}
