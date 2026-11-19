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

test('Orders: take a phone order from the customer page', async () => {
  // Still on Mary Joseph's page from the step before.
  await page.getByRole('button', { name: '+ New order' }).click();
  const dialog = page.getByRole('dialog', { name: 'New order' });
  await expect(dialog.getByText(`Mary Joseph ${tag}`)).toBeVisible();
  await dialog.getByLabel('Cans', { exact: true }).fill('3');
  // 3 cans × ₹40, plus the ₹150 deposit for each new can (estimate until delivery).
  await expect(dialog.getByText('3 cans × ₹40')).toBeVisible();
  await dialog.getByRole('button', { name: 'Save order · ₹570' }).click();
  await expect(dialog).toBeHidden();
  await expect(
    page.getByText(new RegExp(`Order WD-\\d+ saved for Mary Joseph ${tag}\\.`)),
  ).toBeVisible();
  const orders = page.getByRole('region', { name: 'Orders' });
  await expect(orders.getByRole('row', { name: /WD-\d+/ })).toContainText('Accepted');
  await axe();
  await noHorizontalScroll(page);
});

test('Orders: a new order from the Orders page, then cancel it with a reason', async () => {
  await nav('Orders');
  await expect(page.getByRole('list', { name: 'Cans booked per delivery time' })).toBeVisible();
  await page.getByRole('button', { name: '+ New order' }).click();
  const dialog = page.getByRole('dialog', { name: 'New order' });
  await dialog.getByRole('searchbox', { name: 'Find the customer' }).fill(`Mary Joseph ${tag}`);
  await dialog.getByRole('button', { name: new RegExp(`Mary Joseph ${tag}`) }).click();
  await dialog.getByLabel('Cans', { exact: true }).fill('2');
  await dialog.getByLabel('Note for this order (optional)').fill('Ring the bell twice');
  await dialog.getByRole('button', { name: /^Save order · ₹/ }).click();
  await expect(dialog).toBeHidden();
  const saved = page.getByText(new RegExp(`Order WD-\\d+ saved for Mary Joseph ${tag}\\.`));
  await expect(saved).toBeVisible();
  const no = (await saved.textContent())!.match(/WD-\d+/)![0];

  // The list moved to the order's delivery day and shows it, accepted by the office.
  const row = page.getByRole('row', { name: new RegExp(no) });
  await expect(row).toContainText('Accepted');
  await expect(row).toContainText('Taken by office');
  await page.getByRole('searchbox', { name: "Search this day's orders" }).fill(no);
  await expect(page.getByRole('row', { name: /WD-\d+/ })).toHaveCount(1);
  await axe();
  await noHorizontalScroll(page);

  await row.getByRole('link', { name: no }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(no);
  await expect(page.getByText('Ring the bell twice')).toBeVisible();
  await page.getByRole('button', { name: 'Cancel order' }).click();
  const confirm = page.getByRole('dialog', { name: `Cancel order ${no}?` });
  await confirm.getByRole('button', { name: 'Cancel order' }).click();
  await expect(confirm.getByText('Write a short reason (at least 3 letters).')).toBeVisible();
  await confirm.getByLabel('Reason').fill('Customer phoned to cancel');
  await confirm.getByRole('button', { name: 'Cancel order' }).click();
  await expect(confirm).toBeHidden();
  await expect(page.getByText(`Order ${no} cancelled. Its cans are free again.`)).toBeVisible();
  const history = page.getByRole('region', { name: 'What happened' });
  await expect(history.getByText('Customer phoned to cancel')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Cancel order' })).toHaveCount(0);
  await axe();
  await noHorizontalScroll(page);
});

test('Settings: delivery times, closed days and the can price', async () => {
  await nav('Settings');
  // Delivery times: add one, then switch it off so other tests' choices do not change.
  await expect(page.getByRole('row', { name: /Morning 07:00–11:00/ })).toBeVisible();
  await page.getByRole('button', { name: '+ Add delivery time' }).click();
  const add = page.getByRole('dialog', { name: '+ Add delivery time' });
  await add.getByLabel('Name in English').fill(`Night ${tag}`);
  await add.getByLabel('Name in Malayalam').fill(`രാത്രി ${tag}`);
  await add.getByLabel('Starts').fill('21:00');
  await add.getByLabel('Ends').fill('19:00');
  await add.getByLabel('Cans in this time').fill('20');
  await add.getByRole('button', { name: 'Save' }).click();
  await expect(add.getByText('The end time must be after the start time.')).toBeVisible();
  await add.getByLabel('Starts').fill('19:00');
  await add.getByLabel('Ends').fill('21:00');
  await add.getByRole('button', { name: 'Save' }).click();
  await expect(add).toBeHidden();
  const night = page.getByRole('row', { name: new RegExp(`Night ${tag} 19:00–21:00`) });
  await expect(night).toContainText('Mon, Tue, Wed, Thu, Fri, Sat');
  await night.getByRole('button', { name: `Change Night ${tag}` }).click();
  const edit = page.getByRole('dialog', { name: `Change Night ${tag}` });
  await edit.getByLabel('Customers can choose this time').uncheck();
  await edit.getByRole('button', { name: 'Save' }).click();
  await expect(edit).toBeHidden();
  await expect(night).toContainText('Switched off');

  // Closed days: a reason is needed; booked orders are counted, not cancelled.
  const closeOn = new Date(Date.now() + (tag === 'D' ? 40 : 41) * 86_400_000)
    .toISOString()
    .slice(0, 10);
  await page.getByRole('button', { name: '+ Close a day' }).click();
  const close = page.getByRole('dialog', { name: '+ Close a day' });
  await close.getByLabel('Date').fill(closeOn);
  await close.getByLabel('Reason').fill('ab');
  await close.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(close.getByText('Write a short reason (at least 3 letters).')).toBeVisible();
  await close.getByLabel('Reason').fill(`Onam ${tag}`);
  await close.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(close).toBeHidden();
  await expect(page.getByText(/· Whole day closed\./)).toBeVisible();
  const closedRow = page.getByRole('row', { name: new RegExp(`Onam ${tag}`) });
  await expect(closedRow).toBeVisible();
  await axe();
  await noHorizontalScroll(page);
  await closedRow.getByRole('button', { name: /^Open .* again$/ }).click();
  await expect(page.getByText(/· Whole day is open again\./)).toBeVisible();
  await expect(closedRow).toHaveCount(0);

  // Price: the owner can schedule a new price; the office account cannot.
  const price = page.getByRole('region', { name: 'Can price' });
  await expect(price.getByText('₹40', { exact: true })).toBeVisible();
  if (me.owner) {
    const from = new Date(Date.now() + 60 * 86_400_000).toISOString().slice(0, 10);
    await price.getByRole('button', { name: 'Change the standard price' }).click();
    const dialog = page.getByRole('dialog', { name: 'Change the standard price' });
    await dialog.getByLabel('New price per can (₹)').fill('4o');
    await dialog.getByRole('button', { name: 'Save' }).click();
    await expect(dialog.getByText('Enter an amount like 40 or 42.50.')).toBeVisible();
    await dialog.getByLabel('New price per can (₹)').fill('45');
    await dialog.getByLabel('Starts on').fill(from);
    await dialog.getByRole('button', { name: 'Save' }).click();
    await expect(dialog).toBeHidden();
    await expect(price.getByText(/^₹45 from /)).toBeVisible();
    await expect(price.getByText('₹40', { exact: true })).toBeVisible(); // today's price is unchanged
  } else {
    await expect(price.getByText('Only the owner can change prices.')).toBeVisible();
    await expect(price.getByRole('button', { name: 'Change the standard price' })).toHaveCount(0);
  }
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
