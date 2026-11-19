import { z } from 'zod';

/** Indian mobile number in E.164 form: +91 followed by 10 digits starting 6–9. */
export const indianMobileSchema = z
  .string()
  .trim()
  .transform((v) => v.replace(/[\s-]/g, ''))
  .transform((v) => (/^[6-9]\d{9}$/.test(v) ? `+91${v}` : v))
  .pipe(z.string().regex(/^\+91[6-9]\d{9}$/, 'Enter a valid 10-digit Indian mobile number'));

export const languageSchema = z.enum(['en', 'ml']);
export type Language = z.infer<typeof languageSchema>;

/** Client-generated key sent in the Idempotency-Key header on every POST. */
export const idempotencyKeySchema = z
  .string()
  .min(16)
  .max(100)
  .regex(/^[A-Za-z0-9_-]+$/, 'Idempotency key may contain letters, digits, - and _ only');

/** The one error shape every API error uses. Apps translate `code` to English or Malayalam. */
export const apiErrorSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    requestId: z.string().optional(),
    details: z.unknown().optional(),
  }),
});
export type ApiError = z.infer<typeof apiErrorSchema>;

export const healthResponseSchema = z.object({
  status: z.enum(['ok', 'degraded']),
  database: z.enum(['ok', 'unavailable']),
  version: z.string(),
  time: z.string(),
});
export type HealthResponse = z.infer<typeof healthResponseSchema>;

/**
 * Cleans what a person types or pastes into a 10-digit mobile field:
 * drops spaces and dashes, and a leading +91 / 91 / 0 when the rest is 10 digits.
 */
export function normaliseMobileInput(v: string): string {
  let d = v.replace(/\D/g, '');
  if (d.length === 12 && d.startsWith('91')) d = d.slice(2);
  else if (d.length === 11 && d.startsWith('0')) d = d.slice(1);
  return d.slice(0, 10);
}
