import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

/** Expo web renders lazily; wait for the screen's heading before acting. */
async function open(page: Page, path: string, heading: string | RegExp) {
  await page.goto(path);
  await expect(page.getByRole('heading', { name: heading }).first()).toBeVisible({
    timeout: 30_000,
  });
}

test('welcome: language choice switches the app to Malayalam', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'മലയാളം' }).click();
  await expect(page.getByRole('button', { name: 'തുടരുക' })).toBeVisible();
  await page.getByRole('button', { name: 'English' }).click();
  await expect(page.getByRole('button', { name: 'Continue' })).toBeVisible();
});

test('phone sign-in: Send code stays off until the number is a valid Indian mobile', async ({
  page,
}) => {
  await open(page, '/phone', 'Your mobile number');
  const send = page.getByRole('button', { name: 'Send code' });
  const input = page.getByLabel('Mobile number');
  await input.fill('12345');
  await expect(send).toBeDisabled();
  await input.blur();
  await expect(page.getByText(/Enter a 10-digit mobile number/)).toBeVisible();
  await input.fill('98470 12345');
  await expect(input).toHaveValue('9847012345');
  await expect(send).toBeEnabled();
  await expect(page.getByText(/Sign-in is connected in Phase 3/)).toBeVisible();
});

test('order: stepper changes the total, adds deposit for new cans, and stops at the maximum', async ({
  page,
}) => {
  await open(page, '/order', 'Your order');
  // Demo: 2 cans × ₹40, customer already holds 2 deposit-covered cans.
  await expect(page.getByRole('button', { name: 'Place order · ₹80' })).toBeVisible();
  const more = page.getByRole('button', { name: 'One more: cans' });
  await more.click();
  // 3 × ₹40 + one new can's ₹150 deposit = ₹270.
  await expect(page.getByRole('button', { name: 'Place order · ₹270' })).toBeVisible();
  await expect(page.getByText(/refundable deposit of ₹150 for 1 new can/)).toBeVisible();
  for (let i = 0; i < 10; i++) if (await more.isEnabled()) await more.click();
  await expect(more).toBeDisabled();
  await expect(page.getByText('For more than 10 cans, please call us')).toBeVisible();
});

test('staff delivered: live can balance and the extra-empties warning', async ({ page }) => {
  await open(page, '/deliver?stop=10', 'Rajan K.');
  // Had 2, ordered 3, empties default to 2 → keeps 3.
  await expect(page.getByText('After this, Rajan K. has 3 of our cans')).toBeVisible();
  await expect(page.getByText('₹240', { exact: true })).toBeVisible();
  const moreEmpty = page.getByRole('button', { name: 'One more: Empty cans taken' });
  for (let i = 0; i < 4; i++) await moreEmpty.click();
  await expect(page.getByText('After this, Rajan K. has 0 of our cans')).toBeVisible();
  await expect(page.getByText(/1 more empties than expected/)).toBeVisible();
  await page.getByRole('radio', { name: 'UPI' }).click();
  await expect(page.getByRole('radio', { name: 'UPI' })).toBeChecked();
});

test('staff not delivered: a note is needed only for "Something else"', async ({ page }) => {
  await open(page, '/not-delivered?stop=10', "Why couldn't you deliver?");
  const save = page.getByRole('button', { name: 'Save and go to next stop' });
  await expect(save).toBeDisabled();
  await page.getByRole('radio', { name: 'No one home' }).click();
  await expect(save).toBeEnabled();
  await page.getByRole('radio', { name: 'Something else' }).click();
  await expect(save).toBeDisabled();
  await page.getByLabel(/Note \(needed/).fill('Dog at the gate');
  await expect(save).toBeEnabled();
});

const SCREENS: [string, string | RegExp][] = [
  ['/home', 'Need water today?'],
  ['/order', 'Your order'],
  ['/placed', 'Order placed'],
  ['/orders', /orders/i],
  ['/help', /help/i],
  ['/route', "Today's route"],
  ['/deliver?stop=10', 'Rajan K.'],
  ['/not-delivered?stop=10', "Why couldn't you deliver?"],
  ['/phone', 'Your mobile number'],
  ['/otp?phone=9847012345', 'Enter the code'],
];

for (const [path, heading] of SCREENS) {
  test(`${path}: fits the phone width and has no accessibility violations`, async ({ page }) => {
    await open(page, path, heading);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa'])
      // react-native-web sets these on its root; not something our screens control.
      .disableRules(['meta-viewport'])
      .analyze();
    expect(
      results.violations.map(
        (v) =>
          `${v.id}: ${v.help} → ${v.nodes.map((n) => n.failureSummary?.split('\n')[1] + ' @ ' + n.html.slice(0, 140)).join(' | ')}`,
      ),
    ).toEqual([]);
  });
}

test('Malayalam: staff screen is translated and still fits', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'മലയാളം' }).click();
  await open(page, '/deliver?stop=10', 'Rajan K.');
  await expect(page.getByText(/കാലി ക്യാനുകൾ/).first()).toBeVisible();
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
});
