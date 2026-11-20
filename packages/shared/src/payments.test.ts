import { describe, expect, it } from 'vitest';
import {
  addMonths,
  balanceCorrectionInputSchema,
  depositRefund,
  monthRange,
  OPENING_CSV_HEADER,
  parseOpeningCsv,
} from './payments';

describe('depositRefund', () => {
  it('refunds only cans the deposit covers that the customer no longer holds', () => {
    const p = { cansHeld: 1, depositHeldPaise: 45_000, depositCoverCans: 3 };
    expect(depositRefund({ ...p, cans: 2 })).toEqual({ refundableCans: 2, amountPaise: 30_000 });
    expect(depositRefund({ ...p, cans: 3 }).amountPaise).toBe(0);
  });
  it('gives back the whole deposit when every covered can is returned', () => {
    // 3 cans covered by ₹400 (an older, lower deposit plus a newer one): no rounding loss.
    expect(
      depositRefund({ cans: 3, cansHeld: 0, depositHeldPaise: 40_000, depositCoverCans: 3 }),
    ).toEqual({ refundableCans: 3, amountPaise: 40_000 });
    // Part of it rounds down, never up.
    expect(
      depositRefund({ cans: 1, cansHeld: 0, depositHeldPaise: 40_000, depositCoverCans: 3 })
        .amountPaise,
    ).toBe(13_333);
  });
  it('has nothing to refund without a deposit', () => {
    expect(
      depositRefund({ cans: 1, cansHeld: 0, depositHeldPaise: 0, depositCoverCans: 0 }),
    ).toEqual({ refundableCans: 0, amountPaise: 0 });
  });
});

describe('months', () => {
  it('gives the date range and moves across years', () => {
    expect(monthRange('2026-12')).toEqual({ from: '2026-12-01', to: '2027-01-01' });
    expect(addMonths('2026-01', -1)).toBe('2025-12');
    expect(addMonths('2026-11', 2)).toBe('2027-01');
  });
});

describe('balanceCorrectionInputSchema', () => {
  it('needs a reason and at least one balance', () => {
    expect(balanceCorrectionInputSchema.safeParse({ reason: 'Counted at the house' }).success).toBe(
      false,
    );
    expect(balanceCorrectionInputSchema.safeParse({ cansHeld: 2, reason: 'ok' }).success).toBe(
      false,
    );
    expect(
      balanceCorrectionInputSchema.safeParse({ cansHeld: 2, reason: 'Counted at the house' })
        .success,
    ).toBe(true);
  });
});

describe('parseOpeningCsv', () => {
  it('reads rupees, quotes and blank cells, and reports bad lines by number', () => {
    const csv = [
      OPENING_CSV_HEADER,
      '98470 11111,"Joseph, K.",3,450,3,"1,240.50"',
      '9847022222,,0,,,-200',
      '',
      '12345,Bad Phone,1,0,0,0',
      '9847033333,Deposit no cans,2,300,,0',
      '9847011111,Twice,1,0,0,0',
    ].join('\r\n');
    const r = parseOpeningCsv(csv);
    expect(r.rows).toEqual([
      {
        line: 2,
        row: {
          phone: '+919847011111',
          name: 'Joseph, K.',
          cansHeld: 3,
          depositHeldPaise: 45_000,
          depositCoverCans: 3,
          duePaise: 124_050,
        },
      },
      {
        line: 3,
        row: {
          phone: '+919847022222',
          name: undefined,
          cansHeld: 0,
          depositHeldPaise: 0,
          depositCoverCans: 0,
          duePaise: -20_000,
        },
      },
    ]);
    expect(r.errors.map((e) => e.line)).toEqual([5, 6, 7]);
  });
  it('refuses a file without the expected first line', () => {
    expect(parseOpeningCsv('mobile,name\n9847011111,A').errors[0]!.line).toBe(1);
  });
});
