import { z } from 'zod';

/**
 * All configuration comes from environment variables, validated at start-up.
 * The process refuses to start with missing or weak secrets.
 */
const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  DATABASE_URL: z.string().url(),
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
  CORS_ORIGINS: z
    .string()
    .default('')
    .transform((v) =>
      v
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    ),
  TRUST_PROXY: z.coerce.number().int().min(0).default(0),
  RATE_LIMIT_PER_MINUTE: z.coerce.number().int().positive().default(300),
  /** The supplier the apps sign in to. One supplier at launch. */
  DEFAULT_SUPPLIER_SLUG: z.string().min(1).default('demo'),
  /**
   * How sign-in codes are delivered.
   * - msg91: real SMS through MSG91 (decision D-17). Needs the MSG91_* values.
   * - dev-outbox: writes codes to a local file for development and automated tests.
   *   Refused in production. The code is still random, hashed, expiring and limited.
   */
  OTP_PROVIDER: z.enum(['msg91', 'dev-outbox']).default('dev-outbox'),
  OTP_DEV_OUTBOX: z.string().default('.dev-outbox/sms.jsonl'),
  OTP_PER_IP_PER_HOUR: z.coerce.number().int().positive().default(30),
  MSG91_AUTH_KEY: z.string().optional(),
  MSG91_TEMPLATE_ID: z.string().optional(),
  MSG91_BASE_URL: z.string().url().default('https://control.msg91.com'),
  /**
   * How messages reach customers' phones (Phase 7). The app always lists them as well.
   * - expo: Expo's push service (FCM / APNs underneath). EXPO_ACCESS_TOKEN is optional.
   * - dev-outbox: writes pushes to a local file for development and tests. Refused in production.
   * - none: keep messages in the app only.
   */
  PUSH_PROVIDER: z.enum(['expo', 'dev-outbox', 'none']).default('dev-outbox'),
  PUSH_DEV_OUTBOX: z.string().default('.dev-outbox/push.jsonl'),
  EXPO_ACCESS_TOKEN: z.string().optional(),
});

export type Env = z.infer<typeof envSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`);
    throw new Error(`Invalid environment configuration:\n${problems.join('\n')}`);
  }
  const env = parsed.data;
  if (env.NODE_ENV === 'production' && env.OTP_PROVIDER === 'dev-outbox') {
    throw new Error(
      'Invalid environment configuration:\n  - OTP_PROVIDER: dev-outbox is not allowed in production',
    );
  }
  if (env.NODE_ENV === 'production' && env.PUSH_PROVIDER === 'dev-outbox') {
    throw new Error(
      'Invalid environment configuration:\n  - PUSH_PROVIDER: dev-outbox is not allowed in production',
    );
  }
  if (env.OTP_PROVIDER === 'msg91' && (!env.MSG91_AUTH_KEY || !env.MSG91_TEMPLATE_ID)) {
    throw new Error(
      'Invalid environment configuration:\n  - MSG91_AUTH_KEY and MSG91_TEMPLATE_ID are required for OTP_PROVIDER=msg91',
    );
  }
  return env;
}
