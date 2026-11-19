import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { formatINR } from '@wtrdrop/shared';
import { demoAttention, demoDrivers, demoStats } from '../demo/fixtures';
import { Chip, DemoBadge, LiveMessage, PageHeader, SearchField, TableWrap } from '../components/ui';

const ATTENTION_LINK: Record<(typeof demoAttention)[number]['id'], string> = {
  unassigned: '/orders?show=needsDriver',
  failed: '/orders?show=problems',
  cashShort: '/payments',
  complaint: '/customers',
};

export function TodayPage() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const today = new Intl.DateTimeFormat(i18n.language === 'ml' ? 'ml-IN' : 'en-IN', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  }).format(new Date());

  return (
    <div className="page">
      <PageHeader
        title={t('today.title')}
        subtitle={
          <>
            {today} <DemoBadge />
          </>
        }
        actions={
          <>
            <form
              role="search"
              onSubmit={(e) => {
                e.preventDefault();
                navigate(`/customers?q=${encodeURIComponent(query.trim())}`);
              }}
            >
              <SearchField
                label={t('today.searchLabel')}
                placeholder={t('today.searchPlaceholder')}
                value={query}
                onChange={setQuery}
              />
            </form>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => setMessage(t('today.newOrderDemo'))}
            >
              {t('today.newOrder')}
            </button>
          </>
        }
      />
      <LiveMessage text={message} />

      <section aria-labelledby="attention-h">
        <h2 id="attention-h">{t('today.attention')}</h2>
        <ul className="grid grid-attention">
          {demoAttention.map((a, i) => (
            <li key={a.id} className="card attention">
              <span className={`big-number${a.tone === 'warning' ? ' tone-warning' : ''}`}>
                {a.count}
              </span>
              <span>{t(`today.items.${a.id}`)}</span>
              <Link
                to={ATTENTION_LINK[a.id]}
                className={`btn ${i === 0 ? 'btn-primary' : 'btn-secondary'} btn-compact`}
                aria-label={`${t(`today.actions.${a.action}`)}: ${t(`today.items.${a.id}`)}`}
              >
                {t(`today.actions.${a.action}`)}
              </Link>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="sofar-h">
        <h2 id="sofar-h">{t('today.soFar')}</h2>
        <dl className="grid grid-stats">
          {demoStats.map((s) => (
            <div key={s.id} className="card stat">
              <dt>{t(`today.stats.${s.id}`)}</dt>
              <dd className={`stat-value tone-${s.tone}`}>
                {s.money ? formatINR(s.value) : s.value.toLocaleString('en-IN')}
              </dd>
              {'breakdown' in s ? (
                <dd className="stat-note">
                  {t('today.stats.breakdown', {
                    cash: formatINR(s.breakdown.cash),
                    upi: formatINR(s.breakdown.upi),
                  })}
                </dd>
              ) : null}
            </div>
          ))}
        </dl>
      </section>

      <section aria-labelledby="drivers-h">
        <h2 id="drivers-h">{t('today.drivers')}</h2>
        <TableWrap label={t('today.drivers')}>
          <table>
            <thead>
              <tr>
                <th scope="col">{t('today.driverCols.driver')}</th>
                <th scope="col">{t('today.driverCols.area')}</th>
                <th scope="col">{t('today.driverCols.stops')}</th>
                <th scope="col">{t('today.driverCols.cash')}</th>
                <th scope="col">{t('today.driverCols.status')}</th>
              </tr>
            </thead>
            <tbody>
              {demoDrivers.map((d) => (
                <tr key={d.name}>
                  <th scope="row">{d.name}</th>
                  <td>{d.area}</td>
                  <td>{t('today.stopsOf', { done: d.done, total: d.total })}</td>
                  <td>{formatINR(d.cashPaise)}</td>
                  <td>
                    {d.closed ? (
                      <Chip tone="success">{t('today.dayClosed')}</Chip>
                    ) : (
                      <Chip tone="info">{t('today.onRoute')}</Chip>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableWrap>
      </section>
    </div>
  );
}
