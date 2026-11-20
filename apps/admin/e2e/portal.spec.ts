import AxeBuilder from '@axe-core/playwright';
import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { addDays, istDate } from '@wtrdrop/shared';
import { officeFromPage, staffPhone } from './api';
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
const ashaPhone = () => (tag === 'D' ? '9847222211' : '9847222212');
let maryId = '';
let one: { id: string; orderNo: number };
let two: { id: string; orderNo: number };

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

/** Report screenshots (desktop only), only when SHOTS names a folder. */
async function shot(name: string) {
  if (process.env.SHOTS && tag === 'D')
    await page.screenshot({ path: `${process.env.SHOTS}/${name}.png`, fullPage: true });
}

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

test('Deliveries: give orders to a delivery person, arrange the stops and move the route', async () => {
  const office = await officeFromPage(page);
  const today = istDate(new Date());
  // A delivery time open all day, so the test does not depend on the clock.
  const { window } = await office.post<{ window: { id: string } }>('admin/windows', {
    nameEn: `All day ${tag}`,
    nameMl: `മുഴുവൻ ദിവസം ${tag}`,
    startTime: '00:00',
    endTime: '23:59',
    capacityCans: 500,
    daysOfWeek: [0, 1, 2, 3, 4, 5, 6],
  });
  const { customers } = await office.get<{ customers: { id: string }[] }>(
    `admin/customers?q=${encodeURIComponent(`Mary Joseph ${tag}`)}`,
  );
  maryId = customers[0]!.id;
  const { customer } = await office.get<{ customer: { addresses: { id: string }[] } }>(
    `admin/customers/${maryId}`,
  );
  const place = async (qty: number) =>
    (
      await office.post<{ order: { id: string; orderNo: number } }>('admin/orders', {
        customerId: maryId,
        addressId: customer.addresses[0]!.id,
        windowId: window.id,
        date: today,
        qty,
        clientRequestId: randomUUID(),
      })
    ).order;
  one = await place(1);
  two = await place(2);
  const asha = await office.post<{ userId: string }>('admin/staff', {
    phone: ashaPhone(),
    name: `Asha ${tag}`,
  });
  expect(asha.userId).toBeTruthy();

  await nav('Deliveries');
  const waiting = page.getByRole('region', { name: 'Waiting for a delivery person' });
  for (const o of [one, two])
    await waiting
      .getByRole('row', { name: new RegExp(`WD-${o.orderNo}\\b`) })
      .getByRole('checkbox')
      .check();
  const bar = page.getByRole('region', { name: 'Give selected orders to a delivery person' });
  await bar.getByLabel('Give to').selectOption({ label: `Suresh ${tag}` });
  await bar.getByRole('button', { name: 'Give orders' }).click();
  await expect(page.getByText(`2 orders given to Suresh ${tag}.`)).toBeVisible();

  const route = page.getByRole('article', { name: new RegExp(`^Suresh ${tag}`) });
  await expect(route).toContainText('Not started');
  await expect(route).toContainText('0 of 2 stops done');
  await expect(route.getByRole('listitem').first()).toContainText(`WD-${one.orderNo}`);
  await route.getByRole('button', { name: `Move WD-${two.orderNo} up` }).click();
  await expect(route.getByRole('listitem').first()).toContainText(`WD-${two.orderNo}`);
  await axe();
  await noHorizontalScroll(page);

  // M-13: Suresh is off today; the whole route goes to Asha.
  await route.getByRole('button', { name: 'Give route to someone else' }).click();
  const move = page.getByRole('dialog', { name: `Give Suresh ${tag}'s route to someone else` });
  await move.getByLabel('Give to').selectOption({ label: `Asha ${tag}` });
  await axe();
  await move.getByRole('button', { name: 'Move the route' }).click();
  await expect(page.getByText(`2 stops moved from Suresh ${tag} to Asha ${tag}.`)).toBeVisible();
  const ashaRoute = page.getByRole('article', { name: new RegExp(`^Asha ${tag}`) });
  await expect(ashaRoute.getByRole('listitem').first()).toContainText(`WD-${two.orderNo}`);
});

test('Deliveries: after the day, re-book the failed order and check the counts', async () => {
  // On Asha's phone: load 3, deliver WD-one (₹40 cash of ₹190), WD-two not home, 1 full can short.
  const phone = await staffPhone(ashaPhone());
  const day = await phone.get<{ trip: { id: string } }>('staff/day');
  const at = new Date().toISOString();
  await phone.post(`staff/trips/${day.trip.id}/start`, {
    clientActionId: randomUUID(),
    loadFull: 3,
  });
  await phone.post(`staff/orders/${one.id}/deliver`, {
    clientActionId: randomUUID(),
    full: 1,
    empties: 0,
    payment: { method: 'cash', amountPaise: 4000 },
    at,
  });
  await phone.post(`staff/orders/${two.id}/not-delivered`, {
    clientActionId: randomUUID(),
    reason: 'NOT_HOME',
    at,
  });
  await phone.post(`staff/trips/${day.trip.id}/end`, {
    clientActionId: randomUUID(),
    returnFull: 1,
    returnEmpty: 0,
    returnDamaged: 0,
    cashPaise: 4000,
    note: 'One can fell at the junction',
  });
  await phone.dispose();

  await page.reload();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Deliveries');
  const failed = page
    .getByRole('listitem')
    .filter({ hasText: `WD-${two.orderNo}` })
    .filter({
      hasText: 'Nobody home',
    });
  await failed.getByRole('button', { name: 'Choose a new time' }).click();
  const re = page.getByRole('dialog', { name: 'Choose a new time' });
  await re.getByLabel('Delivery date').fill(addDays(istDate(new Date()), 1));
  const allDay = await re.locator('option', { hasText: `All day ${tag}` }).getAttribute('value');
  await re.getByLabel('Delivery time').selectOption(allDay!);
  await axe();
  await re.getByRole('button', { name: 'Save new time' }).click();
  await expect(page.getByText(new RegExp(`WD-${two.orderNo} moved to Tomorrow`))).toBeVisible();

  const route = page.getByRole('article', { name: new RegExp(`^Asha ${tag}`) });
  await expect(route).toContainText('Day ended, to check');
  await expect(route).toContainText('Full cans: 1 short');
  await shot('admin-deliveries');
  await route.getByRole('button', { name: 'Check and close day' }).click();
  const check = page.getByRole('dialog', { name: `Check Asha ${tag}'s day` });
  await expect(check.getByText('One can fell at the junction')).toBeVisible();
  await check.getByRole('button', { name: 'Close the day' }).click();
  await expect(check.getByText('Write a short reason.')).toBeVisible();
  await shot('admin-check-day');
  await axe();
  await check
    .getByLabel(/What happened to the difference/)
    .fill('Broken can, Asha told the office');
  await check.getByRole('button', { name: 'Close the day' }).click();
  await expect(page.getByText(`Asha ${tag}'s day is checked and closed.`)).toBeVisible();
  await expect(route).toContainText('Checked');
  await axe();
  await noHorizontalScroll(page);
});

test('Cans and stock: buy new cans, fill them, and count the depot', async () => {
  await nav('Cans and stock');
  await expect(page.getByTestId('stock-counts')).toContainText('With customers');
  await page.getByRole('button', { name: 'New cans bought' }).click();
  const buy = page.getByRole('dialog', { name: 'New cans bought' });
  await buy.getByLabel('Number of cans').fill('20');
  await axe();
  await buy.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('20 new cans added.')).toBeVisible();

  await page.getByRole('button', { name: 'Cans filled at plant' }).click();
  const fill = page.getByRole('dialog', { name: 'Cans filled at plant' });
  await fill.getByLabel('Number of cans').fill('5');
  await fill.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('5 cans marked as filled.')).toBeVisible();
  await expect(page.locator('.table-wrap', { hasText: 'Filled' })).toBeVisible();

  await page.getByRole('button', { name: 'Count the depot' }).click();
  const count = page.getByRole('dialog', { name: 'Count the depot' });
  await count.getByRole('button', { name: 'Save' }).click();
  await expect(count.getByText('Write a short reason.')).toBeVisible();
  await count.getByLabel('Note (needed)').fill('Monthly count');
  await count.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Count saved.')).toBeVisible();
  await shot('admin-stock');
  await axe();
  await noHorizontalScroll(page);
});

test('Customer: cans, deposit and money ledgers after the delivery', async () => {
  await page.goto(`/customers/${maryId}`);
  const balances = page.getByTestId('customer-balances');
  await expect(balances).toContainText('Our cans with them');
  await expect(balances).toContainText('₹150'); // ₹190 delivery, ₹40 paid in cash
  const ledger = page.getByRole('region', { name: 'Cans', exact: true });
  await expect(ledger.getByRole('row', { name: /Delivered/ })).toContainText('+1');
  await page.getByRole('button', { name: /^Money/ }).click();
  const money = page.getByRole('region', { name: 'Money', exact: true });
  await expect(money.getByRole('row', { name: /Payment/ })).toContainText('−₹40');
  await shot('admin-customer-ledgers');
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
