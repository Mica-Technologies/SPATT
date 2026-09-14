import { expect, test, type Browser, type Page } from '@playwright/test';
import { SERVER_TOKEN } from '../playwright.config';
import { addIntersection, commitField, saved, watchErrors } from './app';

/** A second device: its own browser context (cookies, storage), signed in by the access link. */
async function device(browser: Browser, baseURL: string): Promise<{ page: Page; errors: string[]; close: () => Promise<void> }> {
  const context = await browser.newContext({ baseURL });
  const page = await context.newPage();
  const errors = watchErrors(page);
  await page.goto(`/?token=${SERVER_TOKEN}`);
  await expect(page.getByRole('heading', { name: 'Projects' })).toBeVisible();
  expect(page.url()).not.toContain('token=');
  return { page, errors, close: () => context.close() };
}

test('a browser without the access link is asked for the token', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Access needed' })).toBeVisible();
  await page.getByLabel('Access token').fill('not-the-token-at-all');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByText('That token is not right.')).toBeVisible();
  await page.getByLabel('Access token').fill(SERVER_TOKEN);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByText(/Saved automatically on the SPATT server/)).toBeVisible();
  // Remembered: a reload goes straight to the library.
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Projects' })).toBeVisible();
  expect(errors).toEqual([]);
});

test('two devices share projects and settle a conflicting save', async ({ browser, baseURL }) => {
  const name = `Shared ${Date.now()}`;
  const a = await device(browser, baseURL!);
  const b = await device(browser, baseURL!);

  // Device A creates a project; device B sees it and opens it.
  await a.page.getByRole('button', { name: 'New project' }).click();
  await a.page.getByLabel('Project name').fill(name);
  await a.page.getByRole('button', { name: 'Create' }).click();
  await addIntersection(a.page, 'Standard eight-phase');
  await saved(a.page);

  await b.page.reload();
  await b.page.getByRole('button', { name: new RegExp(`^${name}`) }).click();
  await expect(b.page.getByLabel('Min green, phase 2', { exact: true })).toHaveValue('10.0');

  // A saves a change; B, still on the old version, edits and is stopped.
  await commitField(a.page, 'Min green, phase 2', '12');
  await saved(a.page);
  await commitField(b.page, 'Min green, phase 4', '14');
  await expect(b.page.getByText('This project was changed elsewhere')).toBeVisible();
  await expect(b.page.getByRole('banner').getByText('Changed elsewhere')).toBeVisible();

  // B keeps its version: it now carries B's phase 4 but not A's phase 2 change.
  await b.page.getByRole('button', { name: 'Keep mine' }).click();
  await expect(b.page.getByText('This project was changed elsewhere')).toBeHidden();
  await saved(b.page);

  // A edits again from its now-stale version, and this time loads B's version instead.
  await commitField(a.page, 'Min green, phase 6', '16');
  await expect(a.page.getByText('This project was changed elsewhere')).toBeVisible();
  await a.page.getByRole('button', { name: 'Load their version' }).click();
  await expect(a.page.getByLabel('Min green, phase 4', { exact: true })).toHaveValue('14.0');
  await expect(a.page.getByLabel('Min green, phase 2', { exact: true })).toHaveValue('10.0');
  await expect(a.page.getByLabel('Min green, phase 6', { exact: true })).toHaveValue('10.0');

  // And a conflict saved as a copy leaves both projects in the shared library.
  await commitField(b.page, 'Min green, phase 8', '18');
  await saved(b.page);
  await commitField(a.page, 'Min green, phase 8', '11');
  await a.page.getByRole('button', { name: 'Save mine as a copy' }).click();
  await expect(a.page.getByRole('banner').getByText(`${name} (copy)`)).toBeVisible();
  await saved(a.page);
  await a.page.getByRole('button', { name: 'All projects' }).click();
  await expect(a.page.getByRole('button', { name: new RegExp(`^${name}`) })).toHaveCount(2);

  expect([...a.errors, ...b.errors].filter((e) => !e.includes('412'))).toEqual([]);
  await a.close();
  await b.close();
});
