import type { TFunction } from 'i18next';
import { ApiError } from './api';

/** Turns any failure into one short sentence in the user's language, with what to do next. */
export function errorText(t: TFunction, e: unknown): string {
  if (e instanceof ApiError) {
    const d = (e.details ?? {}) as { attemptsLeft?: number; retryAfterSeconds?: number };
    const key = `errors.${e.code}`;
    const text = t(key, {
      count: d.attemptsLeft ?? 0,
      seconds: d.retryAfterSeconds ?? 30,
      defaultValue: '',
    });
    if (text) return text;
    if (e.status === 0) return t('errors.NETWORK');
  }
  return t('errors.UNKNOWN');
}
