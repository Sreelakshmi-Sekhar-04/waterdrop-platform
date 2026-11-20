/**
 * Customer profiles and addresses. Every query is limited to the supplier in
 * the caller's token. Customers reach only their own record; office users
 * reach any customer of their own supplier.
 */
import { and, asc, desc, eq, ilike, isNull, or, sql } from 'drizzle-orm';
import {
  PRIVACY_NOTICE_VERSION,
  type AddressInput,
  type CustomerProfileInput,
  type CustomerType,
  type Role,
} from '@wtrdrop/shared';
import type { Database, DbOrTx } from '../../db/client';
import { addresses, customers, serviceAreas, sessions, userRoles, users } from '../../db/schema';
import { AppError, errors } from '../../lib/errors';
import { recordAudit } from '../../lib/audit';
import type { TenantContext } from '../../lib/context';
import { areaForPincode } from '../service-areas/service-areas.service';

const addressColumns = {
  id: addresses.id,
  label: addresses.label,
  line: addresses.line,
  landmark: addresses.landmark,
  pincode: addresses.pincode,
  latitude: addresses.latitude,
  longitude: addresses.longitude,
  deliveryNote: addresses.deliveryNote,
  isDefault: addresses.isDefault,
  areaId: serviceAreas.id,
  areaName: serviceAreas.name,
  areaNameMl: serviceAreas.nameMl,
};

/** The caller's own customer id (customer app). */
export async function ownCustomerId(db: DbOrTx, ctx: TenantContext): Promise<string> {
  const [c] = await db
    .select({ id: customers.id })
    .from(customers)
    .where(and(eq(customers.userId, ctx.userId), eq(customers.supplierId, ctx.supplierId)));
  if (!c) throw errors.unauthenticated();
  return c.id;
}

export async function listAddresses(db: DbOrTx, supplierId: string, customerId: string) {
  return db
    .select(addressColumns)
    .from(addresses)
    .innerJoin(serviceAreas, eq(serviceAreas.id, addresses.serviceAreaId))
    .where(
      and(
        eq(addresses.customerId, customerId),
        eq(addresses.supplierId, supplierId),
        isNull(addresses.archivedAt),
      ),
    )
    .orderBy(desc(addresses.isDefault), asc(addresses.createdAt));
}

export async function getCustomer(db: DbOrTx, supplierId: string, customerId: string) {
  const [row] = await db
    .select({
      id: customers.id,
      userId: users.id,
      name: users.name,
      phone: users.phone,
      preferredLanguage: users.preferredLanguage,
      type: customers.type,
      status: customers.status,
      privacyAcceptedAt: customers.privacyAcceptedAt,
      createdAt: customers.createdAt,
    })
    .from(customers)
    .innerJoin(users, eq(users.id, customers.userId))
    .where(and(eq(customers.id, customerId), eq(customers.supplierId, supplierId)));
  // A customer of another supplier looks exactly like a missing one.
  if (!row) throw errors.notFound('Customer');
  return { ...row, addresses: await listAddresses(db, supplierId, customerId) };
}

export async function updateOwnProfile(
  db: Database,
  ctx: TenantContext,
  input: CustomerProfileInput,
) {
  return db.transaction(async (tx) => {
    const id = await ownCustomerId(tx, ctx);
    const [c] = await tx
      .select({ privacyAcceptedAt: customers.privacyAcceptedAt })
      .from(customers)
      .where(eq(customers.id, id));
    if (!c?.privacyAcceptedAt && !input.acceptPrivacy) {
      throw new AppError(
        400,
        'PRIVACY_NOT_ACCEPTED',
        'Please accept the privacy notice to continue.',
      );
    }
    await tx
      .update(users)
      .set({ name: input.name, preferredLanguage: input.preferredLanguage, updatedAt: new Date() })
      .where(eq(users.id, ctx.userId));
    if (!c?.privacyAcceptedAt) {
      await tx
        .update(customers)
        .set({
          privacyAcceptedAt: new Date(),
          privacyVersion: PRIVACY_NOTICE_VERSION,
          updatedAt: new Date(),
        })
        .where(eq(customers.id, id));
    }
    return getCustomer(tx, ctx.supplierId, id);
  });
}

async function clearDefault(tx: DbOrTx, customerId: string) {
  await tx
    .update(addresses)
    .set({ isDefault: false })
    .where(and(eq(addresses.customerId, customerId), eq(addresses.isDefault, true)));
}

export async function addAddress(
  db: Database,
  ctx: TenantContext,
  customerId: string,
  input: AddressInput,
) {
  return db.transaction(async (tx) => {
    const area = await areaForPincode(tx, ctx.supplierId, input.pincode);
    const existing = await listAddresses(tx, ctx.supplierId, customerId);
    if (existing.length >= 10) {
      throw new AppError(422, 'TOO_MANY_ADDRESSES', 'Up to 10 addresses can be saved.');
    }
    // The first address is the default; a new one becomes default only when asked.
    const makeDefault = existing.length === 0 || input.isDefault === true;
    if (makeDefault) await clearDefault(tx, customerId);
    const [row] = await tx
      .insert(addresses)
      .values({
        supplierId: ctx.supplierId,
        customerId,
        serviceAreaId: area.id,
        label: input.label,
        line: input.line,
        landmark: input.landmark,
        pincode: input.pincode,
        latitude: input.latitude ?? null,
        longitude: input.longitude ?? null,
        deliveryNote: input.deliveryNote ?? null,
        isDefault: makeDefault,
      })
      .returning({ id: addresses.id });
    await recordAudit(tx, ctx, {
      action: 'address.created',
      entityType: 'address',
      entityId: row!.id,
      after: { customerId, ...input },
    });
    return (await listAddresses(tx, ctx.supplierId, customerId)).find((a) => a.id === row!.id)!;
  });
}

async function lockAddress(tx: DbOrTx, supplierId: string, customerId: string, addressId: string) {
  const [a] = await tx
    .select()
    .from(addresses)
    .where(
      and(
        eq(addresses.id, addressId),
        eq(addresses.customerId, customerId),
        eq(addresses.supplierId, supplierId),
        isNull(addresses.archivedAt),
      ),
    )
    .for('update');
  if (!a) throw errors.notFound('Address');
  return a;
}

export async function updateAddress(
  db: Database,
  ctx: TenantContext,
  customerId: string,
  addressId: string,
  input: Partial<AddressInput>,
) {
  return db.transaction(async (tx) => {
    const before = await lockAddress(tx, ctx.supplierId, customerId, addressId);
    const pincode = input.pincode ?? before.pincode;
    const area = input.pincode
      ? await areaForPincode(tx, ctx.supplierId, pincode)
      : { id: before.serviceAreaId };
    if (input.isDefault === true) await clearDefault(tx, customerId);
    if (input.isDefault === false && before.isDefault) {
      throw new AppError(422, 'DEFAULT_REQUIRED', 'Choose another address as default first.');
    }
    await tx
      .update(addresses)
      .set({
        label: input.label ?? before.label,
        line: input.line ?? before.line,
        landmark: input.landmark ?? before.landmark,
        pincode,
        serviceAreaId: area.id,
        latitude: input.latitude === undefined ? before.latitude : input.latitude,
        longitude: input.longitude === undefined ? before.longitude : input.longitude,
        deliveryNote: input.deliveryNote === undefined ? before.deliveryNote : input.deliveryNote,
        isDefault: input.isDefault ?? before.isDefault,
        updatedAt: new Date(),
      })
      .where(eq(addresses.id, addressId));
    await recordAudit(tx, ctx, {
      action: 'address.updated',
      entityType: 'address',
      entityId: addressId,
      before,
      after: input,
    });
    return (await listAddresses(tx, ctx.supplierId, customerId)).find((a) => a.id === addressId)!;
  });
}

/** Archives, never deletes, so past orders keep their address. */
export async function archiveAddress(
  db: Database,
  ctx: TenantContext,
  customerId: string,
  addressId: string,
) {
  await db.transaction(async (tx) => {
    const a = await lockAddress(tx, ctx.supplierId, customerId, addressId);
    await tx
      .update(addresses)
      .set({ archivedAt: new Date(), isDefault: false, updatedAt: new Date() })
      .where(eq(addresses.id, addressId));
    if (a.isDefault) {
      // Hand the default to the oldest remaining address, if any.
      const [next] = await tx
        .select({ id: addresses.id })
        .from(addresses)
        .where(and(eq(addresses.customerId, customerId), isNull(addresses.archivedAt)))
        .orderBy(asc(addresses.createdAt))
        .limit(1);
      if (next)
        await tx.update(addresses).set({ isDefault: true }).where(eq(addresses.id, next.id));
    }
    await recordAudit(tx, ctx, {
      action: 'address.archived',
      entityType: 'address',
      entityId: addressId,
    });
  });
}

// ------------------------------------------------------------------ office

export async function searchCustomers(db: Database, supplierId: string, q: string, limit = 50) {
  const needle = q.trim();
  const digits = needle.replace(/\D/g, '');
  const filter = needle
    ? or(
        ilike(users.name, `%${needle.replace(/[%_\\]/g, '\\$&')}%`),
        digits.length >= 4 ? ilike(users.phone, `%${digits}`) : undefined,
        sql`exists (select 1 from addresses a join service_areas s on s.id = a.service_area_id
                    where a.customer_id = ${customers.id} and a.archived_at is null
                    and (s.name ilike ${'%' + needle + '%'} or a.pincode = ${needle}))`,
      )
    : undefined;
  return db
    .select({
      id: customers.id,
      name: users.name,
      phone: users.phone,
      type: customers.type,
      status: customers.status,
      area: sql<
        string | null
      >`(select s.name from addresses a join service_areas s on s.id = a.service_area_id
               where a.customer_id = ${customers.id} and a.is_default and a.archived_at is null limit 1)`,
      createdAt: customers.createdAt,
    })
    .from(customers)
    .innerJoin(users, eq(users.id, customers.userId))
    .where(and(eq(customers.supplierId, supplierId), filter))
    .orderBy(desc(customers.createdAt))
    .limit(limit);
}

/** Office creates a customer who phoned in (A-01). The customer can later sign in with the same number. */
export async function createCustomerByOffice(
  db: Database,
  ctx: TenantContext,
  input: { phone: string; name: string; type: CustomerType; address?: AddressInput },
) {
  const id = await db.transaction(async (tx) => {
    await tx.insert(users).values({ phone: input.phone, name: input.name }).onConflictDoNothing();
    const [u] = await tx
      .select({ id: users.id, name: users.name })
      .from(users)
      .where(eq(users.phone, input.phone));
    const [existing] = await tx
      .select({ id: customers.id })
      .from(customers)
      .where(and(eq(customers.userId, u!.id), eq(customers.supplierId, ctx.supplierId)));
    if (existing) {
      throw new AppError(
        409,
        'CUSTOMER_EXISTS',
        'A customer with this phone number already exists.',
        {
          customerId: existing.id,
        },
      );
    }
    if (!u!.name) await tx.update(users).set({ name: input.name }).where(eq(users.id, u!.id));
    await tx
      .insert(userRoles)
      .values({ userId: u!.id, supplierId: ctx.supplierId, role: 'customer' })
      .onConflictDoNothing();
    const [c] = await tx
      .insert(customers)
      .values({
        userId: u!.id,
        supplierId: ctx.supplierId,
        type: input.type,
        createdBy: ctx.userId,
      })
      .returning({ id: customers.id });
    await recordAudit(tx, ctx, {
      action: 'customer.created_by_office',
      entityType: 'customer',
      entityId: c!.id,
      after: { phone: input.phone, name: input.name, type: input.type },
    });
    return c!.id;
  });
  if (input.address) await addAddress(db, ctx, id, input.address);
  return getCustomer(db, ctx.supplierId, id);
}

export async function updateCustomerByOffice(
  db: Database,
  ctx: TenantContext,
  customerId: string,
  input: { name?: string; type?: CustomerType; status?: 'active' | 'disabled' },
) {
  await db.transaction(async (tx) => {
    const before = await getCustomer(tx, ctx.supplierId, customerId);
    if (input.name)
      await tx
        .update(users)
        .set({ name: input.name, updatedAt: new Date() })
        .where(eq(users.id, before.userId));
    if (input.type || input.status) {
      await tx
        .update(customers)
        .set({
          type: input.type ?? before.type,
          status: input.status ?? before.status,
          updatedAt: new Date(),
        })
        .where(eq(customers.id, customerId));
    }
    if (input.status) {
      await tx
        .update(userRoles)
        .set({ status: input.status })
        .where(
          and(
            eq(userRoles.userId, before.userId),
            eq(userRoles.supplierId, ctx.supplierId),
            eq(userRoles.role, 'customer'),
          ),
        );
    }
    if (input.status === 'disabled')
      await revokeRoleSessions(tx, before.userId, ctx.supplierId, 'customer');
    await recordAudit(tx, ctx, {
      action: 'customer.updated',
      entityType: 'customer',
      entityId: customerId,
      before: { name: before.name, type: before.type, status: before.status },
      after: input,
    });
  });
  return getCustomer(db, ctx.supplierId, customerId);
}

/** Ends every open sign-in of one user in one role, e.g. when switched off. */
export async function revokeRoleSessions(
  tx: DbOrTx,
  userId: string,
  supplierId: string,
  role: Role,
) {
  await tx
    .update(sessions)
    .set({ revokedAt: new Date() })
    .where(
      and(
        eq(sessions.userId, userId),
        eq(sessions.supplierId, supplierId),
        eq(sessions.role, role),
        isNull(sessions.revokedAt),
      ),
    );
}
