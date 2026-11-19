/**
 * Money is always an integer number of paise (₹1 = 100 paise). Never use floats
 * for amounts. Convert to rupees only for display.
 */
export type Paise = number;

export function assertPaise(value: number): asserts value is Paise {
  if (!Number.isSafeInteger(value))
    throw new RangeError(`Amount must be whole paise, got ${value}`);
}

export function rupeesToPaise(rupees: number): Paise {
  const paise = Math.round(rupees * 100);
  assertPaise(paise);
  return paise;
}

const inr = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
});

/** Formats paise in Indian style, e.g. 1240000 → "₹12,400". */
export function formatINR(paise: Paise): string {
  assertPaise(paise);
  return inr.format(paise / 100);
}
