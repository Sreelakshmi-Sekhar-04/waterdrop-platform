/**
 * Ordering rules shared by the API and both apps (Phase 4).
 * Decisions: D-07 broad delivery windows, same day before the cut-off; D-08 capacity per window;
 * D-10 default quantity = last ordered, max per order from settings; D-12 delivery charge per area,
 * free above N cans. The server always recomputes prices; the apps use these to show the same numbers.
 */
import { z } from 'zod';

/** The business runs on Indian time; dates are plain YYYY-MM-DD strings in Asia/Kolkata. */
export const BUSINESS_TIME_ZONE = 'Asia/Kolkata';
const IST_OFFSET_MINUTES = 330; // India has no daylight saving

export const isoDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD')
  .refine((d) => {
    const t = Date.parse(`${d}T00:00:00Z`);
    return Number.isFinite(t) && new Date(t).toISOString().startsWith(d);
  }, 'Not a real date');
export const timeOfDaySchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use 24-hour HH:MM');

/** The calendar date in India at this instant. */
export function istDate(at: Date): string {
  return new Date(at.getTime() + IST_OFFSET_MINUTES * 60_000).toISOString().slice(0, 10);
}

/** Minutes since midnight in India at this instant. */
export function istMinutes(at: Date): number {
  const d = new Date(at.getTime() + IST_OFFSET_MINUTES * 60_000);
  return d.getUTCHours() * 60 + d.getUTCMinutes();
}

export function minutesOf(time: string): number {
  const [h, m] = time.split(':').map(Number);
  return h! * 60 + m!;
}

export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** 0 = Sunday … 6 = Saturday. */
export function dayOfWeek(date: string): number {
  return new Date(`${date}T00:00:00Z`).getUTCDay();
}

/**
 * Can a window on `date` still be booked at `now`? Later days: yes. Today: only before the
 * same-day cut-off and before the window starts. Past days: no.
 */
export function windowOpenForBooking(opts: {
  date: string;
  now: Date;
  windowStart: string;
  sameDayCutoff: string;
}): boolean {
  const today = istDate(opts.now);
  if (opts.date < today) return false;
  if (opts.date > today) return true;
  const nowMin = istMinutes(opts.now);
  return nowMin < minutesOf(opts.sameDayCutoff) && nowMin < minutesOf(opts.windowStart);
}

/** D-12: one charge per order, waived when the order has more than `freeAboveCans` cans (0 = never waived). */
export function deliveryChargeFor(qty: number, chargePaise: number, freeAboveCans: number): number {
  if (chargePaise <= 0) return 0;
  return freeAboveCans > 0 && qty > freeAboveCans ? 0 : chargePaise;
}

/**
 * Cans that need a refundable deposit (D-04). Empties are swapped one for one (D-09), so after the
 * delivery the customer holds max(held, qty) cans; deposit is due for any beyond their deposit cover.
 */
export function depositCansFor(qty: number, held: number, cover: number): number {
  return Math.max(0, Math.max(held, qty) - cover);
}

export interface OrderPriceInput {
  qty: number;
  unitPricePaise: number;
  depositPerCanPaise: number;
  depositCans: number;
  deliveryChargePaise: number;
}

export interface OrderPrice {
  subtotalPaise: number;
  deliveryChargePaise: number;
  depositPaise: number;
  totalPaise: number;
}

export function priceOrder(p: OrderPriceInput): OrderPrice {
  for (const [k, v] of Object.entries(p)) {
    if (!Number.isInteger(v) || v < 0)
      throw new RangeError(`${k} must be a whole number of 0 or more`);
  }
  const subtotalPaise = p.qty * p.unitPricePaise;
  const depositPaise = p.depositCans * p.depositPerCanPaise;
  return {
    subtotalPaise,
    deliveryChargePaise: p.deliveryChargePaise,
    depositPaise,
    totalPaise: subtotalPaise + p.deliveryChargePaise + depositPaise,
  };
}

/** Customer order request (POST /customer/orders). */
export const customerOrderInputSchema = z.object({
  /** Generated once per order screen; the same id twice creates one order (duplicate taps, retries). */
  clientRequestId: z.string().uuid(),
  addressId: z.string().uuid(),
  windowId: z.string().uuid(),
  date: isoDateSchema,
  qty: z.number().int().min(1).max(100),
  /** The total the customer saw. If prices changed meanwhile the order is refused with the new quote. */
  expectedTotalPaise: z.number().int().min(0),
  note: z.string().trim().max(200).optional(),
});
export type CustomerOrderInput = z.infer<typeof customerOrderInputSchema>;

export const ORDER_CHANNELS = ['app', 'office'] as const;
export type OrderChannel = (typeof ORDER_CHANNELS)[number];
