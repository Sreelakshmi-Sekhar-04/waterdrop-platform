import { useState } from 'react';
import { useSearchParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { COMPLAINT_STATUSES, type ComplaintStatus } from '@wtrdrop/shared';
import { call } from '../lib/api';
import { errorText } from '../lib/errors';
import { LiveMessage, PageHeader } from '../components/ui';
import { ComplaintTable, type Complaint } from '../components/Complaints';

/**
 * Complaints (Phase 7, Phase 0 §11 #13): open ones first. Resolving one tells the customer what
 * was done. To note a complaint from a phone call, open the customer's page.
 */
export function ComplaintsPage() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();
  const status: ComplaintStatus = params.get('show') === 'resolved' ? 'resolved' : 'open';
  const [message, setMessage] = useState<string | null>(null);
  const q = useQuery({
    queryKey: ['complaints', status],
    queryFn: async () =>
      (await call<{ complaints: Complaint[] }>(`/admin/complaints?status=${status}`)).complaints,
  });
  return (
    <div className="page">
      <PageHeader title={t('complaints.title')} subtitle={t('complaints.subtitle')} />
      <div className="filters" role="group" aria-label={t('complaints.title')}>
        {COMPLAINT_STATUSES.map((k) => (
          <button
            key={k}
            type="button"
            className="filter"
            aria-pressed={status === k}
            onClick={() => setParams(k === 'open' ? {} : { show: k }, { replace: true })}
          >
            {t(`complaints.show.${k}`)}
          </button>
        ))}
      </div>
      <LiveMessage text={message} tone="success" />
      {q.isError ? (
        <div className="card empty" role="alert">
          {errorText(t, q.error)}
        </div>
      ) : null}
      {q.isPending ? <div className="card empty">{t('common.loading')}</div> : null}
      {q.data && q.data.length === 0 ? (
        <div className="card empty">
          {status === 'open' ? t('complaints.noneOpen') : t('complaints.noneResolved')}
        </div>
      ) : null}
      {q.data && q.data.length > 0 ? (
        <ComplaintTable
          items={q.data}
          showCustomer
          onChanged={(text) => {
            setMessage(text);
            void qc.invalidateQueries({ queryKey: ['complaints'] });
            void qc.invalidateQueries({ queryKey: ['dashboard'] });
          }}
        />
      ) : null}
    </div>
  );
}
