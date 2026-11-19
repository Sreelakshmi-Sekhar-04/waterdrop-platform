import { describe, expect, it } from 'vitest';
import { formatINR, rupeesToPaise } from './money';
import { indianMobileSchema } from './schemas';

describe('money', () => {
  it('formats paise with Indian grouping', () => {
    expect(formatINR(1240000)).toBe('₹12,400');
    expect(formatINR(10000000)).toBe('₹1,00,000');
    expect(formatINR(4050)).toBe('₹40.5');
  });
  it('converts rupees to whole paise', () => {
    expect(rupeesToPaise(40)).toBe(4000);
    expect(rupeesToPaise(0.1 + 0.2)).toBe(30);
  });
  it('rejects fractional paise', () => {
    expect(() => formatINR(1.5)).toThrow(RangeError);
  });
});

describe('indian mobile numbers', () => {
  it('normalises common inputs to E.164', () => {
    expect(indianMobileSchema.parse('98470 12345')).toBe('+919847012345');
    expect(indianMobileSchema.parse('+919847012345')).toBe('+919847012345');
    expect(indianMobileSchema.parse('98470-12345')).toBe('+919847012345');
  });
  it('rejects invalid numbers', () => {
    for (const bad of ['12345', '5847012345', '+14155550123', '98470123456']) {
      expect(indianMobileSchema.safeParse(bad).success).toBe(false);
    }
  });
});
