import { expect, test } from '@playwright/test';

test('shows the Today page and says plainly that the numbers are demo data', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Good morning');
  await expect(page.getByRole('heading', { name: 'Needs your attention' })).toBeVisible();
  await expect(page.getByRole('note')).toContainText('made-up demo data and nothing is saved');
  await expect(page.getByText('Demo data', { exact: true })).toBeVisible();
});

// No API runs during these tests, so the portal must say so plainly instead of failing silently.
test('says clearly when the server cannot be reached', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('server-status')).toHaveText('Cannot reach the server');
});

test('navigates between sections', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('link', { name: 'Payments' }).click();
  await expect(page).toHaveURL(/\/payments$/);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Payments');
  await expect(page.getByText('This section is built in Phase 6.')).toBeVisible();
});

test('switches to Malayalam and remembers it', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Switch language to Malayalam' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('സുപ്രഭാതം');
  await expect(page.locator('html')).toHaveAttribute('lang', 'ml');
  await page.reload();
  await expect(page.getByRole('link', { name: 'ഓർഡറുകൾ', exact: true })).toBeVisible();
});

test('has no horizontal scroll at phone width', async ({ page }) => {
  await page.goto('/');
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
});
