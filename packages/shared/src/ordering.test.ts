import { describe, expect, it } from 'vitest';
import {
  addDays,
  dayOfWeek,
  deliveryChargeFor,
  depositCansFor,
  isoDateSchema,
  istDate,
  istMinutes,
  priceOrder,
  windowOpenForBooking,
} from './ordering';

// 19 Nov 2026 10:30 in India = 05:00 UTC.
const at = (ist: string) => new Date(`${ist}+05:30`);

describe('India time', () => {
  it('uses the Indian date, not the UTC date, around midnight', () => {
    expect(istDate(new Date('2026-11-19T19:00:00Z'))).toBe('2026-11-20'); // 00:30 IST
    expect(istMinutes(at('2026-11-19T10:30:00'))).toBe(630);
  });
  it('adds days across months and knows weekdays', () => {
    expect(addDays('2026-11-30', 1)).toBe('2026-12-01');
    expect(dayOfWeek('2026-11-22')).toBe(0); // Sunday
  });
  it('accepts only real dates', () => {
    expect(isoDateSchema.safeParse('2026-11-19').success).toBe(true);
    expect(isoDateSchema.safeParse('2026-02-30').success).toBe(false);
    expect(isoDateSchema.safeParse('19-11-2026').success).toBe(false);
  });
});

describe('booking windows (D-07)', () => {
  const base = { windowStart: '15:00', sameDayCutoff: '14:00' };
  it('today: open before the cut-off and before the window starts', () => {
    expect(
      windowOpenForBooking({ ...base, date: '2026-11-19', now: at('2026-11-19T13:59:00') }),
    ).toBe(true);
    expect(
      windowOpenForBooking({ ...base, date: '2026-11-19', now: at('2026-11-19T14:00:00') }),
    ).toBe(false);
  });
  it('today: a window that has already started cannot be booked', () => {
    expect(
      windowOpenForBooking({
        windowStart: '07:00',
        sameDayCutoff: '14:00',
        date: '2026-11-19',
        now: at('2026-11-19T08:00:00'),
      }),
    ).toBe(false);
  });
  it('later days are open and past days are closed', () => {
    expect(
      windowOpenForBooking({ ...base, date: '2026-11-20', now: at('2026-11-19T22:00:00') }),
    ).toBe(true);
    expect(
      windowOpenForBooking({ ...base, date: '2026-11-18', now: at('2026-11-19T06:00:00') }),
    ).toBe(false);
  });
});

describe('prices', () => {
  it('delivery charge is waived only above the free limit (D-12)', () => {
    expect(deliveryChargeFor(2, 2000, 3)).toBe(2000);
    expect(deliveryChargeFor(3, 2000, 3)).toBe(2000);
    expect(deliveryChargeFor(4, 2000, 3)).toBe(0);
    expect(deliveryChargeFor(10, 2000, 0)).toBe(2000); // 0 = never waived
    expect(deliveryChargeFor(1, 0, 0)).toBe(0);
  });
  it('deposit is due only for cans beyond the deposit cover (D-04, D-09 swap)', () => {
    expect(depositCansFor(2, 0, 0)).toBe(2); // first order
    expect(depositCansFor(2, 2, 2)).toBe(0); // usual swap
    expect(depositCansFor(3, 2, 2)).toBe(1); // one more than usual
    expect(depositCansFor(1, 3, 3)).toBe(0); // fewer than held
  });
  it('adds up the order in paise', () => {
    expect(
      priceOrder({
        qty: 3,
        unitPricePaise: 4000,
        depositPerCanPaise: 15000,
        depositCans: 1,
        deliveryChargePaise: 0,
      }),
    ).toEqual({
      subtotalPaise: 12000,
      deliveryChargePaise: 0,
      depositPaise: 15000,
      totalPaise: 27000,
    });
    expect(() =>
      priceOrder({
        qty: 1.5,
        unitPricePaise: 4000,
        depositPerCanPaise: 0,
        depositCans: 0,
        deliveryChargePaise: 0,
      }),
    ).toThrow(RangeError);
  });
});
