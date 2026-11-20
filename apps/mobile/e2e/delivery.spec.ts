import AxeBuilder from '@axe-core/playwright';
import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { istDate } from '@wtrdrop/shared';
import { officeApi, officeCustomer, officeOrder, type Office } from './office-api';
import { fitsPhoneWidth, signInWithCode, tapPin } from './support';

/**
 * Phase 5, end to end on the real API: the office gives two orders to a delivery person; on the
 * phone they load the van, deliver one stop (cash), cannot deliver the other, undo and redo it, and
 * end the day. The office then sees the ledgers, the stock and a day ready to check; the customer
 * sees the cans they hold.
 */
test.describe.configure({ mode: 'serial' });

const STAFF_PHONE = '9847555501';
const A = { phone: '9847555511', name: 'Lakshmi Menon' };
const B = { phone: '9847555512', name: 'Joseph Paul' };
const today = istDate(new Date());

let office: Office;
let context: BrowserContext;
let page: Page;
let customerA: { customerId: string; addressId: string };
let orderB: { id: string; orderNo: number };

/** Report screenshots, only when SHOTS names a folder. */
async function shot(name: string) {
  if (process.env.SHOTS) await page.screenshot({ path: `${process.env.SHOTS}/${name}.png` });
}

async function axe() {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa'])
    .disableRules(['meta-viewport']) // set by react-native-web on its root
    .analyze();
  expect(
    results.violations.map(
      (v) => `${v.id}: ${v.nodes.map((n) => n.html.slice(0, 140)).join(' | ')}`,
    ),
  ).toEqual([]);
}

test.beforeAll(async ({ browser }, info) => {
  office = await officeApi();
  // A delivery time that is open all day, every day, so the test does not depend on the clock.
  const { window } = await office.post<{ window: { id: string } }>('admin/windows', {
    nameEn: 'All day (test)',
    nameMl: 'മുഴുവൻ ദിവസം (ടെസ്റ്റ്)',
    startTime: '00:00',
    endTime: '23:59',
    capacityCans: 500,
    daysOfWeek: [0, 1, 2, 3, 4, 5, 6],
  });
  const { userId: staffUserId } = await office.post<{ userId: string }>('admin/staff', {
    phone: STAFF_PHONE,
    name: 'Meera (route test)',
  });
  customerA = await officeCustomer(office, A.phone, A.name);
  const customerB = await officeCustomer(office, B.phone, B.name);
  const orderA = await officeOrder(office, customerA, { date: today, windowId: window.id, qty: 2 });
  orderB = await officeOrder(office, customerB, { date: today, windowId: window.id, qty: 1 });
  const r = await office.post<{ assigned: number }>('admin/deliveries/assign', {
    date: today,
    staffUserId,
    orderIds: [orderA.id, orderB.id],
  });
  expect(r.assigned).toBe(2);

  const { defaultBrowserType: _ignored, ...device } = info.project.use as Record<string, unknown>;
  context = await browser.newContext(device);
  page = await context.newPage();
});

test.afterAll(async () => {
  await context?.close();
  await office?.dispose();
});

test('delivery person signs in and loads the van', async () => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Delivery staff sign-in' }).click();
  await signInWithCode(page, STAFF_PHONE);
  await expect(page.getByText('Choose a 4-digit PIN')).toBeVisible({ timeout: 15_000 });
  await tapPin(page, '5831');
  await tapPin(page, '5831');
  await expect(page.getByRole('heading', { name: "Today's route" })).toBeVisible({
    timeout: 15_000,
  });

  await expect(page.getByText('2 stops today')).toBeVisible();
  await shot('staff-1-load');
  await axe();
  await fitsPhoneWidth(page);
  await page.getByRole('button', { name: 'Start route' }).click();
  await expect(page.getByText('Next · Stop 1')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText(A.name).first()).toBeVisible();
  await expect(page.getByText('All saved')).toBeVisible({ timeout: 20_000 });
  await shot('staff-2-next-stop');
  await axe();
  await fitsPhoneWidth(page);
});

test('delivers the first stop and collects cash', async () => {
  await page.getByRole('button', { name: 'Delivered', exact: true }).click();
  // New customer: 2 cans × ₹40 + ₹150 deposit for each new can, nothing to take back.
  await expect(page.getByText(`After this, ${A.name} has 2 of our cans`)).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.getByText('₹380', { exact: true }).first()).toBeVisible();
  await axe();
  await fitsPhoneWidth(page);
  await page.getByRole('radio', { name: 'Cash' }).click();
  await shot('staff-3-delivered');
  await page.getByRole('button', { name: 'Confirm · next stop' }).click();

  await expect(page.getByText('Next · Stop 2')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText(B.name).first()).toBeVisible();
  await expect(page.getByText('All saved')).toBeVisible({ timeout: 20_000 });
});

test('cannot deliver the second stop, undoes it, then records it again', async () => {
  await page.getByRole('button', { name: "Couldn't deliver" }).click();
  await expect(page.getByText("Why couldn't you deliver?")).toBeVisible({ timeout: 15_000 });
  await axe();
  await page.getByRole('radio', { name: 'No one home' }).click();
  await page.getByRole('button', { name: 'Save and go to next stop' }).click();

  await expect(
    page.getByText('All stops done. Count what is on the van and end the day.'),
  ).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.getByText('All saved')).toBeVisible({ timeout: 20_000 });
  // The newest stop is undone (within the undo time), and it is the next stop again.
  await page.getByRole('button', { name: `Undo ${B.name}` }).click();
  await expect(page.getByText('Next · Stop 2')).toBeVisible({ timeout: 15_000 });

  await page.getByRole('button', { name: "Couldn't deliver" }).click();
  await page.getByRole('radio', { name: 'Gate locked' }).click();
  await page.getByRole('button', { name: 'Save and go to next stop' }).click();
  await expect(
    page.getByText('All stops done. Count what is on the van and end the day.'),
  ).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.getByText('All saved')).toBeVisible({ timeout: 20_000 });
  await axe();
  await fitsPhoneWidth(page);
});

test('ends the day with the counts the app expects', async () => {
  await page.getByRole('button', { name: 'End day' }).click();
  await expect(page.getByText('Count what is on the van and the cash in hand.')).toBeVisible({
    timeout: 15_000,
  });
  // Loaded 3, gave 2: 1 full and 0 empties back; ₹380 cash.
  await expect(page.getByText('Expected 1', { exact: true })).toBeVisible();
  await expect(page.getByText("Expected ₹380 from today's cash payments.")).toBeVisible();
  await shot('staff-4-day-end');
  await axe();
  await fitsPhoneWidth(page);
  await page.getByRole('button', { name: 'Confirm counts and end day' }).click();
  await expect(page.getByText('Day ended')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText('All saved')).toBeVisible({ timeout: 20_000 });
});

test('the office sees the ledgers, the stock and the day to check (scenarios 5 and 11)', async () => {
  const day = await office.get<{
    routes: { trip: { id: string; status: string }; differences: Record<string, number> }[];
    toReschedule: { orderId: string; failure: { reason: string } | null }[];
  }>(`admin/deliveries?date=${today}`);
  const route = day.routes.find((r) => r.trip.status === 'ended')!;
  expect(route.differences).toEqual({ full: 0, empty: 0, cashPaise: 0 });
  const failed = day.toReschedule.find((o) => o.orderId === orderB.id);
  expect(failed?.failure?.reason).toBe('LOCKED');

  const ledgers = await office.get<{
    balances: { cansHeld: number; depositHeldPaise: number; balancePaise: number };
  }>(`admin/customers/${customerA.customerId}/ledgers`);
  expect(ledgers.balances).toMatchObject({
    cansHeld: 2,
    depositHeldPaise: 30_000,
    balancePaise: 0,
  });

  await office.post(`admin/trips/${route.trip.id}/reconcile`, {});
  const stock = await office.get<{ withCustomers: number; vanFull: number; vanEmpty: number }>(
    'admin/stock',
  );
  expect(stock.withCustomers).toBe(2);
  expect(stock.vanFull + stock.vanEmpty).toBe(0);
});

test('the customer sees the cans they hold, that nothing is due, and the statement', async ({
  browser,
}, info) => {
  const { defaultBrowserType: _ignored, ...device } = info.project.use as Record<string, unknown>;
  const ctx = await browser.newContext(device);
  const p = await ctx.newPage();
  await p.goto('/');
  await p.getByRole('button', { name: 'Continue' }).click();
  await signInWithCode(p, A.phone);
  // Added by the office, so they accept the privacy notice once.
  const welcome = p.getByText('Welcome to WtrDrop');
  const home = p.getByText('Our cans with you');
  await expect(welcome.or(home)).toBeVisible({ timeout: 15_000 });
  if (await welcome.isVisible()) {
    await p.getByRole('checkbox').click();
    await p.getByRole('button', { name: 'Continue' }).click();
  }
  await expect(home).toBeVisible({ timeout: 15_000 });
  await expect(p.getByTestId('cans-held')).toHaveText('2');
  await expect(p.getByText('All paid, thank you')).toBeVisible();
  if (process.env.SHOTS) await p.screenshot({ path: `${process.env.SHOTS}/customer-home.png` });

  // D-11: this month's statement, from the same ledgers the office sees.
  await p.getByRole('button', { name: 'See monthly statement' }).click();
  await expect(p.getByRole('heading', { name: 'Monthly statement' })).toBeVisible({
    timeout: 15_000,
  });
  await expect(p.getByTestId('statement-closing')).toHaveText('Nothing due');
  await expect(p.getByText('Delivery', { exact: true })).toBeVisible();
  await expect(p.getByText('+₹380')).toBeVisible();
  await expect(p.getByText('−₹380')).toBeVisible();
  const results = await new AxeBuilder({ page: p })
    .withTags(['wcag2a', 'wcag2aa'])
    .disableRules(['meta-viewport'])
    .analyze();
  expect(results.violations.map((v) => v.id)).toEqual([]);
  await fitsPhoneWidth(p);
  if (process.env.SHOTS)
    await p.screenshot({ path: `${process.env.SHOTS}/customer-statement.png` });
  await p.getByRole('button', { name: 'Previous month' }).click();
  await expect(p.getByText('Nothing was charged or paid this month.')).toBeVisible();
  await ctx.close();
});
