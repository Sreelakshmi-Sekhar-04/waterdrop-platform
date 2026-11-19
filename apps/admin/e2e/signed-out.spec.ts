import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { noHorizontalScroll } from './support';

test('shows only the sign-in page before sign-in, on every address', async ({ page }) => {
  for (const path of ['/', '/customers', '/settings']) {
    await page.goto(path);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Office sign-in');
    await expect(page.getByRole('navigation')).toHaveCount(0);
  }
});

test('Send code stays off until the number is a valid Indian mobile', async ({ page }) => {
  await page.goto('/');
  const send = page.getByRole('button', { name: 'Send code' });
  await page.getByLabel('Mobile number').fill('12345');
  await expect(send).toBeDisabled();
  await page.getByLabel('Mobile number').fill('+91 98470 00009');
  await expect(page.getByLabel('Mobile number')).toHaveValue('9847000009');
  await expect(send).toBeEnabled();
});

test('a number with no office account gets the same answer as one with an account', async ({
  page,
}, info) => {
  await page.goto('/');
  await page
    .getByLabel('Mobile number')
    .fill(info.project.name === 'phone' ? '9847000098' : '9847000099');
  await page.getByRole('button', { name: 'Send code' }).click();
  await expect(
    page.getByRole('heading', { name: 'Enter the code and your password' }),
  ).toBeVisible();
  await page.getByLabel('6-digit code').fill('000000');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'Enter the code and your password' }),
  ).toBeVisible();
});

test('sign-in page switches to Malayalam', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Switch language to Malayalam' }).click();
  await expect(page.locator('html')).toHaveAttribute('lang', 'ml');
  await expect(page.getByRole('heading', { level: 1 })).not.toHaveText('Office sign-in');
});

test('sign-in page has no horizontal scroll and no accessibility violations', async ({ page }) => {
  await page.goto('/');
  await noHorizontalScroll(page);
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(results.violations.map((v) => `${v.id}: ${v.nodes.length} × ${v.help}`)).toEqual([]);
});
