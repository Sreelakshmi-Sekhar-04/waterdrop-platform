import { describe, expect, it } from 'vitest';
import {
  ORDER_STATUSES,
  ORDER_TRANSITIONS,
  TERMINAL_STATUSES,
  checkOrderTransition,
  customerCanCancel,
  nextStatusesFor,
  type OrderStatus,
} from './order-status';

describe('order state machine', () => {
  it('allows the happy path', () => {
    const path: [OrderStatus, OrderStatus, 'system' | 'admin' | 'staff'][] = [
      ['PLACED', 'ACCEPTED', 'system'],
      ['ACCEPTED', 'ASSIGNED', 'admin'],
      ['ASSIGNED', 'OUT_FOR_DELIVERY', 'staff'],
      ['OUT_FOR_DELIVERY', 'DELIVERED', 'staff'],
    ];
    for (const [from, to, actor] of path) {
      expect(checkOrderTransition(from, to, actor)).toEqual({ ok: true, reasonRequired: false });
    }
  });

  it('rejects every transition not in the table (QA scenario 9)', () => {
    let rejected = 0;
    for (const from of ORDER_STATUSES) {
      for (const to of ORDER_STATUSES) {
        const listed = ORDER_TRANSITIONS[from].some((r) => r.to === to);
        if (listed) continue;
        expect(checkOrderTransition(from, to, 'owner')).toEqual({
          ok: false,
          code: 'INVALID_TRANSITION',
        });
        rejected++;
      }
    }
    expect(rejected).toBeGreaterThan(40);
  });

  it('has no way out of terminal statuses', () => {
    for (const s of TERMINAL_STATUSES) expect(ORDER_TRANSITIONS[s]).toHaveLength(0);
  });

  it('sends a failed attempt to RESCHEDULE_PENDING, which can be assigned again', () => {
    expect(checkOrderTransition('OUT_FOR_DELIVERY', 'RESCHEDULE_PENDING', 'staff').ok).toBe(true);
    expect(checkOrderTransition('RESCHEDULE_PENDING', 'ASSIGNED', 'admin').ok).toBe(true);
  });

  it('lets customers cancel only before dispatch', () => {
    expect(customerCanCancel('PLACED')).toBe(true);
    expect(customerCanCancel('ACCEPTED')).toBe(true);
    expect(customerCanCancel('ASSIGNED')).toBe(true);
    expect(customerCanCancel('RESCHEDULE_PENDING')).toBe(true);
    expect(customerCanCancel('OUT_FOR_DELIVERY')).toBe(false);
    expect(customerCanCancel('DELIVERED')).toBe(false);
  });

  it('does not let staff cancel, reject or assign', () => {
    for (const from of ORDER_STATUSES) {
      const next = nextStatusesFor(from, 'staff');
      expect(next).not.toContain('CANCELLED');
      expect(next).not.toContain('REJECTED');
      expect(next).not.toContain('ASSIGNED');
    }
  });

  it('does not let customers move orders forward', () => {
    for (const from of ORDER_STATUSES) {
      expect(nextStatusesFor(from, 'customer').every((s) => s === 'CANCELLED')).toBe(true);
    }
  });

  it('requires a reason to reject, and to cancel after dispatch', () => {
    expect(checkOrderTransition('PLACED', 'REJECTED', 'admin')).toEqual({
      ok: false,
      code: 'REASON_REQUIRED',
    });
    expect(checkOrderTransition('PLACED', 'REJECTED', 'admin', '   ')).toEqual({
      ok: false,
      code: 'REASON_REQUIRED',
    });
    expect(checkOrderTransition('PLACED', 'REJECTED', 'admin', 'Outside service area')).toEqual({
      ok: true,
      reasonRequired: true,
    });
    expect(checkOrderTransition('OUT_FOR_DELIVERY', 'CANCELLED', 'owner').ok).toBe(false);
  });

  it('returns FORBIDDEN_TRANSITION for a valid move by the wrong actor', () => {
    expect(checkOrderTransition('PLACED', 'ACCEPTED', 'customer')).toEqual({
      ok: false,
      code: 'FORBIDDEN_TRANSITION',
    });
  });
});
