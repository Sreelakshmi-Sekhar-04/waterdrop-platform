import AxeBuilder from '@axe-core/playwright';
import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { ACCOUNTS, noHorizontalScroll, requestCode, type ProjectName } from './support';

/**
 * One signed-in browser per project, used by every step in order, so each run sends only the
 * SMS codes a real person would. Everything is saved to the throwaway test database.
 */
test.describe.configure({ mode: 'serial' });

let context: BrowserContext;
let page: Page;
let me: (typeof ACCOUNTS)[ProjectName];
let tag: string; // keeps the two projects' records apart in the shared test database
let pin: string; // a PIN code only this project's new area uses
let firstCodeAt = 0;
const PASSWORD = 'kettle on the porch 42';
const NEW_PASSWORD = 'monsoon rain at seven';

test.beforeAll(async ({ browser }, info) => {
  const name = info.project.name as ProjectName;
  me = ACCOUNTS[name];
  tag = name === 'desktop' ? 'D' : 'P';
  pin = name === 'desktop' ? '682022' : '682033';
  const { defaultBrowserType: _ignored, ...device } = info.project.use as Record<string, unknown>;
  context = await browser.newContext({ ...device, baseURL: 'http://localhost:4173' });
  page = await context.newPage();
});

test.afterAll(async () => {
  await context?.close();
});

async function axe() {
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(
    results.violations.map(
      (v) =>
        `${v.id}: ${v.nodes.map((n) => n.target.join(' ') + ' ' + (n.failureSummary ?? '')).join(' | ')}`,
    ),
  ).toEqual([]);
}

async function nav(name: string) {
  await page.getByRole('navigation').getByRole('link', { name, exact: true }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(name);
}

test('first sign-in: SMS code, then create a password', async () => {
  await page.goto('/');
  firstCodeAt = Date.now();
  const code = await requestCode(page, me.phone);
  await page.getByLabel('6-digit code').fill(code);
  await page.getByRole('button', { name: 'Sign in' }).click();

  await expect(page.getByRole('heading', { name: 'Create your password' })).toBeVisible();
  await page.getByLabel('New password').fill(PASSWORD);
  await page.getByLabel('Type it again').fill('something else');
  await expect(page.getByText('The two passwords are different.')).toBeVisible();
  await page.getByLabel('Type it again').fill(PASSWORD);
  await page.getByRole('button', { name: 'Create password and sign in' }).click();

  await expect(page.getByTestId('signed-in-as')).toContainText(me.role);
  await expect(page.getByTestId('server-status')).not.toHaveText('Cannot reach the server');
});

test('stays signed in after a reload', async () => {
  await page.reload();
  await expect(page.getByTestId('signed-in-as')).toContainText(me.role);
});

test('Settings: add a delivery area, and a PIN code cannot be in two areas', async () => {
  await nav('Settings');
  await expect(page.getByRole('row', { name: /Kakkanad \(demo\)/ })).toBeVisible();

  await page.getByRole('button', { name: '+ Add area' }).click();
  const dialog = page.getByRole('dialog', { name: '+ Add area' });
  await dialog.getByLabel('Area name', { exact: true }).fill(`Thrikkakara ${tag}`);
  await dialog.getByLabel('PIN codes').fill('68203');
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(dialog.getByText('Not valid PIN codes: 68203')).toBeVisible();

  await dialog.getByLabel('PIN codes').fill(`${pin}, 682030`);
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(dialog.getByRole('alert')).toBeVisible(); // 682030 already belongs to Kakkanad

  await dialog.getByLabel('PIN codes').fill(pin);
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole('row', { name: new RegExp(`Thrikkakara ${tag}`) })).toContainText(
    pin,
  );
  await axe();
  await noHorizontalScroll(page);
});

test('Customers: add a customer who phoned, with an address in the new area', async () => {
  await nav('Customers');
  await page.getByRole('button', { name: '+ Add customer' }).click();
  const dialog = page.getByRole('dialog', { name: 'Add a customer who phoned' });
  await dialog.getByRole('button', { name: 'Save customer' }).click();
  await expect(dialog.getByText(/Enter a 10-digit mobile number/)).toBeVisible();

  const phone = tag === 'D' ? '9847111101' : '9847111102';
  await dialog.getByLabel('Mobile number').fill(phone);
  await dialog.getByRole('textbox', { name: /^Name/ }).fill(`Mary Joseph ${tag}`);
  await dialog.getByLabel('House name, number and street').fill('Rose Villa, 12 Church Road');
  await dialog.getByLabel('Landmark').fill('Opposite St. Mary’s Church');
  await dialog.getByLabel('PIN code').fill(pin);
  await dialog.getByRole('button', { name: 'Save customer' }).click();

  await expect(page.getByRole('heading', { level: 1 })).toHaveText(`Mary Joseph ${tag}`);
  await expect(page.getByText('Rose Villa, 12 Church Road')).toBeVisible();
  await expect(page.getByText('Default', { exact: true })).toBeVisible();
  await axe();
  await noHorizontalScroll(page);
});

test('Customers: the same number cannot be added twice, and search finds the last 4 digits', async () => {
  await nav('Customers');
  const phone = tag === 'D' ? '9847111101' : '9847111102';
  await page.getByRole('button', { name: '+ Add customer' }).click();
  const dialog = page.getByRole('dialog', { name: 'Add a customer who phoned' });
  await dialog.getByLabel('Mobile number').fill(phone);
  await dialog.getByRole('textbox', { name: /^Name/ }).fill('Someone Else');
  await dialog.getByRole('button', { name: 'Save customer' }).click();
  await expect(dialog.getByRole('link', { name: 'Open that customer' })).toBeVisible();
  await dialog.getByRole('button', { name: 'Cancel' }).click();

  await page.getByRole('searchbox', { name: 'Search customers' }).fill(phone.slice(-4));
  await expect(page.getByRole('link', { name: `Mary Joseph ${tag}` })).toBeVisible();
  await expect(page.getByText('1 customer', { exact: true })).toBeVisible();
  await page.getByRole('searchbox', { name: 'Search customers' }).fill('zzzq');
  await expect(page.getByText('No customer matches "zzzq"')).toBeVisible();
  await axe();
  await noHorizontalScroll(page);
});

test('Customer: an address outside every area is refused, and switching off is shown', async () => {
  await page.getByRole('searchbox', { name: 'Search customers' }).fill(`Mary Joseph ${tag}`);
  await page.getByRole('link', { name: `Mary Joseph ${tag}` }).click();
  await page.getByRole('button', { name: '+ Add address' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Address name').fill('Shop');
  await dialog.getByLabel('House name, number and street').fill('Market Road');
  await dialog.getByLabel('Landmark').fill('Near the bus stand');
  await dialog.getByLabel('PIN code').fill('695001');
  await dialog.getByRole('button', { name: 'Save address' }).click();
  await expect(dialog.getByText(/not in|outside|deliver/i)).toBeVisible();
  await dialog.getByRole('button', { name: 'Cancel' }).click();

  await page.getByRole('button', { name: 'Switch off' }).click();
  await expect(page.getByText('Customer switched off and signed out of the app.')).toBeVisible();
  await page.getByRole('button', { name: 'Switch on' }).click();
  await expect(page.getByText('Customer switched on again.')).toBeVisible();
});

test('Delivery staff: add, switch off and on', async () => {
  await nav('Delivery staff');
  await expect(page.getByRole('row', { name: /Ravi \(test staff\)/ })).toContainText(
    'Not signed in yet',
  );

  await page.getByRole('button', { name: '+ Add delivery staff' }).click();
  const dialog = page.getByRole('dialog', { name: '+ Add delivery staff' });
  await dialog.getByRole('textbox', { name: /^Name/ }).fill(`Suresh ${tag}`);
  await dialog.getByLabel('Mobile number').fill(tag === 'D' ? '9847222201' : '9847222202');
  await dialog.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(page.getByText(`Suresh ${tag} added.`)).toBeVisible();

  const row = page.getByRole('row', { name: new RegExp(`Suresh ${tag}`) });
  await row.getByRole('button', { name: 'Switch off' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Switch off' }).click();
  await expect(page.getByText(`Suresh ${tag} switched off and signed out.`)).toBeVisible();
  await expect(row).toContainText('Switched off');

  await row.getByRole('button', { name: 'Switch on' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Switch on' }).click();
  await expect(row).toContainText('Active');

  // Nothing to reset until they have set a PIN on their phone (reset is covered by the API tests).
  await expect(row).toContainText('Not signed in yet');
  await expect(row.getByRole('button', { name: 'Reset PIN' })).toHaveCount(0);
  await axe();
  await noHorizontalScroll(page);
});

test('Settings: only the owner manages office accounts', async () => {
  await nav('Settings');
  const team = page.getByRole('region', { name: 'Office accounts' });
  if (me.owner) {
    await expect(team.getByRole('row', { name: /Anu \(test office\)/ })).toBeVisible();
    await expect(team.getByRole('button', { name: '+ Add office account' })).toBeVisible();
  } else {
    await expect(team).toHaveCount(0);
  }
});

test('change password, sign out, then sign in with an SMS code and the new password', async () => {
  await nav('Settings');
  await page.getByLabel('Current password').fill(PASSWORD);
  await page.getByLabel('New password').fill(NEW_PASSWORD);
  await page.getByRole('button', { name: 'Change password' }).click();
  await expect(page.getByText('Password changed. Other browsers were signed out.')).toBeVisible();

  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Office sign-in');
  await page.reload();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Office sign-in');

  // A new code can be asked for 30 seconds after the last one, like a real person would.
  const wait = firstCodeAt + 31_000 - Date.now();
  if (wait > 0) await page.waitForTimeout(wait);
  const code = await requestCode(page, me.phone);

  await page.getByLabel('6-digit code').fill(code);
  await page.getByLabel('Password').fill(PASSWORD); // the old one no longer works
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('alert')).toBeVisible();

  await page.getByLabel('Password').fill(NEW_PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByTestId('signed-in-as')).toContainText(me.role);
});

test('Malayalam: signed-in pages are translated', async () => {
  await page.getByRole('button', { name: 'Switch language to Malayalam' }).click();
  await expect(page.locator('html')).toHaveAttribute('lang', 'ml');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('ക്രമീകരണങ്ങൾ');
  await expect(page.getByRole('button', { name: 'സൈൻ ഔട്ട്' })).toBeVisible();
  await axe();
});
