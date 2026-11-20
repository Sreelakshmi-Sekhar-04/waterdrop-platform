/**
 * Payments and corrections (Phase 6). Approved decisions: D-03 (pay later per customer with a
 * credit limit; warn, never block at the door), D-04 and M-05 (deposit per can held; refunded
 * when cans come back), M-04 (opening balances), M-22 (refunds are recorded), D-11 (monthly
 * statement), D-19 (no online gateway in the MVP: cash and UPI are recorded and checked).
 *
 * The portal and the API share these schemas and sums, so a preview always matches what is saved.
 */
import { z } from 'zod';
import { indianMobileSchema, normaliseMobileInput } from './schemas';
import { isoDateSchema } from './ordering';
import { personNameSchema } from './people';

/** The most one entry may move: ₹1,00,000. Larger amounts are almost always a typing mistake. */
export const MAX_ENTRY_PAISE = 10_000_000;

const amount = z.number().int().min(1).max(MAX_ENTRY_PAISE);
const reason = z.string().trim().min(3, 'Write a short reason').max(300);

/** A payment taken by the office (the customer paid at the depot, by UPI to the business, ...). */
export const officePaymentInputSchema = z.object({
  clientRequestId: z.uuid(),
  method: z.enum(['cash', 'upi']),
  amountPaise: amount,
  reference: z.string().trim().max(40).optional(),
  paidOn: isoDateSchema,
  note: z.string().trim().max(300).optional(),
});
export type OfficePaymentInput = z.infer<typeof officePaymentInputSchema>;

/** "Not received" (a UPI payment that never arrived, cash that was not handed over). */
export const reversePaymentInputSchema = z.object({ reason });

export const creditLimitInputSchema = z.object({
  creditLimitPaise: z.number().int().min(0).max(MAX_ENTRY_PAISE),
});

export const REFUND_METHODS = ['cash', 'upi', 'adjust'] as const;
export type RefundMethod = (typeof REFUND_METHODS)[number];

export const depositRefundInputSchema = z.object({
  clientRequestId: z.uuid(),
  cans: z.number().int().min(1).max(1000),
  /** `adjust`: the refund pays off what they owe instead of being handed over. */
  method: z.enum(REFUND_METHODS),
  reason: z.string().trim().max(300).optional(),
});
export type DepositRefundInput = z.infer<typeof depositRefundInputSchema>;

/**
 * Deposit for cans that came back. Only cans the deposit covers and the customer no longer holds
 * can be refunded; the amount is their share of the deposit actually held (so a price change in
 * between never refunds more than was paid).
 */
export function depositRefund(p: {
  cans: number;
  cansHeld: number;
  depositHeldPaise: number;
  depositCoverCans: number;
}): { refundableCans: number; amountPaise: number } {
  const refundableCans = Math.max(0, p.depositCoverCans - p.cansHeld);
  if (p.cans < 1 || p.cans > refundableCans || p.depositCoverCans === 0)
    return { refundableCans, amountPaise: 0 };
  const amountPaise =
    p.cans === p.depositCoverCans
      ? p.depositHeldPaise
      : Math.floor((p.depositHeldPaise * p.cans) / p.depositCoverCans);
  return { refundableCans, amountPaise };
}

/**
 * The office corrects a customer's balances to what is true. Only the fields given change; each
 * difference is posted as an adjustment entry with the reason (entries are never edited).
 */
export const balanceCorrectionInputSchema = z
  .object({
    cansHeld: z.number().int().min(0).max(1000).optional(),
    depositHeldPaise: z.number().int().min(0).max(MAX_ENTRY_PAISE).optional(),
    depositCoverCans: z.number().int().min(0).max(1000).optional(),
    /** Positive: they owe. Negative: paid in advance. */
    balancePaise: z.number().int().min(-MAX_ENTRY_PAISE).max(MAX_ENTRY_PAISE).optional(),
    reason,
  })
  .refine(
    (v) =>
      v.cansHeld !== undefined ||
      v.depositHeldPaise !== undefined ||
      v.depositCoverCans !== undefined ||
      v.balancePaise !== undefined,
    { message: 'Change at least one balance' },
  );
export type BalanceCorrectionInput = z.infer<typeof balanceCorrectionInputSchema>;

export const monthSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Use YYYY-MM');

/** First day of the month and of the next month, as dates (YYYY-MM-DD). */
export function monthRange(month: string): { from: string; to: string } {
  const [y, m] = month.split('-').map(Number) as [number, number];
  const next = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
  return { from: `${month}-01`, to: `${next}-01` };
}

export function addMonths(month: string, n: number): string {
  const [y, m] = month.split('-').map(Number) as [number, number];
  const i = y * 12 + (m - 1) + n;
  return `${Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, '0')}`;
}

// ---------------------------------------------------------------- opening balances (M-04)

/** One customer's balances on the day WtrDrop starts. Money is in paise. */
export const openingRowSchema = z.object({
  phone: indianMobileSchema,
  name: personNameSchema.optional(),
  cansHeld: z.number().int().min(0).max(1000),
  depositHeldPaise: z.number().int().min(0).max(MAX_ENTRY_PAISE),
  depositCoverCans: z.number().int().min(0).max(1000),
  /** Positive: they owe. Negative: paid in advance. */
  duePaise: z.number().int().min(-MAX_ENTRY_PAISE).max(MAX_ENTRY_PAISE),
});
export type OpeningRow = z.infer<typeof openingRowSchema>;

export const OPENING_CSV_HEADER = 'phone,name,cans_held,deposit_rupees,deposit_cans,due_rupees';
export const OPENING_MAX_ROWS = 2000;

export interface OpeningParse {
  rows: { line: number; row: OpeningRow }[];
  errors: { line: number; message: string }[];
}

function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') {
      out.push(cur);
      cur = '';
    } else cur += ch;
  }
  out.push(cur);
  return out.map((c) => c.trim());
}

const wholeNumber = (v: string) => (/^\d+$/.test(v) ? Number(v) : NaN);
/** "1,240.50" or "-300" rupees → paise. Empty means 0. */
function rupees(v: string): number {
  const t = v.replace(/[₹,\s]/g, '');
  if (t === '') return 0;
  if (!/^-?\d+(\.\d{1,2})?$/.test(t)) return NaN;
  return Math.round(Number(t) * 100);
}

/**
 * Reads the opening-balance spreadsheet (saved as CSV, the header row first). Blank lines are
 * skipped; every other line becomes a row or an error with its line number.
 */
export function parseOpeningCsv(text: string): OpeningParse {
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/);
  const result: OpeningParse = { rows: [], errors: [] };
  const header = splitCsvLine(lines[0] ?? '').map((h) => h.toLowerCase());
  const want = OPENING_CSV_HEADER.split(',');
  if (want.some((h, i) => header[i] !== h)) {
    result.errors.push({ line: 1, message: `The first line must be: ${OPENING_CSV_HEADER}` });
    return result;
  }
  const seen = new Set<string>();
  for (let i = 1; i < lines.length; i++) {
    const raw = lines[i]!;
    if (!raw.trim()) continue;
    const line = i + 1;
    const [phone = '', name = '', cans = '', depositRs = '', depositCans = '', dueRs = ''] =
      splitCsvLine(raw);
    const candidate = {
      phone: normaliseMobileInput(phone),
      name: name || undefined,
      cansHeld: cans === '' ? 0 : wholeNumber(cans),
      depositHeldPaise: rupees(depositRs),
      depositCoverCans: depositCans === '' ? 0 : wholeNumber(depositCans),
      duePaise: rupees(dueRs),
    };
    const parsed = openingRowSchema.safeParse(candidate);
    if (!parsed.success) {
      const issue = parsed.error.issues[0]!;
      result.errors.push({ line, message: `${String(issue.path[0] ?? '')}: ${issue.message}` });
      continue;
    }
    if (parsed.data.depositHeldPaise > 0 && parsed.data.depositCoverCans === 0) {
      result.errors.push({ line, message: 'deposit_cans: say how many cans the deposit covers' });
      continue;
    }
    if (seen.has(parsed.data.phone)) {
      result.errors.push({ line, message: 'phone: this number is already on an earlier line' });
      continue;
    }
    seen.add(parsed.data.phone);
    result.rows.push({ line, row: parsed.data });
  }
  if (result.rows.length + result.errors.length > OPENING_MAX_ROWS)
    result.errors.unshift({ line: 0, message: `At most ${OPENING_MAX_ROWS} customers at a time` });
  return result;
}

export const openingImportInputSchema = z.object({
  rows: z
    .array(openingRowSchema.extend({ line: z.number().int().min(1) }))
    .min(1)
    .max(OPENING_MAX_ROWS),
  /** true: only check and report; nothing is saved. */
  dryRun: z.boolean(),
});
export type OpeningImportInput = z.infer<typeof openingImportInputSchema>;
