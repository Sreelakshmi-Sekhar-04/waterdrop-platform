/**
 * Order lifecycle (Phase 0 decisions C-01, C-02, C-03, D-05, D-14).
 *
 * PLACED → ACCEPTED → ASSIGNED → OUT_FOR_DELIVERY → DELIVERED
 * plus REJECTED, CANCELLED, and RESCHEDULE_PENDING.
 *
 * FAILED_DELIVERY from the original requirements is kept as the outcome of a
 * delivery *attempt*. A failed attempt moves the order to RESCHEDULE_PENDING, so
 * the order is not lost and can be assigned again.
 *
 * This table is the single source of truth. The backend enforces it; the apps
 * use it only to decide which buttons to show.
 */
import type { Role } from './roles';

export const ORDER_STATUSES = [
  'PLACED',
  'ACCEPTED',
  'REJECTED',
  'ASSIGNED',
  'OUT_FOR_DELIVERY',
  'DELIVERED',
  'RESCHEDULE_PENDING',
  'CANCELLED',
] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

/** Who is performing the transition. `system` is automatic acceptance. */
export type TransitionActor = Role | 'system';

interface TransitionRule {
  to: OrderStatus;
  allowed: readonly TransitionActor[];
  /** A written reason is mandatory (stored in order_status_history and the audit log). */
  reasonRequired?: boolean;
}

const ADMINS: readonly TransitionActor[] = ['admin', 'owner'];

export const ORDER_TRANSITIONS: Readonly<Record<OrderStatus, readonly TransitionRule[]>> = {
  PLACED: [
    { to: 'ACCEPTED', allowed: ['system', ...ADMINS] },
    { to: 'REJECTED', allowed: ADMINS, reasonRequired: true },
    { to: 'CANCELLED', allowed: ['customer', ...ADMINS] },
  ],
  ACCEPTED: [
    { to: 'ASSIGNED', allowed: ADMINS },
    { to: 'CANCELLED', allowed: ['customer', ...ADMINS] },
  ],
  ASSIGNED: [
    { to: 'ACCEPTED', allowed: ADMINS }, // unassign
    { to: 'OUT_FOR_DELIVERY', allowed: ['staff', ...ADMINS] },
    { to: 'CANCELLED', allowed: ['customer', ...ADMINS] },
  ],
  OUT_FOR_DELIVERY: [
    { to: 'DELIVERED', allowed: ['staff', ...ADMINS] },
    { to: 'RESCHEDULE_PENDING', allowed: ['staff', ...ADMINS] },
    // After dispatch only the business can cancel (rule R-08).
    { to: 'CANCELLED', allowed: ADMINS, reasonRequired: true },
  ],
  RESCHEDULE_PENDING: [
    // A new day or time chosen by the office (capacity booked again), then assigned as usual.
    { to: 'ACCEPTED', allowed: ADMINS },
    { to: 'ASSIGNED', allowed: ADMINS },
    { to: 'CANCELLED', allowed: ['customer', ...ADMINS] },
  ],
  DELIVERED: [],
  REJECTED: [],
  CANCELLED: [],
};

export const TERMINAL_STATUSES: readonly OrderStatus[] = ['DELIVERED', 'REJECTED', 'CANCELLED'];

export type TransitionCheck =
  | { ok: true; reasonRequired: boolean }
  | { ok: false; code: 'INVALID_TRANSITION' | 'FORBIDDEN_TRANSITION' | 'REASON_REQUIRED' };

/**
 * Checks whether `actor` may move an order from `from` to `to`.
 * Pass `reason` when the caller has one; it is required for some transitions.
 */
export function checkOrderTransition(
  from: OrderStatus,
  to: OrderStatus,
  actor: TransitionActor,
  reason?: string,
): TransitionCheck {
  const rule = ORDER_TRANSITIONS[from].find((r) => r.to === to);
  if (!rule) return { ok: false, code: 'INVALID_TRANSITION' };
  if (!rule.allowed.includes(actor)) return { ok: false, code: 'FORBIDDEN_TRANSITION' };
  const reasonRequired = rule.reasonRequired === true;
  if (reasonRequired && !reason?.trim()) return { ok: false, code: 'REASON_REQUIRED' };
  return { ok: true, reasonRequired };
}

/** Statuses the given actor may move an order to from `from`. Useful for showing buttons. */
export function nextStatusesFor(from: OrderStatus, actor: TransitionActor): OrderStatus[] {
  return ORDER_TRANSITIONS[from].filter((r) => r.allowed.includes(actor)).map((r) => r.to);
}

/** Customers can cancel only before the order leaves for delivery. */
export function customerCanCancel(status: OrderStatus): boolean {
  return nextStatusesFor(status, 'customer').includes('CANCELLED');
}
