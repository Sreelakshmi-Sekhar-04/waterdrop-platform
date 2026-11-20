import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { fitsPhoneWidth, signInWithCode, signUpCustomer, tapPin } from './support';

test.use({ geolocation: { latitude: 10.0159, longitude: 76.3419 }, permissions: ['geolocation'] });

async function axe(page: Page) {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa'])
    .disableRules(['meta-viewport']) // set by react-native-web on its root
    .analyze();
  expect(
    results.violations.map(
      (v) => `${v.id}: ${v.nodes.map((n) => n.html.slice(0, 120)).join(' | ')}`,
    ),
  ).toEqual([]);
}

test('customer: sign up, profile, address outside the area, then home and account', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Continue' }).click();
  await signInWithCode(page, '9847333301');

  await expect(page.getByText('Welcome to WtrDrop')).toBeVisible({ timeout: 15_000 });
  await axe(page);
  await page.getByLabel('Your name').fill('Anitha R');
  await page.getByRole('checkbox').click();
  await page.getByRole('button', { name: 'Continue' }).click();

  await expect(page.getByText('Where should we deliver?')).toBeVisible({ timeout: 15_000 });
  await page.getByLabel('House name, number and street').fill('Rose Villa, 12/4, 2nd lane');
  await page.getByLabel('Landmark').fill("Near St. Mary's Church");
  await page.getByLabel('PIN code').fill('695001');
  await page.getByRole('button', { name: 'Save my current location' }).click();
  await expect(page.getByText('Location saved')).toBeVisible();
  await axe(page);
  await fitsPhoneWidth(page);
  await page.getByRole('button', { name: 'Save address' }).click();
  await expect(page.getByText(/do not deliver to this PIN code/)).toBeVisible();

  await page.getByLabel('PIN code').fill('682030');
  await page.getByRole('button', { name: 'Save address' }).click();
  await expect(page.getByText('Need water today?')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText(/Anitha R/)).toBeVisible();

  await page.getByText('Account', { exact: true }).last().click();
  await expect(page.getByText('Delivery addresses')).toBeVisible();
  await expect(page.getByText(/Rose Villa/)).toBeVisible();
  await axe(page);
  await fitsPhoneWidth(page);

  // The session survives a reload (refresh token kept on the device).
  await page.reload();
  await expect(page.getByText('Delivery addresses')).toBeVisible({ timeout: 30_000 });
});

test('customer: a wrong code is refused with a clear message', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByLabel('Mobile number').fill('9847333302');
  await page.getByRole('button', { name: 'Send code' }).click();
  await page.getByLabel('6-digit code').fill('000000');
  await expect(page.getByText('The code is wrong or has expired. 4 tries left.')).toBeVisible({
    timeout: 15_000,
  });
});

test('delivery staff: SMS code once, weak PIN refused, then daily PIN sign-in', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Delivery staff sign-in' }).click();
  await signInWithCode(page, '9847000002'); // seeded test staff member

  await expect(page.getByText('Choose a 4-digit PIN')).toBeVisible({ timeout: 15_000 });
  await axe(page);
  await tapPin(page, '1234');
  await expect(page.getByText(/too easy to guess/)).toBeVisible();
  await expect(page.getByText('Type the PIN again')).toHaveCount(0);
  await tapPin(page, '5831');
  await expect(page.getByText('Type the PIN again')).toBeVisible();
  await tapPin(page, '5831');
  await expect(page.getByRole('heading', { name: "Today's route" })).toBeVisible({
    timeout: 15_000,
  });

  await page.getByRole('button', { name: /Sign out/ }).click();
  await expect(page.getByText('Enter your PIN')).toBeVisible({ timeout: 15_000 });
  await tapPin(page, '9999');
  await expect(page.getByText(/Wrong PIN. 4 tries left/)).toBeVisible();
  await tapPin(page, '5831');
  await expect(page.getByRole('heading', { name: "Today's route" })).toBeVisible({
    timeout: 15_000,
  });
});

test('a number with no staff account cannot use staff sign-in', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Delivery staff sign-in' }).click();
  await signInWithCode(page, '9847333303');
  await expect(
    page.getByText('This number is not registered as delivery staff. Please ask the office.'),
  ).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText('Choose a 4-digit PIN')).toHaveCount(0);
});

test('customer: deletes their account from Account and is signed out', async ({ page }) => {
  await signUpCustomer(page, '9847333377', 'Leaving Soon');
  await page.getByText('Account', { exact: true }).last().click();
  await page.getByRole('button', { name: 'Delete my account' }).click();
  await expect(page.getByText(/This cannot be undone/)).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText(/orders and payments stay with the supplier/)).toBeVisible();
  await axe(page);
  await fitsPhoneWidth(page);
  await page.getByRole('button', { name: 'Delete my account' }).click();
  // Back at the start, signed out.
  await expect(page.getByRole('button', { name: 'Continue' })).toBeVisible({ timeout: 15_000 });
  await page.reload();
  await expect(page.getByRole('button', { name: 'Continue' })).toBeVisible({ timeout: 30_000 });
});
