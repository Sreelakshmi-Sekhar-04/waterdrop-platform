/**
 * Every expected failure is an AppError with a stable `code` the apps can
 * translate. Unexpected errors become INTERNAL_ERROR without leaking details.
 */
export class AppError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export const errors = {
  unauthenticated: () => new AppError(401, 'UNAUTHENTICATED', 'Please sign in again.'),
  forbidden: () => new AppError(403, 'FORBIDDEN', 'You do not have permission to do this.'),
  /** Used for records that exist but belong to someone else, so ids are not confirmed. */
  notFound: (what = 'Record') => new AppError(404, 'NOT_FOUND', `${what} not found.`),
  validation: (details: unknown) =>
    new AppError(400, 'VALIDATION_FAILED', 'Some details are missing or incorrect.', details),
  conflict: (code: string, message: string) => new AppError(409, code, message),
};
