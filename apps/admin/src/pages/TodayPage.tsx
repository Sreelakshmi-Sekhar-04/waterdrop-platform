import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { formatINR } from '@wtrdrop/shared';
import { call } from '../lib/api';
import { errorText } from '../lib/errors';
import { Chip, LiveMessage, PageHeader, SearchField, TableWrap } from '../components/ui';
import { NewOrderDialog, createdText } from '../components/NewOrderDialog';

interface Dashboard {
  today: string;
  attention: {
    toAccept: number;
    unassigned: number;
    toReschedule: number;
    complaints: number;
    upiToCheck: { count: number; amountPaise: number };
    routesToCheck: { count: number; cashDifferencePaise: number };
    lowStock: { needed: number; available: number } | null;
  };
  numbers: {
    ordersToday: number;
    deliveredToday: number;
    cansDeliveredToday: number;
    cashTodayPaise: number;
    upiTodayPaise: number;
    duePaise: number;
    customersOwing: number;
    cansWithCustomers: number;
    depotFull: number;
    cansTomorrow: number;
  };
  routes: {
    id: string;
    staffName: string | null;
    status: 'planned' | 'on_route' | 'ended' | 'reconciled';
    delivered: number;
    failed: number;
    remaining: number;
    cashPaise: number;
  }[];
}

interface Item {
  key: string;
  count: string;
  text: string;
  to: string;
  action: string;
  warning?: boolean;
}

const signedINR = (p: number) => (p < 0 ? `−${formatINR(-p)}` : formatINR(p));

/**
 * Today (Phase 7): a "needs attention" inbox first, then today's numbers and each route
 * (Phase 0 §3.5, C-11). Only items with something to do are shown; each opens the page that does
 * it. Refreshes every minute.
 */
export function TodayPage() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const q = useQuery({
    queryKey: ['dashboard'],
    queryFn: () => call<Dashboard>('/admin/dashboard'),
    refetchInterval: 60_000,
  });
  const day = new Intl.DateTimeFormat(i18n.language === 'ml' ? 'ml-IN' : 'en-IN', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    timeZone: 'Asia/Kolkata',
  }).format(new Date());
  const d = q.data;
  const a = d?.attention;

  const items: Item[] = a
    ? [
        {
          key: 'toAccept',
          count: String(a.toAccept),
          text: t('today.items.toAccept', { count: a.toAccept }),
          to: '/orders?show=toAccept',
          action: t('today.actions.accept'),
        },
        {
          key: 'unassigned',
          count: String(a.unassigned),
          text: t('today.items.unassigned', { count: a.unassigned }),
          to: '/deliveries',
          action: t('today.actions.assign'),
        },
        {
          key: 'toReschedule',
          count: String(a.toReschedule),
          text: t('today.items.toReschedule', { count: a.toReschedule }),
          to: '/deliveries',
          action: t('today.actions.reschedule'),
          warning: true,
        },
        {
          key: 'routes',
          count: String(a.routesToCheck.count),
          text:
            a.routesToCheck.cashDifferencePaise !== 0
              ? t('today.items.routesCash', {
                  count: a.routesToCheck.count,
                  amount: signedINR(a.routesToCheck.cashDifferencePaise),
                })
              : t('today.items.routes', { count: a.routesToCheck.count }),
          to: '/deliveries',
          action: t('today.actions.check'),
          warning: a.routesToCheck.cashDifferencePaise < 0,
        },
        {
          key: 'complaints',
          count: String(a.complaints),
          text: t('today.items.complaints', { count: a.complaints }),
          to: '/complaints',
          action: t('today.actions.open'),
          warning: true,
        },
        {
          key: 'upi',
          count: String(a.upiToCheck.count),
          text: t('today.items.upi', {
            count: a.upiToCheck.count,
            amount: formatINR(a.upiToCheck.amountPaise),
          }),
          to: '/payments?tab=upi',
          action: t('today.actions.check'),
        },
      ].filter((i) => i.count !== '0')
    : [];
  if (a?.lowStock)
    items.push({
      key: 'lowStock',
      count: String(a.lowStock.available),
      text: t('today.items.lowStock', { needed: a.lowStock.needed }),
      to: '/stock',
      action: t('today.actions.stock'),
      warning: true,
    });

  return (
    <div className="page">
      <PageHeader
        title={t('today.title')}
        subtitle={day}
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
            <button type="button" className="btn btn-primary" onClick={() => setAdding(true)}>
              {t('today.newOrder')}
            </button>
          </>
        }
      />
      <LiveMessage text={message} tone="success" />
      <NewOrderDialog
        open={adding}
        onClose={() => setAdding(false)}
        onCreated={(o) => setMessage(createdText(t, o))}
      />
      {q.isError ? (
        <div className="card empty" role="alert">
          {errorText(t, q.error)}
        </div>
      ) : null}
      {q.isPending ? <div className="card empty">{t('common.loading')}</div> : null}

      {d ? (
        <>
          <section aria-labelledby="attention-h">
            <h2 id="attention-h">{t('today.attention')}</h2>
            {items.length === 0 ? (
              <div className="card empty">{t('today.allClear')}</div>
            ) : (
              <ul className="grid grid-attention" data-testid="attention">
                {items.map((i, n) => (
                  <li key={i.key} className="card attention">
                    <span className={`big-number${i.warning ? ' tone-warning' : ''}`}>
                      {i.count}
                    </span>
                    <span>{i.text}</span>
                    <Link
                      to={i.to}
                      className={`btn ${n === 0 ? 'btn-primary' : 'btn-secondary'} btn-compact`}
                      aria-label={`${i.action}: ${i.count} ${i.text}`}
                    >
                      {i.action}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section aria-labelledby="sofar-h">
            <h2 id="sofar-h">{t('today.soFar')}</h2>
            <dl className="grid grid-stats" data-testid="today-numbers">
              <div className="card stat">
                <dt>{t('today.stats.orders')}</dt>
                <dd className="stat-value">{d.numbers.ordersToday}</dd>
                <dd className="stat-note">
                  {t('today.stats.tomorrow', { count: d.numbers.cansTomorrow })}
                </dd>
              </div>
              <div className="card stat">
                <dt>{t('today.stats.delivered')}</dt>
                <dd className="stat-value tone-success">{d.numbers.deliveredToday}</dd>
                <dd className="stat-note">
                  {t('today.stats.cans', { count: d.numbers.cansDeliveredToday })}
                </dd>
              </div>
              <div className="card stat">
                <dt>{t('today.stats.collected')}</dt>
                <dd className="stat-value">
                  {formatINR(d.numbers.cashTodayPaise + d.numbers.upiTodayPaise)}
                </dd>
                <dd className="stat-note">
                  {t('today.stats.breakdown', {
                    cash: formatINR(d.numbers.cashTodayPaise),
                    upi: formatINR(d.numbers.upiTodayPaise),
                  })}
                </dd>
              </div>
              <div className="card stat">
                <dt>{t('today.stats.due')}</dt>
                <dd className="stat-value tone-warning">{formatINR(d.numbers.duePaise)}</dd>
                <dd className="stat-note">
                  <Link to="/payments">
                    {t('today.stats.owing', { count: d.numbers.customersOwing })}
                  </Link>
                </dd>
              </div>
              <div className="card stat">
                <dt>{t('today.stats.cansOut')}</dt>
                <dd className="stat-value">{d.numbers.cansWithCustomers}</dd>
              </div>
              <div className="card stat">
                <dt>{t('today.stats.depotFull')}</dt>
                <dd className="stat-value">{d.numbers.depotFull}</dd>
              </div>
            </dl>
          </section>

          <section aria-labelledby="drivers-h">
            <h2 id="drivers-h">{t('today.drivers')}</h2>
            {d.routes.length === 0 ? (
              <div className="card empty">
                {t('today.noRoutes')} <Link to="/deliveries">{t('nav.deliveries')}</Link>
              </div>
            ) : (
              <TableWrap label={t('today.drivers')}>
                <table>
                  <thead>
                    <tr>
                      <th scope="col">{t('today.driverCols.driver')}</th>
                      <th scope="col">{t('today.driverCols.stops')}</th>
                      <th scope="col">{t('today.driverCols.cash')}</th>
                      <th scope="col">{t('today.driverCols.status')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {d.routes.map((r) => (
                      <tr key={r.id}>
                        <th scope="row">{r.staffName ?? '—'}</th>
                        <td>
                          {t('today.stopsOf', {
                            done: r.delivered + r.failed,
                            total: r.delivered + r.failed + r.remaining,
                          })}
                          {r.failed > 0 ? (
                            <span className="cell-note">
                              {t('today.failedStops', { count: r.failed })}
                            </span>
                          ) : null}
                        </td>
                        <td className="num">{formatINR(r.cashPaise)}</td>
                        <td>
                          <Chip
                            tone={
                              r.status === 'reconciled'
                                ? 'success'
                                : r.status === 'ended'
                                  ? 'warning'
                                  : 'info'
                            }
                          >
                            {t(`today.routeStatus.${r.status}`)}
                          </Chip>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableWrap>
            )}
          </section>
        </>
      ) : null}
    </div>
  );
}
