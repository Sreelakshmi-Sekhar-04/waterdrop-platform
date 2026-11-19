/**
 * Phase 1 platform tables, plus Phase 3 users and addresses. Business tables
 * (orders, ledgers, …) are added in the phase that builds each feature,
 * following the ERD in docs/PHASE-0-ANALYSIS.md §9.
 *
 * Conventions: uuid primary keys, timestamptz everywhere, money in integer
 * paise, every tenant-owned row carries supplier_id.
 */
import { sql } from 'drizzle-orm';
import {
  bigserial,
  boolean,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { ROLES } from '@wtrdrop/shared';

const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();
const updatedAt = () => timestamp('updated_at', { withTimezone: true }).notNull().defaultNow();

export const roleEnum = pgEnum('role', ROLES);
export const recordStatusEnum = pgEnum('record_status', ['active', 'disabled']);
export const languageEnum = pgEnum('language', ['en', 'ml']);
export const idempotencyStateEnum = pgEnum('idempotency_state', ['in_progress', 'completed']);
export const customerTypeEnum = pgEnum('customer_type', ['household', 'office', 'shop']);

/** A water supplier (tenant). One row at launch; the design allows more later. */
export const suppliers = pgTable('suppliers', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  slug: text('slug').notNull().unique(),
  status: recordStatusEnum('status').notNull().default('active'),
  gstin: text('gstin'),
  fssaiNo: text('fssai_no'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

/** One login identity per phone number, shared across suppliers. */
export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  phone: text('phone').notNull().unique(),
  name: text('name'),
  preferredLanguage: languageEnum('preferred_language').notNull().default('en'),
  status: recordStatusEnum('status').notNull().default('active'),
  /** Admin portal only (decision D-02: OTP + password). argon2id hash; null until set. */
  passwordHash: text('password_hash'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

/** What a user may do inside one supplier. */
export const userRoles = pgTable(
  'user_roles',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    supplierId: uuid('supplier_id')
      .notNull()
      .references(() => suppliers.id, { onDelete: 'restrict' }),
    role: roleEnum('role').notNull(),
    /** Switching a role off keeps the history; switching it back on reuses the row. */
    status: recordStatusEnum('status').notNull().default('active'),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('user_roles_user_supplier_role_uq').on(t.userId, t.supplierId, t.role),
    index('user_roles_supplier_idx').on(t.supplierId),
  ],
);

/** Refresh-token sessions. Only a hash of the token is stored. */
export const sessions = pgTable(
  'sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    supplierId: uuid('supplier_id')
      .notNull()
      .references(() => suppliers.id, { onDelete: 'restrict' }),
    role: roleEnum('role').notNull(),
    /** All tokens rotated from one login share a family; reuse of an old token revokes the family. */
    familyId: uuid('family_id').notNull(),
    refreshTokenHash: text('refresh_token_hash').notNull().unique(),
    userAgent: text('user_agent'),
    /** Staff sessions are bound to the device the PIN was set on. */
    deviceId: text('device_id'),
    createdAt: createdAt(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
  },
  (t) => [index('sessions_user_idx').on(t.userId), index('sessions_family_idx').on(t.familyId)],
);

/** OTP attempts. The code itself is never stored, only a hash. Used from Phase 3. */
export const otpRequests = pgTable(
  'otp_requests',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    phone: text('phone').notNull(),
    codeHash: text('code_hash').notNull(),
    attempts: integer('attempts').notNull().default(0),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    consumedAt: timestamp('consumed_at', { withTimezone: true }),
    ip: text('ip'),
    createdAt: createdAt(),
  },
  (t) => [index('otp_requests_phone_created_idx').on(t.phone, t.createdAt)],
);

/** Append-only record of important actions. UPDATE and DELETE are blocked by a trigger. */
export const auditLogs = pgTable(
  'audit_logs',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    supplierId: uuid('supplier_id').references(() => suppliers.id, { onDelete: 'restrict' }),
    actorUserId: uuid('actor_user_id').references(() => users.id, { onDelete: 'restrict' }),
    actorRole: text('actor_role'),
    action: text('action').notNull(),
    entityType: text('entity_type').notNull(),
    entityId: text('entity_id'),
    before: jsonb('before'),
    after: jsonb('after'),
    requestId: text('request_id'),
    ip: text('ip'),
    createdAt: createdAt(),
  },
  (t) => [
    index('audit_logs_supplier_created_idx').on(t.supplierId, t.createdAt),
    index('audit_logs_entity_idx').on(t.entityType, t.entityId),
  ],
);

/** Stored results of mutating requests, so a retried request is not applied twice. */
export const idempotencyKeys = pgTable(
  'idempotency_keys',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    key: text('key').notNull(),
    method: text('method').notNull(),
    path: text('path').notNull(),
    requestHash: text('request_hash').notNull(),
    state: idempotencyStateEnum('state').notNull().default('in_progress'),
    responseStatus: integer('response_status'),
    responseBody: jsonb('response_body'),
    createdAt: createdAt(),
    expiresAt: timestamp('expires_at', { withTimezone: true })
      .notNull()
      .default(sql`now() + interval '24 hours'`),
  },
  (t) => [
    uniqueIndex('idempotency_keys_user_key_uq').on(t.userId, t.key),
    index('idempotency_keys_expires_idx').on(t.expiresAt),
  ],
);

/** Per-supplier business settings (delivery charge, deposit, cut-off, …). */
export const settings = pgTable(
  'settings',
  {
    supplierId: uuid('supplier_id')
      .notNull()
      .references(() => suppliers.id, { onDelete: 'restrict' }),
    key: text('key').notNull(),
    value: jsonb('value').notNull(),
    updatedAt: updatedAt(),
    updatedBy: uuid('updated_by').references(() => users.id, { onDelete: 'restrict' }),
  },
  (t) => [primaryKey({ columns: [t.supplierId, t.key] })],
);

// ---------------------------------------------------------------- Phase 3

/** Areas the supplier delivers to. A new address must be inside one (by PIN code). */
export const serviceAreas = pgTable(
  'service_areas',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    supplierId: uuid('supplier_id')
      .notNull()
      .references(() => suppliers.id, { onDelete: 'restrict' }),
    name: text('name').notNull(),
    nameMl: text('name_ml'),
    pincodes: text('pincodes').array().notNull(),
    status: recordStatusEnum('status').notNull().default('active'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('service_areas_supplier_name_uq').on(t.supplierId, t.name)],
);

/** A user's customer record with one supplier. Created on first sign-in or by the office. */
export const customers = pgTable(
  'customers',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    supplierId: uuid('supplier_id')
      .notNull()
      .references(() => suppliers.id, { onDelete: 'restrict' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    type: customerTypeEnum('type').notNull().default('household'),
    status: recordStatusEnum('status').notNull().default('active'),
    /** DPDP Act consent: when and which version of the privacy notice was accepted. */
    privacyAcceptedAt: timestamp('privacy_accepted_at', { withTimezone: true }),
    privacyVersion: text('privacy_version'),
    /** Who created the record: the customer in the app, or an office user (A-01). */
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'restrict' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('customers_supplier_user_uq').on(t.supplierId, t.userId),
    index('customers_supplier_idx').on(t.supplierId),
  ],
);

/** Delivery addresses. Removed addresses are archived, not deleted, so old orders keep them. */
export const addresses = pgTable(
  'addresses',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    supplierId: uuid('supplier_id')
      .notNull()
      .references(() => suppliers.id, { onDelete: 'restrict' }),
    customerId: uuid('customer_id')
      .notNull()
      .references(() => customers.id, { onDelete: 'restrict' }),
    serviceAreaId: uuid('service_area_id')
      .notNull()
      .references(() => serviceAreas.id, { onDelete: 'restrict' }),
    label: text('label').notNull(),
    line: text('line').notNull(),
    landmark: text('landmark').notNull(),
    pincode: text('pincode').notNull(),
    latitude: doublePrecision('latitude'),
    longitude: doublePrecision('longitude'),
    deliveryNote: text('delivery_note'),
    isDefault: boolean('is_default').notNull().default(false),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('addresses_customer_idx').on(t.customerId),
    // At most one default address per customer.
    uniqueIndex('addresses_one_default_uq')
      .on(t.customerId)
      .where(sql`is_default and archived_at is null`),
  ],
);

/** A staff member's PIN on one phone (decision D-02: SMS code once, then PIN). */
export const staffDevices = pgTable(
  'staff_devices',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    supplierId: uuid('supplier_id')
      .notNull()
      .references(() => suppliers.id, { onDelete: 'restrict' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    deviceId: text('device_id').notNull(),
    pinHash: text('pin_hash').notNull(),
    failedAttempts: integer('failed_attempts').notNull().default(0),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('staff_devices_active_uq')
      .on(t.supplierId, t.userId, t.deviceId)
      .where(sql`revoked_at is null`),
  ],
);
