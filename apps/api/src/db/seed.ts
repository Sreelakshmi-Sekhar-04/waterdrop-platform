/**
 * Seeds one DEMO supplier with DEMO settings, service areas, product, price and delivery times.
 * Safe to run more than once.
 * Optionally creates the first owner account from SEED_OWNER_PHONE.
 * No passwords, OTPs or secrets are created here.
 */
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { eq } from 'drizzle-orm';
import { indianMobileSchema } from '@wtrdrop/shared';
import { createDb, type Database } from './client';
import {
  deliveryWindows,
  productPrices,
  products,
  serviceAreas,
  settings,
  suppliers,
  userRoles,
  users,
} from './schema';
import { DEMO_SETTINGS } from '../modules/settings/settings.schema';

export const DEMO_SUPPLIER_SLUG = 'demo';

export async function seed(db: Database, ownerPhone?: string): Promise<{ supplierId: string }> {
  return db.transaction(async (tx) => {
    await tx
      .insert(suppliers)
      .values({ name: 'WtrDrop Demo Supplier (demo data)', slug: DEMO_SUPPLIER_SLUG })
      .onConflictDoNothing({ target: suppliers.slug });
    const [supplier] = await tx
      .select({ id: suppliers.id })
      .from(suppliers)
      .where(eq(suppliers.slug, DEMO_SUPPLIER_SLUG));
    if (!supplier) throw new Error('Demo supplier missing after insert');

    await tx
      .insert(settings)
      .values(
        // A setting with no value (null) is simply absent.
        Object.entries(DEMO_SETTINGS)
          .filter(([, value]) => value !== null)
          .map(([key, value]) => ({
            supplierId: supplier.id,
            key,
            value,
          })),
      )
      .onConflictDoNothing();

    // DEMO areas around Kochi so sign-up works in development. Replace with the real list.
    await tx
      .insert(serviceAreas)
      .values([
        {
          supplierId: supplier.id,
          name: 'Kakkanad (demo)',
          nameMl: 'കാക്കനാട് (ഡെമോ)',
          pincodes: ['682030', '682021', '682037'],
        },
        {
          supplierId: supplier.id,
          name: 'Edappally (demo)',
          nameMl: 'ഇടപ്പള്ളി (ഡെമോ)',
          pincodes: ['682024'],
        },
        {
          supplierId: supplier.id,
          name: 'Infopark (demo)',
          nameMl: 'ഇൻഫോപാർക്ക് (ഡെമോ)',
          pincodes: ['682042'],
        },
      ])
      .onConflictDoNothing();

    // DEMO product, price and delivery times (Part 4 placeholders: ₹40 per can, Mon–Sat 7 am–7 pm).
    await tx
      .insert(products)
      .values({
        supplierId: supplier.id,
        sku: 'CAN-20L',
        nameEn: '20 litre water can',
        nameMl: '20 ലിറ്റർ വെള്ളം ക്യാൻ',
      })
      .onConflictDoNothing();
    const [product] = await tx
      .select({ id: products.id })
      .from(products)
      .where(eq(products.supplierId, supplier.id))
      .limit(1);
    await tx
      .insert(productPrices)
      .values({
        supplierId: supplier.id,
        productId: product!.id,
        pricePaise: 4000,
        validFrom: '2026-01-01',
      })
      .onConflictDoNothing();
    const monSat = [1, 2, 3, 4, 5, 6];
    await tx
      .insert(deliveryWindows)
      .values([
        {
          supplierId: supplier.id,
          nameEn: 'Morning',
          nameMl: 'രാവിലെ',
          startTime: '07:00',
          endTime: '11:00',
          capacityCans: 100,
          daysOfWeek: monSat,
        },
        {
          supplierId: supplier.id,
          nameEn: 'Afternoon',
          nameMl: 'ഉച്ചയ്ക്ക്',
          startTime: '11:00',
          endTime: '15:00',
          capacityCans: 100,
          daysOfWeek: monSat,
        },
        {
          supplierId: supplier.id,
          nameEn: 'Evening',
          nameMl: 'വൈകുന്നേരം',
          startTime: '15:00',
          endTime: '19:00',
          capacityCans: 100,
          daysOfWeek: monSat,
        },
      ])
      .onConflictDoNothing();

    if (ownerPhone) {
      const phone = indianMobileSchema.parse(ownerPhone);
      await tx.insert(users).values({ phone, name: 'Owner' }).onConflictDoNothing();
      const [owner] = await tx.select({ id: users.id }).from(users).where(eq(users.phone, phone));
      if (!owner) throw new Error('Owner user missing after insert');
      await tx
        .insert(userRoles)
        .values({ userId: owner.id, supplierId: supplier.id, role: 'owner' })
        .onConflictDoNothing();
    }
    return { supplierId: supplier.id };
  });
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL is not set');
    process.exit(1);
  }
  const handle = createDb(url);
  seed(handle.db, process.env.SEED_OWNER_PHONE || undefined)
    .then(({ supplierId }) => console.log(`Seeded demo supplier ${supplierId}`))
    .catch((err) => {
      console.error('Seed failed:', err);
      process.exitCode = 1;
    })
    .finally(() => handle.close());
}
