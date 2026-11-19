import pino from 'pino';
import { LOG_REDACT_PATHS } from './redact';

export function createLogger(level: string) {
  return pino({
    level,
    redact: { paths: LOG_REDACT_PATHS, censor: '[REDACTED]' },
    base: { service: 'wtrdrop-api' },
  });
}
export type Logger = ReturnType<typeof createLogger>;
