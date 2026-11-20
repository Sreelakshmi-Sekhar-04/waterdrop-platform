/**
 * Phase 1 platform tables, Phase 3 users and addresses, Phase 4 ordering, Phase 5 delivery and
 * ledgers. Business tables
 * (orders, ledgers, …) are added in the phase that builds each feature,
 * following the ERD in docs/PHASE-0-ANALYSIS.md §9.
 *
 * Conventions: uuid primary keys, timestamptz everywhere, money in integer
 * paise, every tenant-owned row carries supplier_id.
 */
import { sql } from 'drizzle-orm';
import {
  bigint,
  bigserial,
  boolean,
  check,
  date,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import {
  FAILURE_REASONS,
  ORDER_CHANNELS,
  ORDER_STATUSES,
  PAYMENT_METHODS,
  ROLES,
  TRIP_STATUSES,
} from '@wtrdrop/shared';

const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();
const updatedAt = () => timestamp('updated_at', { withTimezone: true }).notNull().defaultNow();

export const roleEnum = pgEnum('role', ROLES);
export const recordStatusEnum = pgEnum('record_status', ['active', 'disabled']);
export const languageEnum = pgEnum('language', ['en', 'ml']);
export const idempotencyStateEnum = pgEnum('idempotency_state', ['in_progress', 'completed']);
export const customerTypeEnum = pgEnum('customer_type', ['household', 'office', 'shop']);
export const orderStatusEnum = pgEnum('order_status', ORDER_STATUSES);
export const orderChannelEnum = pgEnum('order_channel', ORDER_CHANNELS);
export const tripStatusEnum = pgEnum('trip_status', TRIP_STATUSES);
export const attemptOutcomeEnum = pgEnum('attempt_outcome', ['delivered', 'failed']);
export const failureReasonEnum = pgEnum('failure_reason', FAILURE_REASONS);
export const paymentMethodEnum = pgEnum('payment_method', PAYMENT_METHODS);
export const canEntryEnum = pgEnum('can_entry_type', [
  'delivery',
  'return',
  'reversal',
  'opening',
  'adjustment',
]);
export const depositEntryEnum = pgEnum('deposit_entry_type', [
  'charge',
  'reversal',
  'refund',
  'opening',
  'adjustment',
]);
export const accountEntryEnum = pgEnum('account_entry_type', [
  'delivery_charge',
  'payment',
  'reversal',
  'opening',
  'adjustment',
]);
export const stockPlaceEnum = pgEnum('stock_place', [
  'depot',
  'trip',
  'customer',
  'damaged',
  'outside',
]);
export const canStateEnum = pgEnum('can_state', ['full', 'empty', 'damaged']);

/** A water supplier (tenant). One row at launch; the design allows more later. */
export const suppliers = pgTable('suppliers', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  slug: text('slug').notNull().unique(),
  status: recordStatusEnum('status').notNull().default('active'),
  gstin: text('gstin'),
  fssaiNo: text('fssai_no'),
  /** Next human-readable order number (WD-1001, …), taken with an atomic UPDATE … RETURNING. */
  nextOrderNo: integer('next_order_no').notNull().default(1001),
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
    /** D-12: delivery charge for this area; null = the business-wide setting. */
    deliveryChargePaise: integer('delivery_charge_paise'),
    /** D-12: no charge when an order has more than this many cans; null = the setting, 0 = never free. */
    freeAboveCans: integer('free_above_cans'),
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
    /**
     * Cached balances, always equal to the sum of the matching ledger (Phase 5). Written only in
     * the same transaction as a ledger entry, with this row locked.
     */
    cansHeld: integer('cans_held').notNull().default(0),
    depositHeldPaise: integer('deposit_held_paise').notNull().default(0),
    depositCoverCans: integer('deposit_cover_cans').notNull().default(0),
    /** Money owed (positive) or paid in advance (negative). */
    balancePaise: integer('balance_paise').notNull().default(0),
    /** D-03: dues above this are flagged to the office. Never blocks a delivery. */
    creditLimitPaise: integer('credit_limit_paise').notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('customers_supplier_user_uq').on(t.supplierId, t.userId),
    index('customers_supplier_idx').on(t.supplierId),
    check(
      'customers_balances_ck',
      sql`cans_held >= 0 and deposit_held_paise >= 0 and deposit_cover_cans >= 0 and credit_limit_paise >= 0`,
    ),
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

// ---------------------------------------------------------------- Phase 4: ordering

/** What the business sells. At launch one row: the 20-litre can. */
export const products = pgTable(
  'products',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    supplierId: uuid('supplier_id')
      .notNull()
      .references(() => suppliers.id, { onDelete: 'restrict' }),
    sku: text('sku').notNull(),
    nameEn: text('name_en').notNull(),
    nameMl: text('name_ml').notNull(),
    /** A returnable can is counted in the can ledger and needs a deposit (Phase 5). */
    isReturnableCan: boolean('is_returnable_can').notNull().default(true),
    status: recordStatusEnum('status').notNull().default('active'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('products_supplier_sku_uq').on(t.supplierId, t.sku)],
);

/**
 * Effective-dated standard prices. The price on a date is the row with the latest valid_from on or
 * before it, so history is never rewritten and a price can be scheduled ahead.
 */
export const productPrices = pgTable(
  'product_prices',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    supplierId: uuid('supplier_id')
      .notNull()
      .references(() => suppliers.id, { onDelete: 'restrict' }),
    productId: uuid('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'restrict' }),
    pricePaise: integer('price_paise').notNull(),
    validFrom: date('valid_from', { mode: 'string' }).notNull(),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'restrict' }),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('product_prices_from_uq').on(t.productId, t.validFrom),
    check('product_prices_price_ck', sql`price_paise >= 0`),
  ],
);

/** D-11: a negotiated price for one customer, effective-dated. A null price means "back to standard". */
export const customerPrices = pgTable(
  'customer_prices',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    supplierId: uuid('supplier_id')
      .notNull()
      .references(() => suppliers.id, { onDelete: 'restrict' }),
    customerId: uuid('customer_id')
      .notNull()
      .references(() => customers.id, { onDelete: 'restrict' }),
    productId: uuid('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'restrict' }),
    pricePaise: integer('price_paise'),
    validFrom: date('valid_from', { mode: 'string' }).notNull(),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'restrict' }),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('customer_prices_from_uq').on(t.customerId, t.productId, t.validFrom),
    check('customer_prices_price_ck', sql`price_paise is null or price_paise >= 0`),
  ],
);

/** D-07: broad delivery windows (morning, afternoon, evening) with a default capacity in cans (D-08). */
export const deliveryWindows = pgTable(
  'delivery_windows',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    supplierId: uuid('supplier_id')
      .notNull()
      .references(() => suppliers.id, { onDelete: 'restrict' }),
    nameEn: text('name_en').notNull(),
    nameMl: text('name_ml').notNull(),
    /** Local time in India, HH:MM. */
    startTime: text('start_time').notNull(),
    endTime: text('end_time').notNull(),
    capacityCans: integer('capacity_cans').notNull(),
    /** 0 = Sunday … 6 = Saturday. */
    daysOfWeek: integer('days_of_week').array().notNull(),
    status: recordStatusEnum('status').notNull().default('active'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('delivery_windows_supplier_name_uq').on(t.supplierId, t.nameEn),
    check('delivery_windows_time_ck', sql`start_time < end_time`),
    check('delivery_windows_capacity_ck', sql`capacity_cans >= 0`),
  ],
);

/**
 * Cans booked per window per date. Rows are created on first booking. Booking uses one conditional
 * UPDATE (reserved + qty <= capacity), so two customers can never both take the last cans.
 */
export const windowBookings = pgTable(
  'window_bookings',
  {
    supplierId: uuid('supplier_id')
      .notNull()
      .references(() => suppliers.id, { onDelete: 'restrict' }),
    windowId: uuid('window_id')
      .notNull()
      .references(() => deliveryWindows.id, { onDelete: 'restrict' }),
    date: date('date', { mode: 'string' }).notNull(),
    /** A different capacity for this date only; null = the window's default. */
    capacityCans: integer('capacity_cans'),
    reservedCans: integer('reserved_cans').notNull().default(0),
    updatedAt: updatedAt(),
  },
  (t) => [
    primaryKey({ columns: [t.windowId, t.date] }),
    check('window_bookings_reserved_ck', sql`reserved_cans >= 0`),
    check('window_bookings_capacity_ck', sql`capacity_cans is null or capacity_cans >= 0`),
  ],
);

/** M-12: days (or one window on a day) when the business does not deliver. */
export const closedDays = pgTable(
  'closed_days',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    supplierId: uuid('supplier_id')
      .notNull()
      .references(() => suppliers.id, { onDelete: 'restrict' }),
    date: date('date', { mode: 'string' }).notNull(),
    /** Null = the whole day. */
    windowId: uuid('window_id').references(() => deliveryWindows.id, { onDelete: 'restrict' }),
    reason: text('reason').notNull(),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'restrict' }),
    createdAt: createdAt(),
  },
  (t) => [unique('closed_days_uq').on(t.supplierId, t.date, t.windowId).nullsNotDistinct()],
);

export const orders = pgTable(
  'orders',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    supplierId: uuid('supplier_id')
      .notNull()
      .references(() => suppliers.id, { onDelete: 'restrict' }),
    orderNo: integer('order_no').notNull(),
    customerId: uuid('customer_id')
      .notNull()
      .references(() => customers.id, { onDelete: 'restrict' }),
    addressId: uuid('address_id')
      .notNull()
      .references(() => addresses.id, { onDelete: 'restrict' }),
    /** The address as it was when the order was placed (later edits never change history). */
    addressSnapshot: jsonb('address_snapshot').notNull(),
    serviceAreaId: uuid('service_area_id')
      .notNull()
      .references(() => serviceAreas.id, { onDelete: 'restrict' }),
    windowId: uuid('window_id')
      .notNull()
      .references(() => deliveryWindows.id, { onDelete: 'restrict' }),
    deliveryDate: date('delivery_date', { mode: 'string' }).notNull(),
    status: orderStatusEnum('status').notNull(),
    channel: orderChannelEnum('channel').notNull(),
    /** Cans ordered (all products together; one product at launch). Booked against window capacity. */
    totalQty: integer('total_qty').notNull(),
    subtotalPaise: integer('subtotal_paise').notNull(),
    deliveryChargePaise: integer('delivery_charge_paise').notNull(),
    /** Estimate shown at ordering; the deposit is charged at delivery from the can ledger (Phase 5). */
    depositPaise: integer('deposit_paise').notNull(),
    totalPaise: integer('total_paise').notNull(),
    note: text('note'),
    /** Duplicate guard: one order per id generated by the order screen. */
    clientRequestId: uuid('client_request_id').notNull(),
    placedBy: uuid('placed_by')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    /** Whether the window's capacity is still held (released on cancel or reject). */
    capacityHeld: boolean('capacity_held').notNull().default(true),
    /** Phase 5: the route this order is on, and its place in the route. */
    tripId: uuid('trip_id').references(() => trips.id, { onDelete: 'restrict' }),
    stopSeq: integer('stop_seq'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('orders_supplier_no_uq').on(t.supplierId, t.orderNo),
    uniqueIndex('orders_customer_request_uq').on(t.customerId, t.clientRequestId),
    index('orders_supplier_date_status_idx').on(t.supplierId, t.deliveryDate, t.status),
    index('orders_customer_idx').on(t.customerId, t.createdAt),
    index('orders_trip_idx').on(t.tripId, t.stopSeq),
    check(
      'orders_money_ck',
      sql`subtotal_paise >= 0 and delivery_charge_paise >= 0 and deposit_paise >= 0 and total_paise = subtotal_paise + delivery_charge_paise + deposit_paise`,
    ),
    check('orders_qty_ck', sql`total_qty > 0`),
  ],
);

export const orderItems = pgTable(
  'order_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orderId: uuid('order_id')
      .notNull()
      .references(() => orders.id, { onDelete: 'restrict' }),
    productId: uuid('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'restrict' }),
    qtyOrdered: integer('qty_ordered').notNull(),
    /** Filled at delivery (Phase 5). */
    qtyDelivered: integer('qty_delivered'),
    /** Price snapshot at placement (M-21). */
    unitPricePaise: integer('unit_price_paise').notNull(),
    depositPerCanPaise: integer('deposit_per_can_paise').notNull(),
    depositCans: integer('deposit_cans').notNull(),
  },
  (t) => [
    uniqueIndex('order_items_order_product_uq').on(t.orderId, t.productId),
    check('order_items_qty_ck', sql`qty_ordered > 0`),
  ],
);

/** Every status change, with who made it and why. Append-only like the audit log. */
export const orderStatusHistory = pgTable(
  'order_status_history',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    supplierId: uuid('supplier_id')
      .notNull()
      .references(() => suppliers.id, { onDelete: 'restrict' }),
    orderId: uuid('order_id')
      .notNull()
      .references(() => orders.id, { onDelete: 'restrict' }),
    fromStatus: orderStatusEnum('from_status'),
    toStatus: orderStatusEnum('to_status').notNull(),
    /** Null for automatic changes (auto-accept). */
    actorUserId: uuid('actor_user_id').references(() => users.id, { onDelete: 'restrict' }),
    actorRole: text('actor_role').notNull(),
    reason: text('reason'),
    at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('order_status_history_order_idx').on(t.orderId, t.at)],
);

// ------------------------------------------------------------------ Phase 5: delivery and ledgers

/** One delivery person's route for one day (load-out, stops, day-end and reconciliation, M-03). */
export const trips = pgTable(
  'trips',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    supplierId: uuid('supplier_id')
      .notNull()
      .references(() => suppliers.id, { onDelete: 'restrict' }),
    staffUserId: uuid('staff_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    date: date('date', { mode: 'string' }).notNull(),
    status: tripStatusEnum('status').notNull().default('planned'),
    /** Full cans the delivery person confirmed loading at the start. */
    loadFull: integer('load_full'),
    startedAt: timestamp('started_at', { withTimezone: true }),
    endedAt: timestamp('ended_at', { withTimezone: true }),
    /** Day-end: what the app expected back, and what was counted. */
    expectedFull: integer('expected_full'),
    expectedEmpty: integer('expected_empty'),
    expectedCashPaise: integer('expected_cash_paise'),
    returnFull: integer('return_full'),
    returnEmpty: integer('return_empty'),
    returnDamaged: integer('return_damaged'),
    cashHandedPaise: integer('cash_handed_paise'),
    endNote: text('end_note'),
    reconciledBy: uuid('reconciled_by').references(() => users.id, { onDelete: 'restrict' }),
    reconciledAt: timestamp('reconciled_at', { withTimezone: true }),
    reconcileNote: text('reconcile_note'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('trips_staff_date_uq').on(t.supplierId, t.staffUserId, t.date),
    index('trips_supplier_date_idx').on(t.supplierId, t.date),
  ],
);

/** Each try at a stop: delivered (with counts and payment) or couldn't deliver (D-05). */
export const deliveryAttempts = pgTable(
  'delivery_attempts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    supplierId: uuid('supplier_id')
      .notNull()
      .references(() => suppliers.id, { onDelete: 'restrict' }),
    orderId: uuid('order_id')
      .notNull()
      .references(() => orders.id, { onDelete: 'restrict' }),
    tripId: uuid('trip_id')
      .notNull()
      .references(() => trips.id, { onDelete: 'restrict' }),
    staffUserId: uuid('staff_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    outcome: attemptOutcomeEnum('outcome').notNull(),
    failureReason: failureReasonEnum('failure_reason'),
    note: text('note'),
    fullDelivered: integer('full_delivered').notNull().default(0),
    emptyCollected: integer('empty_collected').notNull().default(0),
    /** Empties beyond what the customer held (R-07): received, but not taken off their balance. */
    extraEmpties: integer('extra_empties').notNull().default(0),
    chargePaise: integer('charge_paise').notNull().default(0),
    depositCans: integer('deposit_cans').notNull().default(0),
    depositPaise: integer('deposit_paise').notNull().default(0),
    paymentMethod: paymentMethodEnum('payment_method'),
    amountCollectedPaise: integer('amount_collected_paise').notNull().default(0),
    /** Dues went above the customer's credit limit with this stop (flag for the office, D-03). */
    overCreditLimit: boolean('over_credit_limit').notNull().default(false),
    latitude: doublePrecision('latitude'),
    longitude: doublePrecision('longitude'),
    /** When it happened on the phone (may be earlier than recordedAt after offline use). */
    happenedAt: timestamp('happened_at', { withTimezone: true }).notNull(),
    recordedAt: timestamp('recorded_at', { withTimezone: true }).notNull().defaultNow(),
    /** Offline replay guard: the phone sends the same id until the server answers. */
    clientActionId: uuid('client_action_id').notNull(),
    undoneAt: timestamp('undone_at', { withTimezone: true }),
    undoneBy: uuid('undone_by').references(() => users.id, { onDelete: 'restrict' }),
  },
  (t) => [
    uniqueIndex('delivery_attempts_action_uq').on(t.supplierId, t.clientActionId),
    index('delivery_attempts_order_idx').on(t.orderId, t.recordedAt),
    index('delivery_attempts_trip_idx').on(t.tripId),
    check(
      'delivery_attempts_counts_ck',
      sql`full_delivered >= 0 and empty_collected >= 0 and extra_empties >= 0 and charge_paise >= 0 and deposit_paise >= 0 and amount_collected_paise >= 0`,
    ),
  ],
);

const ledgerCommon = () => ({
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  supplierId: uuid('supplier_id')
    .notNull()
    .references(() => suppliers.id, { onDelete: 'restrict' }),
  customerId: uuid('customer_id')
    .notNull()
    .references(() => customers.id, { onDelete: 'restrict' }),
  orderId: uuid('order_id').references(() => orders.id, { onDelete: 'restrict' }),
  attemptId: uuid('attempt_id').references(() => deliveryAttempts.id, { onDelete: 'restrict' }),
  reason: text('reason'),
  actorUserId: uuid('actor_user_id').references(() => users.id, { onDelete: 'restrict' }),
  at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
});

/** Cans the customer holds: +full delivered, −empties returned. Append-only (trigger). */
export const canLedger = pgTable(
  'can_ledger',
  {
    ...ledgerCommon(),
    entryType: canEntryEnum('entry_type').notNull(),
    delta: integer('delta').notNull(),
    balanceAfter: integer('balance_after').notNull(),
    reversesEntryId: bigint('reverses_entry_id', { mode: 'number' }),
  },
  (t) => [
    index('can_ledger_customer_idx').on(t.customerId, t.id),
    check('can_ledger_balance_ck', sql`balance_after >= 0`),
  ],
);

/** Refundable deposit the business holds, and how many cans it covers (D-04). */
export const depositLedger = pgTable(
  'deposit_ledger',
  {
    ...ledgerCommon(),
    entryType: depositEntryEnum('entry_type').notNull(),
    deltaPaise: integer('delta_paise').notNull(),
    deltaCans: integer('delta_cans').notNull(),
    balanceAfterPaise: integer('balance_after_paise').notNull(),
    coverAfterCans: integer('cover_after_cans').notNull(),
    reversesEntryId: bigint('reverses_entry_id', { mode: 'number' }),
  },
  (t) => [index('deposit_ledger_customer_idx').on(t.customerId, t.id)],
);

/** Money: +charges for deliveries, −payments. The balance is what the customer owes (M-02). */
export const accountLedger = pgTable(
  'account_ledger',
  {
    ...ledgerCommon(),
    entryType: accountEntryEnum('entry_type').notNull(),
    deltaPaise: integer('delta_paise').notNull(),
    balanceAfterPaise: integer('balance_after_paise').notNull(),
    paymentId: uuid('payment_id').references(() => payments.id, { onDelete: 'restrict' }),
    reversesEntryId: bigint('reverses_entry_id', { mode: 'number' }),
  },
  (t) => [index('account_ledger_customer_idx').on(t.customerId, t.id)],
);

/** Money received (cash or UPI). Verification against the bank comes in Phase 6. */
export const payments = pgTable(
  'payments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    supplierId: uuid('supplier_id')
      .notNull()
      .references(() => suppliers.id, { onDelete: 'restrict' }),
    customerId: uuid('customer_id')
      .notNull()
      .references(() => customers.id, { onDelete: 'restrict' }),
    method: paymentMethodEnum('method').notNull(),
    amountPaise: integer('amount_paise').notNull(),
    /** UPI reference or last digits, as the delivery person typed it. */
    reference: text('reference'),
    collectedBy: uuid('collected_by')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    tripId: uuid('trip_id').references(() => trips.id, { onDelete: 'restrict' }),
    attemptId: uuid('attempt_id').references(() => deliveryAttempts.id, { onDelete: 'restrict' }),
    /** Set when an undo reverses it; the row itself stays. */
    reversedAt: timestamp('reversed_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    index('payments_customer_idx').on(t.customerId, t.createdAt),
    index('payments_trip_idx').on(t.tripId),
    check('payments_amount_ck', sql`amount_paise > 0 and method <> 'later'`),
  ],
);

/**
 * Every physical can movement between places (depot, a route's van, a customer, damaged, outside
 * the business). Counts per place are sums of these rows. Append-only (trigger).
 */
export const stockMovements = pgTable(
  'stock_movements',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    supplierId: uuid('supplier_id')
      .notNull()
      .references(() => suppliers.id, { onDelete: 'restrict' }),
    fromPlace: stockPlaceEnum('from_place').notNull(),
    fromState: canStateEnum('from_state').notNull(),
    toPlace: stockPlaceEnum('to_place').notNull(),
    toState: canStateEnum('to_state').notNull(),
    qty: integer('qty').notNull(),
    /** load_out, delivery, pickup, day_end, filled, count, bought, undo */
    kind: text('kind').notNull(),
    tripId: uuid('trip_id').references(() => trips.id, { onDelete: 'restrict' }),
    attemptId: uuid('attempt_id').references(() => deliveryAttempts.id, { onDelete: 'restrict' }),
    customerId: uuid('customer_id').references(() => customers.id, { onDelete: 'restrict' }),
    note: text('note'),
    actorUserId: uuid('actor_user_id').references(() => users.id, { onDelete: 'restrict' }),
    at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('stock_movements_supplier_idx').on(t.supplierId, t.at),
    index('stock_movements_trip_idx').on(t.tripId),
    check('stock_movements_qty_ck', sql`qty > 0`),
  ],
);
