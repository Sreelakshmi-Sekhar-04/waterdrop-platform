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
});

const SCREENS: [string, string | RegExp][] = [
  ['/help', /help/i],
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
