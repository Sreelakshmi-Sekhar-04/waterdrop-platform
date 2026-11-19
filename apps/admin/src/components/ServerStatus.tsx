import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api } from '../lib/api';

/** Shows whether the API and database are reachable. Real data, no simulation. */
export function ServerStatus() {
  const { t } = useTranslation();
  const q = useQuery({
    queryKey: ['health'],
    queryFn: api.health,
    refetchInterval: 30_000,
    retry: 1,
  });
  const state = q.isPending
    ? 'checking'
    : q.isError
      ? 'offline'
      : q.data.status === 'ok'
        ? 'ok'
        : 'degraded';
  return (
    <span
      className={`status status-${state}`}
      role="status"
      aria-live="polite"
      data-testid="server-status"
    >
      <span className="dot" aria-hidden="true" />
      {t(`status.${state}`)}
    </span>
  );
}
