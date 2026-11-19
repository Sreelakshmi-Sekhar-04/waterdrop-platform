import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

test('Today: attention cards link to the work they describe', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('orders for today not given to a driver yet')).toBeVisible();
  await page.getByRole('link', { name: /Assign by area/ }).click();
  await expect(page).toHaveURL(/\/orders\?show=needsDriver$/);
  await expect(page.getByRole('button', { name: /Needs a driver/ })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
});

test('Today: New order says it is not built yet instead of doing nothing', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: '+ New order' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Phase 4' })).toBeVisible();
});

test('Today: search goes to the customer list', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('searchbox', { name: 'Search customers' }).fill('rajan');
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/customers\?q=rajan$/);
  await expect(page.getByRole('link', { name: 'Rajan K.' })).toBeVisible();
  await expect(page.getByText('1 customer', { exact: true })).toBeVisible();
});

test('Orders: filters show the right orders', async ({ page }) => {
  await page.goto('/orders');
  const rows = page.locator('tbody tr');
  await expect(rows).toHaveCount(7);
  await page.getByRole('button', { name: /Problems/ }).click();
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText('Needs a new time');
});

test('Orders: only orders waiting for a driver can be selected and assigned (simulated)', async ({
  page,
}) => {
  await page.goto('/orders');
  // Orders already on the way have no checkbox.
  await expect(page.getByRole('checkbox')).toHaveCount(3); // select-all + 2 rows
  await page.getByRole('checkbox', { name: 'Select all orders waiting for a driver' }).check();
  await expect(page.getByText('2 orders selected')).toBeVisible();
  await page.getByLabel('Give to').selectOption('Suresh');
  await page.getByRole('button', { name: 'Assign', exact: true }).click();
  await expect(
    page.getByRole('status').filter({ hasText: 'Demo: 2 orders given to Suresh' }),
  ).toContainText('Nothing was saved');
  await expect(page.getByRole('row', { name: /WD-1051/ })).toContainText('Given to driver');
  await expect(page.getByRole('button', { name: /Needs a driver/ })).toContainText('0');
});

test('Customers: phone search uses the last 4 digits and says when nothing matches', async ({
  page,
}) => {
  await page.goto('/customers');
  await page.getByRole('searchbox', { name: 'Search customers' }).fill('9012');
  await expect(page.locator('tbody tr')).toHaveCount(1);
  await expect(page.getByRole('link', { name: 'Green Valley Office' })).toBeVisible();
  await page.getByRole('searchbox', { name: 'Search customers' }).fill('zzz');
  await expect(page.getByText('No customer matches "zzz"')).toBeVisible();
});

test('Customer: can history keeps mistakes visible and corrections need a reason', async ({
  page,
}) => {
  await page.goto('/customers/c2');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Rajan K.');
  await expect(page.getByRole('row', { name: /Reversal/ })).toContainText('Cancels entry #3');
  const lastBalance = page.locator('tbody tr').last().locator('td').nth(3);
  await expect(lastBalance).toHaveText('2');

  await page.getByRole('button', { name: 'Correct can count' }).click();
  const dialog = page.getByRole('dialog', { name: 'Correct can count' });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel('Cans they really have').fill('3');
  await dialog.getByRole('button', { name: 'Save correction' }).click();
  await expect(dialog.getByText(/Write a reason of at least 5 letters/)).toBeVisible();
  await expect(dialog.getByLabel('Reason')).toHaveAttribute('aria-invalid', 'true');

  await dialog.getByLabel('Reason').fill('Counted at the door with Rajan');
  await dialog.getByRole('button', { name: 'Save correction' }).click();
  await expect(dialog).toBeHidden();
  await expect(page.locator('tbody tr')).toHaveCount(6);
  await expect(page.locator('tbody tr').last()).toContainText('Count corrected');
  await expect(page.locator('tbody tr').last()).toContainText('+1');
  await expect(page.getByRole('status').filter({ hasText: 'Nothing was saved' })).toBeVisible();
});

test('Customer: Escape closes the correction dialog', async ({ page }) => {
  await page.goto('/customers/c2');
  await page.getByRole('button', { name: 'Correct can count' }).click();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toBeHidden();
  await expect(page.locator('tbody tr')).toHaveCount(5);
});

test('Malayalam: built pages are translated', async ({ page }) => {
  await page.goto('/orders');
  await page.getByRole('button', { name: 'Switch language to Malayalam' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('ഓർഡറുകൾ');
  await expect(page.getByRole('button', { name: /ഡ്രൈവർ വേണം/ })).toBeVisible();
  await expect(page.getByText('ഡെമോ വിവരം', { exact: true })).toBeVisible();
});

for (const path of ['/', '/orders', '/customers', '/customers/c2']) {
  test(`no horizontal page scroll and no accessibility violations on ${path}`, async ({ page }) => {
    await page.goto(path);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
    const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
    expect(results.violations.map((v) => `${v.id}: ${v.nodes.length} × ${v.help}`)).toEqual([]);
  });
}
