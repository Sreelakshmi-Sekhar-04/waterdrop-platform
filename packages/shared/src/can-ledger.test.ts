import { describe, expect, it } from 'vitest';
import { applyCanMovement, balanceFromDeltas } from './can-ledger';

describe('can ledger rules', () => {
  it('matches the worked example in the requirements', () => {
    // Opening 2, delivered 3, collected 2 → closing 3.
    expect(applyCanMovement({ opening: 2, delivered: 3, returned: 2 })).toEqual({
      closing: 3,
      extraReturned: 0,
      beyondDepositCover: 0,
    });
  });

  it('never goes below zero and records extra empties separately', () => {
    expect(applyCanMovement({ opening: 1, delivered: 0, returned: 3 })).toEqual({
      closing: 0,
      extraReturned: 2,
      beyondDepositCover: 0,
    });
  });

  it('warns about cans beyond the deposit cover', () => {
    const r = applyCanMovement({ opening: 2, delivered: 3, returned: 1, depositCoverCans: 2 });
    expect(r.closing).toBe(4);
    expect(r.beyondDepositCover).toBe(2);
  });

  it('rejects fractional or negative counts', () => {
    expect(() => applyCanMovement({ opening: -1, delivered: 1, returned: 0 })).toThrow(RangeError);
    expect(() => applyCanMovement({ opening: 0, delivered: 1.5, returned: 0 })).toThrow(RangeError);
  });

  it('balance equals the sum of entries, including reversals', () => {
    // delivery +3, wrongly recorded return −1, its reversal +1, corrected return −2
    expect(balanceFromDeltas([3, -1, 1, -2])).toBe(1);
    expect(balanceFromDeltas([])).toBe(0);
  });

  it('agrees with a running sum over random sequences', () => {
    let held = 0;
    const deltas: number[] = [];
    for (let i = 0; i < 500; i++) {
      const delivered = (i * 7) % 4;
      const returned = (i * 5) % 3;
      const r = applyCanMovement({ opening: held, delivered, returned });
      deltas.push(r.closing - held);
      held = r.closing;
      expect(held).toBeGreaterThanOrEqual(0);
    }
    expect(balanceFromDeltas(deltas)).toBe(held);
  });
});
