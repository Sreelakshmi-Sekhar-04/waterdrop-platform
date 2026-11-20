/**
 * Delivery rules (Phase 5): what one "Delivered" confirmation charges and how it moves cans.
 * Approved decisions D-03 (pay later, never blocked at the door), D-04 (deposit per can held
 * beyond the cans already covered), D-05 (attempts; a short delivery closes the order),
 * D-09 (empties default to the full cans delivered) and rule R-07 (no negative can balance).
 *
 * The staff app uses these to show the result before confirming; the API uses the same code to
 * write the ledgers, so the two can never disagree.
 */
import { z } from 'zod';
import { applyCanMovement } from './can-ledger';

export const FAILURE_REASONS = [
  'NOT_HOME',
  'LOCKED',
  'REFUSED',
  'WRONG_ADDRESS',
  'OUT_OF_STOCK',
  'OTHER',
] as const;
export type FailureReason = (typeof FAILURE_REASONS)[number];

/** How the customer paid at the door. `later` adds the amount to their dues (D-03). */
export const PAYMENT_METHODS = ['cash', 'upi', 'later'] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export const TRIP_STATUSES = ['planned', 'on_route', 'ended', 'reconciled'] as const;
export type TripStatus = (typeof TRIP_STATUSES)[number];

export interface DeliveryMoneyInput {
  /** Full cans handed over (at least 1; fewer than ordered is a short delivery). */
  full: number;
  /** Empty cans taken back. */
  empties: number;
  /** Cans the customer held before this stop. */
  held: number;
  /** Cans their deposit already covers. */
  cover: number;
  unitPricePaise: number;
  /** The order's delivery charge as saved when it was placed. */
  deliveryChargePaise: number;
  depositPerCanPaise: number;
}

export interface DeliveryMoney {
  /** Cans held after this stop (never below 0). */
  closing: number;
  /** Empties beyond what the customer held: kept for office review, not taken below 0 (R-07). */
  extraEmpties: number;
  goodsPaise: number;
  deliveryChargePaise: number;
  /** New cans the deposit now covers, and what that costs. */
  depositCans: number;
  depositPaise: number;
  /** goods + delivery + deposit: what this stop adds to the customer's account. */
  totalPaise: number;
}

const whole = (name: string, v: number) => {
  if (!Number.isInteger(v) || v < 0) throw new RangeError(`${name} must be a whole number ≥ 0`);
};

export function deliveryMoney(m: DeliveryMoneyInput): DeliveryMoney {
  whole('unitPricePaise', m.unitPricePaise);
  whole('deliveryChargePaise', m.deliveryChargePaise);
  whole('depositPerCanPaise', m.depositPerCanPaise);
  if (m.full < 1) throw new RangeError('full must be at least 1');
  const moved = applyCanMovement({
    opening: m.held,
    delivered: m.full,
    returned: m.empties,
    depositCoverCans: m.cover,
  });
  const goodsPaise = m.full * m.unitPricePaise;
  const depositCans = moved.beyondDepositCover;
  const depositPaise = depositCans * m.depositPerCanPaise;
  return {
    closing: moved.closing,
    extraEmpties: moved.extraReturned,
    goodsPaise,
    deliveryChargePaise: m.deliveryChargePaise,
    depositCans,
    depositPaise,
    totalPaise: goodsPaise + m.deliveryChargePaise + depositPaise,
  };
}

const at = z.iso.datetime({ offset: true });

export const deliverInputSchema = z
  .object({
    clientActionId: z.uuid(),
    full: z.number().int().min(1).max(100),
    empties: z.number().int().min(0).max(200),
    payment: z.object({
      method: z.enum(PAYMENT_METHODS),
      amountPaise: z.number().int().min(0).max(10_000_000),
      reference: z.string().trim().max(40).optional(),
    }),
    at,
    latitude: z.number().min(-90).max(90).optional(),
    longitude: z.number().min(-180).max(180).optional(),
  })
  .refine((v) => (v.payment.method === 'later') === (v.payment.amountPaise === 0), {
    message: 'Cash or UPI needs an amount; pay later has none',
    path: ['payment', 'amountPaise'],
  });
export type DeliverInput = z.infer<typeof deliverInputSchema>;

export const notDeliveredInputSchema = z.object({
  clientActionId: z.uuid(),
  reason: z.enum(FAILURE_REASONS),
  note: z.string().trim().max(200).optional(),
  at,
});
export type NotDeliveredInput = z.infer<typeof notDeliveredInputSchema>;

export const startTripInputSchema = z.object({
  clientActionId: z.uuid(),
  loadFull: z.number().int().min(0).max(2000),
});

export const endTripInputSchema = z
  .object({
    clientActionId: z.uuid(),
    returnFull: z.number().int().min(0).max(2000),
    returnEmpty: z.number().int().min(0).max(2000),
    /** Of the empties brought back, how many are cracked or leaking. */
    returnDamaged: z.number().int().min(0).max(2000),
    cashPaise: z.number().int().min(0).max(100_000_000),
    note: z.string().trim().max(300).optional(),
  })
  .refine((v) => v.returnDamaged <= v.returnEmpty, {
    message: 'Damaged cans are counted among the empties',
    path: ['returnDamaged'],
  });
export type EndTripInput = z.infer<typeof endTripInputSchema>;
