import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { fitsPhoneWidth, signUpCustomer } from './support';

/** Real orders against the real API (seeded DEMO price ₹40, deposit ₹150, Mon–Sat windows). */
async function axe(page: Page) {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa'])
    .disableRules(['meta-viewport'])
    .analyze();
  expect(
    results.violations.map(
      (v) => `${v.id}: ${v.nodes.map((n) => n.html.slice(0, 120)).join(' | ')}`,
    ),
  ).toEqual([]);
}

test('first order: home shows the usual order, the order screen adds it up, and it is saved', async ({
  page,
}) => {
  await signUpCustomer(page, '9847444401');
  // New customer: 2 cans × ₹40 + ₹150 deposit for each new can.
  await expect(page.getByText('2 cans · ₹380')).toBeVisible();
  await axe(page);
  await page.getByRole('button', { name: 'Order 2 cans again' }).click();

  await expect(page.getByRole('button', { name: 'Place order · ₹380' })).toBeVisible({
    timeout: 15_000,
  });
  await page.getByRole('button', { name: 'One more: cans' }).click();
  await expect(page.getByRole('button', { name: 'Place order · ₹570' })).toBeVisible();
  await expect(page.getByText(/refundable deposit of ₹450 for 3 new cans/)).toBeVisible();
  await expect(page.getByRole('radio').first()).toBeChecked();
  await axe(page);
  await fitsPhoneWidth(page);
  await page.getByRole('button', { name: 'Place order · ₹570' }).click();

  await expect(page.getByRole('heading', { name: 'Order placed' })).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.getByText(/^Order WD-\d+$/)).toBeVisible();
  await expect(
    page.getByText('Confirmed', { exact: true }).locator('visible=true').first(),
  ).toBeVisible(); // accepted automatically
  await expect(page.getByText('Pay ₹570 by cash or UPI')).toBeVisible();
  await axe(page);

  await page.getByRole('button', { name: 'Done' }).click();
  const visible = 'visible=true';
  await expect(page.getByText('Need water today?').locator(visible).first()).toBeVisible();
  await expect(
    page
      .getByText(/WD-\d+ · 3 cans · ₹570/)
      .locator(visible)
      .first(),
  ).toBeVisible();
  // Next time the usual order is the last quantity (D-10).
  await expect(
    page.getByRole('button', { name: 'Order 3 cans again' }).locator(visible).first(),
  ).toBeVisible();
});

test('cancel: the customer cancels an open order after confirming', async ({ page }) => {
  await signUpCustomer(page, '9847444402');
  await page.getByRole('button', { name: 'Order 2 cans again' }).click();
  await page.getByRole('button', { name: 'Place order · ₹380' }).click();
  await expect(page.getByRole('heading', { name: 'Order placed' })).toBeVisible({
    timeout: 15_000,
  });

  await page.getByRole('button', { name: 'Cancel this order' }).click();
  await page.getByRole('button', { name: 'No, keep it' }).click();
  await expect(page.getByRole('heading', { name: 'Order placed' })).toBeVisible();
  await page.getByRole('button', { name: 'Cancel this order' }).click();
  await page.getByRole('button', { name: 'Yes, cancel the order' }).click();
  await expect(page.getByRole('heading', { name: 'Cancelled' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Cancel this order' })).toHaveCount(0);

  await page.getByRole('button', { name: 'Done' }).click();
  await page.getByText('My orders', { exact: true }).locator('visible=true').last().click();
  await expect(page.getByRole('heading', { name: 'My orders' })).toBeVisible();
  await expect(
    page.getByText('Cancelled', { exact: true }).locator('visible=true').first(),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Order again' })).toBeVisible();
  await axe(page);
  await fitsPhoneWidth(page);
});

test('the stepper stops at the maximum and says to call for more', async ({ page }) => {
  await signUpCustomer(page, '9847444403');
  await page.getByRole('button', { name: 'Change quantity or time' }).click();
  const more = page.getByRole('button', { name: 'One more: cans' });
  await expect(more).toBeVisible({ timeout: 15_000 });
  for (let i = 0; i < 10; i++) if (await more.isEnabled()) await more.click();
  await expect(more).toBeDisabled();
  await expect(page.getByText('For more than 10 cans, please call us')).toBeVisible();
});

test('Malayalam: the order screen is translated and still fits', async ({ page }) => {
  await signUpCustomer(page, '9847444404');
  await page.getByText('Account', { exact: true }).last().click();
  await page.getByRole('button', { name: 'മലയാളം' }).click();
  await page.goto('/order');
  await expect(page.getByText(/ഡെപ്പോസിറ്റ്/).first()).toBeVisible({ timeout: 15_000 });
  await fitsPhoneWidth(page);
});
