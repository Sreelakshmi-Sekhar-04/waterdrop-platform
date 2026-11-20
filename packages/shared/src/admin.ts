/**
 * Admin and reports (Phase 7): complaints, customer messages, the six core reports (Phase 0
 * §13.3), the activity log filters and the business details. The portal, the app and the API share
 * these names and schemas.
 */
import { z } from 'zod';
import { isoDateSchema } from './ordering';

// ---------------------------------------------------------------- complaints

/** The problems the Help screen offers (Phase 2 design), plus "something else". */
export const COMPLAINT_CATEGORIES = [
  'CAN_COUNT',
  'WATER_QUALITY',
  'LATE',
  'PAYMENT',
  'OTHER',
] as const;
export type ComplaintCategory = (typeof COMPLAINT_CATEGORIES)[number];
export const COMPLAINT_STATUSES = ['open', 'resolved'] as const;
export type ComplaintStatus = (typeof COMPLAINT_STATUSES)[number];

export const complaintInputSchema = z
  .object({
    clientRequestId: z.uuid(),
    category: z.enum(COMPLAINT_CATEGORIES),
    orderId: z.uuid().optional(),
    note: z.string().trim().max(500).optional(),
  })
  .refine((v) => v.category !== 'OTHER' || (v.note ?? '').length >= 3, {
    message: 'Tell us what went wrong',
    path: ['note'],
  });
export type ComplaintInput = z.infer<typeof complaintInputSchema>;

export const resolveComplaintInputSchema = z.object({
  resolution: z.string().trim().min(3, 'Write what was done').max(500),
});

// ---------------------------------------------------------------- messages to customers

/**
 * What a customer is told. The text is written from the kind and its values in the reader's
 * language, so a message stays correct if they switch language later.
 */
export const NOTIFICATION_KINDS = [
  'out_for_delivery',
  'delivered',
  'not_delivered',
  'order_cancelled',
  'dues_reminder',
  'complaint_resolved',
] as const;
export type NotificationKind = (typeof NOTIFICATION_KINDS)[number];

/** A reminder about dues is sent at most once in this many hours per customer. */
export const DUES_REMINDER_GAP_HOURS = 24;

export const pushTokenInputSchema = z.object({
  token: z
    .string()
    .trim()
    .regex(/^(Expo|Exponent)PushToken\[[A-Za-z0-9_-]{10,}\]$/, 'Not an Expo push token'),
  platform: z.enum(['android', 'ios']),
});

// ---------------------------------------------------------------- reports

/** Phase 0 §13.3: the six core reports. */
export const REPORTS = ['sales', 'dues', 'cans', 'staff', 'deliveries', 'stock'] as const;
export type ReportName = (typeof REPORTS)[number];
/** Reports that cover a date range; the others are "as of now". */
export const DATED_REPORTS: readonly ReportName[] = ['sales', 'staff', 'deliveries', 'stock'];
/** The longest range one report may cover. */
export const REPORT_MAX_DAYS = 366;

export const reportQuerySchema = z.object({
  from: isoDateSchema.optional(),
  to: isoDateSchema.optional(),
  format: z.enum(['json', 'csv']).default('json'),
});

/** Days owed or held, grouped the way the owner chases them. */
export const AGE_BUCKETS = ['0-7', '8-30', '31-60', '61+'] as const;
export type AgeBucket = (typeof AGE_BUCKETS)[number];
export function ageBucket(days: number): AgeBucket {
  if (days <= 7) return '0-7';
  if (days <= 30) return '8-30';
  if (days <= 60) return '31-60';
  return '61+';
}

/** Whole days from one ISO date to another (both YYYY-MM-DD). */
export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

/**
 * CSV for spreadsheets (RFC 4180, CRLF). A cell that starts with = + - @ is prefixed with ' so a
 * name like "=HYPERLINK(...)" is shown as text, never run as a formula (CSV injection).
 */
export function toCsv(header: string[], rows: (string | number | boolean | null | undefined)[][]) {
  const cell = (v: string | number | boolean | null | undefined) => {
    if (v === null || v === undefined) return '';
    let s = String(v);
    if (typeof v === 'string' && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [header, ...rows].map((r) => r.map(cell).join(',')).join('\r\n') + '\r\n';
}

// ---------------------------------------------------------------- activity log

export const auditQuerySchema = z.object({
  from: isoDateSchema.optional(),
  to: isoDateSchema.optional(),
  /** The start of an action name, e.g. "payment" or "order.cancel". */
  action: z
    .string()
    .trim()
    .regex(/^[a-z_.]{1,60}$/)
    .optional(),
  entityType: z
    .string()
    .trim()
    .regex(/^[a-z_]{1,40}$/)
    .optional(),
  entityId: z.string().trim().max(80).optional(),
  actorUserId: z.uuid().optional(),
  /** Older than this id (for "Show more"). */
  before: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

// ---------------------------------------------------------------- business details

/** GSTIN: 2-digit state code, PAN (10), entity number, Z, check character. */
export const gstinSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/, 'Not a valid GSTIN');

export const businessInputSchema = z
  .object({
    name: z.string().trim().min(2).max(80),
    gstin: gstinSchema.nullable(),
    fssaiNo: z
      .string()
      .trim()
      .regex(/^\d{14}$/, 'FSSAI licence numbers have 14 digits')
      .nullable(),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, 'Send at least one detail to change');
