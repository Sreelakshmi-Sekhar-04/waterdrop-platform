/**
 * Products and prices (Phase 4). Prices are effective-dated rows: the price on a date is the row
 * with the latest valid_from on or before that date. A customer price (D-11) overrides the standard
 * price from its own valid_from; a customer row with a null price returns them to the standard one.
 */
import { and, asc, desc, eq, gt, lte } from 'drizzle-orm';
import { istDate } from '@wtrdrop/shared';
import type { Database, DbOrTx } from '../../db/client';
import { customerPrices, customers, productPrices, products, settings } from '../../db/schema';
import { AppError, errors } from '../../lib/errors';
import { recordAudit } from '../../lib/audit';
import type { TenantContext } from '../../lib/context';
import { settingsSchema, type Settings } from '../settings/settings.schema';

/** The settings ordering needs. Missing ones are a setup problem, never silently defaulted. */
export type OrderSettings = Pick<
  Settings,
  | 'deliveryChargePaise'
  | 'freeDeliveryAboveCans'
  | 'depositPerCanPaise'
  | 'sameDayCutoff'
  | 'maxCansPerOrder'
  | 'autoAcceptOrders'
  | 'supportPhone'
>;

export async function orderSettings(db: DbOrTx, supplierId: string): Promise<OrderSettings> {
  const rows = await db
    .select({ key: settings.key, value: settings.value })
    .from(settings)
    .where(eq(settings.supplierId, supplierId));
  const s = settingsSchema.partial().parse(Object.fromEntries(rows.map((r) => [r.key, r.value])));
  const needed = [
    'deliveryChargePaise',
    'freeDeliveryAboveCans',
    'depositPerCanPaise',
    'sameDayCutoff',
    'maxCansPerOrder',
    'autoAcceptOrders',
  ] as const;
  const missing = needed.filter((k) => s[k] === undefined);
  if (missing.length) {
    throw new AppError(503, 'SETUP_INCOMPLETE', 'Ordering is not set up yet.', { missing });
  }
  return { ...(s as Required<typeof s>), supportPhone: s.supportPhone ?? null };
}

/** The product customers order. At launch there is exactly one: the 20-litre can. */
export async function mainProduct(db: DbOrTx, supplierId: string) {
  const [p] = await db
    .select({
      id: products.id,
      sku: products.sku,
      nameEn: products.nameEn,
      nameMl: products.nameMl,
    })
    .from(products)
    .where(and(eq(products.supplierId, supplierId), eq(products.status, 'active')))
    .orderBy(asc(products.createdAt))
    .limit(1);
  if (!p)
    throw new AppError(503, 'SETUP_INCOMPLETE', 'Ordering is not set up yet.', {
      missing: ['product'],
    });
  return p;
}

export async function standardPrice(db: DbOrTx, productId: string, date: string) {
  const [row] = await db
    .select({ pricePaise: productPrices.pricePaise })
    .from(productPrices)
    .where(and(eq(productPrices.productId, productId), lte(productPrices.validFrom, date)))
    .orderBy(desc(productPrices.validFrom))
    .limit(1);
  return row?.pricePaise ?? null;
}

/** The customer's own price on `date`, or null when they pay the standard price. */
export async function specialPrice(
  db: DbOrTx,
  customerId: string,
  productId: string,
  date: string,
): Promise<number | null> {
  const [row] = await db
    .select({ pricePaise: customerPrices.pricePaise })
    .from(customerPrices)
    .where(
      and(
        eq(customerPrices.customerId, customerId),
        eq(customerPrices.productId, productId),
        lte(customerPrices.validFrom, date),
      ),
    )
    .orderBy(desc(customerPrices.validFrom))
    .limit(1);
  return row?.pricePaise ?? null;
}

export async function unitPriceFor(
  db: DbOrTx,
  customerId: string,
  productId: string,
  date: string,
): Promise<{ pricePaise: number; special: boolean }> {
  const special = await specialPrice(db, customerId, productId, date);
  if (special !== null) return { pricePaise: special, special: true };
  const standard = await standardPrice(db, productId, date);
  if (standard === null) {
    throw new AppError(503, 'SETUP_INCOMPLETE', 'Ordering is not set up yet.', {
      missing: ['price'],
    });
  }
  return { pricePaise: standard, special: false };
}

/** Admin view: the product, today's price and any price scheduled for later. */
export async function catalogForOffice(db: Database, supplierId: string, now: Date) {
  const product = await mainProduct(db, supplierId);
  const today = istDate(now);
  const history = await db
    .select({
      pricePaise: productPrices.pricePaise,
      validFrom: productPrices.validFrom,
      createdAt: productPrices.createdAt,
    })
    .from(productPrices)
    .where(eq(productPrices.productId, product.id))
    .orderBy(desc(productPrices.validFrom))
    .limit(20);
  const scheduled = await db
    .select({ pricePaise: productPrices.pricePaise, validFrom: productPrices.validFrom })
    .from(productPrices)
    .where(and(eq(productPrices.productId, product.id), gt(productPrices.validFrom, today)))
    .orderBy(asc(productPrices.validFrom));
  return {
    product,
    currentPricePaise: await standardPrice(db, product.id, today),
    scheduled,
    history,
  };
}

/**
 * Sets the standard price from a date (today or later). Setting the same date again replaces that
 * row; past prices can never be changed, so orders already placed keep their history.
 */
export async function setStandardPrice(
  db: Database,
  ctx: TenantContext,
  input: { pricePaise: number; validFrom: string },
  now: Date,
) {
  if (input.validFrom < istDate(now)) {
    throw new AppError(422, 'DATE_IN_PAST', 'A price can start today or later, not in the past.');
  }
  return db.transaction(async (tx) => {
    const product = await mainProduct(tx, ctx.supplierId);
    const before = await standardPrice(tx, product.id, input.validFrom);
    await tx
      .insert(productPrices)
      .values({
        supplierId: ctx.supplierId,
        productId: product.id,
        pricePaise: input.pricePaise,
        validFrom: input.validFrom,
        createdBy: ctx.userId,
      })
      .onConflictDoUpdate({
        target: [productPrices.productId, productPrices.validFrom],
        set: { pricePaise: input.pricePaise, createdBy: ctx.userId, createdAt: new Date() },
      });
    await recordAudit(tx, ctx, {
      action: 'price.set',
      entityType: 'product',
      entityId: product.id,
      before: { pricePaise: before },
      after: input,
    });
    return { productId: product.id, ...input };
  });
}

/** D-11: give one customer their own price from a date, or `null` to return to the standard price. */
export async function setCustomerPrice(
  db: Database,
  ctx: TenantContext,
  customerId: string,
  input: { pricePaise: number | null; validFrom: string },
  now: Date,
) {
  if (input.validFrom < istDate(now)) {
    throw new AppError(422, 'DATE_IN_PAST', 'A price can start today or later, not in the past.');
  }
  return db.transaction(async (tx) => {
    const [c] = await tx
      .select({ id: customers.id })
      .from(customers)
      .where(and(eq(customers.id, customerId), eq(customers.supplierId, ctx.supplierId)));
    if (!c) throw errors.notFound('Customer');
    const product = await mainProduct(tx, ctx.supplierId);
    const before = await specialPrice(tx, customerId, product.id, input.validFrom);
    await tx
      .insert(customerPrices)
      .values({
        supplierId: ctx.supplierId,
        customerId,
        productId: product.id,
        pricePaise: input.pricePaise,
        validFrom: input.validFrom,
        createdBy: ctx.userId,
      })
      .onConflictDoUpdate({
        target: [customerPrices.customerId, customerPrices.productId, customerPrices.validFrom],
        set: { pricePaise: input.pricePaise, createdBy: ctx.userId, createdAt: new Date() },
      });
    await recordAudit(tx, ctx, {
      action: 'customer_price.set',
      entityType: 'customer',
      entityId: customerId,
      before: { pricePaise: before },
      after: input,
    });
    return { customerId, ...input };
  });
}

/** For the customer detail page: their price today and the standard price. */
export async function customerPriceInfo(
  db: Database,
  supplierId: string,
  customerId: string,
  now: Date,
) {
  const product = await mainProduct(db, supplierId);
  const today = istDate(now);
  return {
    standardPricePaise: await standardPrice(db, product.id, today),
    specialPricePaise: await specialPrice(db, customerId, product.id, today),
  };
}
