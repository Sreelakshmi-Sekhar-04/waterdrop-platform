import { describe, expect, it } from 'vitest';
import {
  ageBucket,
  businessInputSchema,
  complaintInputSchema,
  daysBetween,
  pushTokenInputSchema,
  toCsv,
} from './admin';

describe('admin helpers', () => {
  it('makes spreadsheet-safe CSV', () => {
    expect(toCsv(['name', 'due'], [['Mary, "M"', 150]])).toBe('name,due\r\n"Mary, ""M""",150\r\n');
    // A formula in a name is shown as text, not run.
    expect(toCsv(['name'], [['=HYPERLINK("x")'], ['-5'], [null]])).toBe(
      'name\r\n"\'=HYPERLINK(""x"")"\r\n\'-5\r\n\r\n',
    );
    // Numbers stay numbers, even negative ones.
    expect(toCsv(['n'], [[-200]])).toBe('n\r\n-200\r\n');
  });

  it('groups ages the way the owner chases them', () => {
    expect([0, 7, 8, 30, 31, 60, 61, 400].map(ageBucket)).toEqual([
      '0-7',
      '0-7',
      '8-30',
      '8-30',
      '31-60',
      '31-60',
      '61+',
      '61+',
    ]);
    expect(daysBetween('2026-10-31', '2026-11-20')).toBe(20);
  });

  it('checks complaints, push tokens and business details', () => {
    const id = '7d3c2c1e-8f9a-4b5c-9d1e-2f3a4b5c6d7e';
    expect(complaintInputSchema.safeParse({ clientRequestId: id, category: 'LATE' }).success).toBe(
      true,
    );
    // "Something else" needs a few words.
    expect(complaintInputSchema.safeParse({ clientRequestId: id, category: 'OTHER' }).success).toBe(
      false,
    );
    expect(
      pushTokenInputSchema.safeParse({
        token: 'ExponentPushToken[abcdefghij12]',
        platform: 'android',
      }).success,
    ).toBe(true);
    expect(pushTokenInputSchema.safeParse({ token: 'hello', platform: 'android' }).success).toBe(
      false,
    );
    expect(businessInputSchema.parse({ gstin: '32aaacw1234k1z5' })).toEqual({
      gstin: '32AAACW1234K1Z5',
    });
    expect(businessInputSchema.safeParse({ gstin: '32AAACW1234K1Y5' }).success).toBe(false);
    expect(businessInputSchema.safeParse({}).success).toBe(false);
  });
});
