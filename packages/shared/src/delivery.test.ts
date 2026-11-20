import { describe, expect, it } from 'vitest';
import { deliverInputSchema, deliveryMoney, endTripInputSchema } from './delivery';

const base = {
  unitPricePaise: 4000,
  deliveryChargePaise: 0,
  depositPerCanPaise: 15000,
};

describe('deliveryMoney', () => {
  it('a first-time customer pays for the cans and a deposit for each can now held (D-04)', () => {
    expect(deliveryMoney({ ...base, full: 2, empties: 0, held: 0, cover: 0 })).toEqual({
      closing: 2,
      extraEmpties: 0,
      goodsPaise: 8000,
      deliveryChargePaise: 0,
      depositCans: 2,
      depositPaise: 30000,
      totalPaise: 38000,
    });
  });
  it('a usual swap (empties = full, D-09) adds no deposit', () => {
    const m = deliveryMoney({ ...base, full: 2, empties: 2, held: 2, cover: 2 });
    expect(m).toMatchObject({ closing: 2, depositCans: 0, totalPaise: 8000 });
  });
  it('only cans beyond what the deposit already covers are charged', () => {
    const m = deliveryMoney({
      ...base,
      full: 3,
      empties: 1,
      held: 2,
      cover: 2,
      deliveryChargePaise: 2000,
    });
    expect(m).toMatchObject({
      closing: 4,
      depositCans: 2,
      depositPaise: 30000,
      totalPaise: 12000 + 2000 + 30000,
    });
  });
  it('extra empties never take the balance below 0 (R-07)', () => {
    const m = deliveryMoney({ ...base, full: 1, empties: 4, held: 1, cover: 1 });
    expect(m).toMatchObject({ closing: 0, extraEmpties: 2, depositCans: 0 });
  });
  it('refuses nonsense counts', () => {
    expect(() => deliveryMoney({ ...base, full: 0, empties: 0, held: 0, cover: 0 })).toThrow(
      RangeError,
    );
    expect(() => deliveryMoney({ ...base, full: 1, empties: -1, held: 0, cover: 0 })).toThrow(
      RangeError,
    );
  });
});

describe('delivery inputs', () => {
  const ok = {
    clientActionId: '6f1c1e4e-2f4b-4b4e-9a33-0a1b2c3d4e5f',
    full: 2,
    empties: 2,
    payment: { method: 'cash', amountPaise: 8000 },
    at: '2026-11-19T10:00:00+05:30',
  };
  it('cash or UPI needs an amount; pay later has none', () => {
    expect(deliverInputSchema.safeParse(ok).success).toBe(true);
    expect(
      deliverInputSchema.safeParse({ ...ok, payment: { method: 'cash', amountPaise: 0 } }).success,
    ).toBe(false);
    expect(
      deliverInputSchema.safeParse({ ...ok, payment: { method: 'later', amountPaise: 0 } }).success,
    ).toBe(true);
    expect(
      deliverInputSchema.safeParse({ ...ok, payment: { method: 'later', amountPaise: 100 } })
        .success,
    ).toBe(false);
  });
  it('damaged cans are counted among the empties brought back', () => {
    const end = {
      clientActionId: ok.clientActionId,
      returnFull: 0,
      returnEmpty: 3,
      returnDamaged: 1,
      cashPaise: 0,
    };
    expect(endTripInputSchema.safeParse(end).success).toBe(true);
    expect(endTripInputSchema.safeParse({ ...end, returnDamaged: 4 }).success).toBe(false);
  });
});
