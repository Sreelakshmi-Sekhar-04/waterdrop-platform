/**
 * Personal data must not reach logs or audit "before/after" snapshots in full.
 * Phone numbers keep only the last 4 digits; secrets are removed entirely.
 */
const SECRET_KEYS = /pass(word)?|secret|token|otp|code_?hash|authorization|cookie|pin/i;
const PHONE_KEYS = /phone|mobile/i;

export function maskPhone(value: string): string {
  const digits = value.replace(/\D/g, '');
  return digits.length >= 4 ? `******${digits.slice(-4)}` : '****';
}

export function redact(value: unknown, depth = 0): unknown {
  if (depth > 6 || value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (SECRET_KEYS.test(k)) out[k] = '[REDACTED]';
    else if (PHONE_KEYS.test(k) && typeof v === 'string') out[k] = maskPhone(v);
    else out[k] = redact(v, depth + 1);
  }
  return out;
}

/** Paths pino removes from request logs. */
export const LOG_REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'res.headers["set-cookie"]',
  '*.password',
  '*.otp',
  '*.code',
  '*.pin',
  '*.refreshToken',
  '*.phone',
];
