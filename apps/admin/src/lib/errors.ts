import type { TFunction } from 'i18next';
import { ApiRequestError } from './api';

/** One clear sentence for any failure, in the reader's language. */
export function errorText(t: TFunction, e: unknown): string {
  if (e instanceof ApiRequestError) {
    const d = (e.details ?? {}) as {
      attemptsLeft?: number;
      retryAfterSeconds?: number;
      area?: string;
      pincodes?: string[];
    };
    const text = t(`errors.${e.code}`, {
      count: d.attemptsLeft ?? 0,
      seconds: d.retryAfterSeconds ?? 30,
      area: d.area ?? '',
      pincodes: (d.pincodes ?? []).join(', '),
      defaultValue: '',
    });
    if (text) return text;
    if (e.status === 0) return t('errors.NETWORK');
    if (e.status === 403) return t('errors.FORBIDDEN');
  }
  return t('errors.UNKNOWN');
}
