/**
 * Customer can-balance rules (original §9, plus Phase 0 rules R-06 and R-07).
 *
 * Closing outstanding cans = Opening + Full cans delivered − Empty cans returned.
 *
 * Balances are never overwritten. The database stores one ledger entry per
 * movement; these helpers compute what an entry will do so the staff app can
 * show the result before confirming, and the API can validate it.
 */

export interface CanMovement {
  /** Cans the customer holds before this movement. */
  opening: number;
  /** Full cans handed over. */
  delivered: number;
  /** Empty cans taken back. */
  returned: number;
  /** Cans covered by the customer's refundable deposit (decision D-04). */
  depositCoverCans?: number;
}

export interface CanMovementResult {
  closing: number;
  /**
   * Empties returned beyond what the customer held. These are not subtracted
   * below zero; they are recorded separately for admin review (rule R-07).
   */
  extraReturned: number;
  /** Cans held beyond the deposit cover. A warning only: never blocks a delivery (D-04). */
  beyondDepositCover: number;
}

function assertCount(name: string, value: number): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new RangeError(`${name} must be a whole number of 0 or more, got ${value}`);
  }
}

export function applyCanMovement(m: CanMovement): CanMovementResult {
  assertCount('opening', m.opening);
  assertCount('delivered', m.delivered);
  assertCount('returned', m.returned);
  if (m.depositCoverCans !== undefined) assertCount('depositCoverCans', m.depositCoverCans);

  const raw = m.opening + m.delivered - m.returned;
  const closing = Math.max(0, raw);
  const extraReturned = raw < 0 ? -raw : 0;
  const beyondDepositCover =
    m.depositCoverCans === undefined ? 0 : Math.max(0, closing - m.depositCoverCans);
  return { closing, extraReturned, beyondDepositCover };
}

/** Sum of ledger deltas. The single definition of "balance" used by checks and reports. */
export function balanceFromDeltas(deltas: readonly number[]): number {
  return deltas.reduce((sum, d) => sum + d, 0);
}
