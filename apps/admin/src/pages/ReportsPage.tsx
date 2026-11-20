import { useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import {
  addDays,
  DATED_REPORTS,
  formatINR,
  isoDateSchema,
  istDate,
  REPORTS,
  type ReportName,
} from '@wtrdrop/shared';
import { call, download } from '../lib/api';
import { errorText } from '../lib/errors';
import { Chip, PageHeader, TableWrap } from '../components/ui';

type Cell = string | number | boolean | null;
interface Report {
  name: ReportName;
  from: string | null;
  to: string | null;
  columns: string[];
  rows: Record<string, Cell>[];
  totals: Record<string, Cell>;
  facts?: Record<string, Cell>;
}
interface AuditItem {
  id: number;
  actorName: string | null;
  actorRole: string | null;
  action: string;
  entityType: string;
  entityId: string | null;
  before: unknown;
  after: unknown;
  createdAt: string;
}

type Tab = ReportName | 'activity';
const TABS: Tab[] = [...REPORTS, 'activity'];
/** The groups of actions the activity log can be narrowed to (the start of each action name). */
const ACTION_GROUPS = [
  'order',
  'delivery',
  'trip',
  'payment',
  'deposit',
  'dues',
  'stock',
  'complaint',
  'customer',
  'price',
  'settings',
  'business',
  'staff',
  'admin',
] as const;

const signedINR = (p: number) => (p < 0 ? `−${formatINR(-p)}` : formatINR(p));

/**
 * Reports (Phase 7): the six core reports of Phase 0 §13.3, each with a CSV download, and the
 * activity log (who did what, when). Every number comes from the same records as the other pages.
 */
export function ReportsPage() {
  const { t, i18n } = useTranslation();
  const [params, setParams] = useSearchParams();
  const today = istDate(new Date());
  const tab = (TABS as string[]).includes(params.get('r') ?? '')
    ? (params.get('r') as Tab)
    : 'sales';
  const valid = (k: string) => isoDateSchema.safeParse(params.get(k)).success;
  const to = valid('to') ? params.get('to')! : today;
  const from = valid('from') ? params.get('from')! : addDays(to, -6);
  const dated = tab !== 'activity' && DATED_REPORTS.includes(tab);
  const set = (next: Record<string, string>) =>
    setParams({ r: tab, ...(dated ? { from, to } : {}), ...next }, { replace: true });
  const [error, setError] = useState<string | null>(null);

  const q = useQuery({
    queryKey: ['report', tab, dated ? from : '', dated ? to : ''],
    queryFn: async () =>
      (
        await call<{ report: Report }>(
          `/admin/reports/${tab}${dated ? `?from=${from}&to=${to}` : ''}`,
        )
      ).report,
    enabled: tab !== 'activity',
  });
  const r = q.data;
  const locale = i18n.language === 'ml' ? 'ml-IN' : 'en-IN';
  const dateText = (d: string) =>
    new Date(`${d}T00:00:00Z`).toLocaleDateString(locale, {
      day: 'numeric',
      month: 'short',
      timeZone: 'UTC',
    });

  const cell = (col: string, v: Cell, row: Record<string, Cell>) => {
    if (v === null || v === '') return '—';
    if (col.endsWith('_paise')) return signedINR(Number(v));
    if (typeof v === 'boolean') return v ? <Chip tone="warning">{t('reports.yes')}</Chip> : '';
    if (col === 'date' || col === 'last_paid' || col === 'last_movement')
      return dateText(String(v));
    if (col === 'customer' && row.customer_id)
      return <Link to={`/customers/${String(row.customer_id)}`}>{String(v)}</Link>;
    if (col === 'status') return t(`today.routeStatus.${String(v)}`, { defaultValue: String(v) });
    if (col === 'kind') return t(`reports.kinds.${String(v)}`, { defaultValue: String(v) });
    if (col === 'age') return t('reports.days', { range: String(v) });
    return typeof v === 'number' ? v.toLocaleString(locale) : String(v);
  };
  const csv = async () => {
    setError(null);
    try {
      await download(
        `/admin/reports/${tab}?format=csv${dated ? `&from=${from}&to=${to}` : ''}`,
        `wtrdrop-${tab}.csv`,
      );
    } catch (e) {
      setError(errorText(t, e));
    }
  };

  return (
    <div className="page">
      <PageHeader
        title={t('nav.reports')}
        subtitle={t(`reports.about.${tab}`)}
        actions={
          tab !== 'activity' ? (
            <button
              type="button"
              className="btn btn-secondary"
              disabled={!r}
              onClick={() => void csv()}
            >
              {t('reports.csv')}
            </button>
          ) : null
        }
      />
      <div className="filters" role="group" aria-label={t('nav.reports')}>
        {TABS.map((k) => (
          <button
            key={k}
            type="button"
            className="filter"
            aria-pressed={tab === k}
            onClick={() => setParams({ r: k }, { replace: true })}
          >
            {t(`reports.tabs.${k}`)}
          </button>
        ))}
      </div>
      {error ? (
        <p className="field-error" role="alert">
          {error}
        </p>
      ) : null}

      {tab === 'activity' ? (
        <ActivityLog />
      ) : (
        <>
          {dated ? (
            <div className="row-actions" role="group" aria-label={t('reports.range')}>
              <label className="inline-field">
                {t('reports.from')}
                <input
                  type="date"
                  value={from}
                  max={to}
                  onChange={(e) => e.target.value && set({ from: e.target.value })}
                />
              </label>
              <label className="inline-field">
                {t('reports.to')}
                <input
                  type="date"
                  value={to}
                  max={today}
                  onChange={(e) => e.target.value && set({ to: e.target.value })}
                />
              </label>
              {[7, 30].map((n) => (
                <button
                  key={n}
                  type="button"
                  className="btn btn-secondary btn-compact"
                  onClick={() => set({ from: addDays(today, 1 - n), to: today })}
                >
                  {t('reports.lastDays', { count: n })}
                </button>
              ))}
            </div>
          ) : (
            <p className="muted">{t('reports.asOfNow')}</p>
          )}
          {q.isError ? (
            <div className="card empty" role="alert">
              {errorText(t, q.error)}
            </div>
          ) : null}
          {q.isPending ? <div className="card empty">{t('common.loading')}</div> : null}
          {r ? (
            <>
              {r.facts ? (
                <dl className="grid grid-stats" data-testid="report-facts">
                  {Object.entries(r.facts)
                    .filter(([, v]) => v !== 0 || r.name === 'stock')
                    .map(([k, v]) => (
                      <div key={k} className="card stat">
                        <dt>{t(`reports.facts.${k}`)}</dt>
                        <dd className={`stat-value${v === false ? ' tone-warning' : ''}`}>
                          {typeof v === 'boolean'
                            ? v
                              ? t('reports.adds')
                              : t('reports.doesNotAdd')
                            : String(v)}
                        </dd>
                      </div>
                    ))}
                </dl>
              ) : null}
              {r.rows.length === 0 ? (
                <div className="card empty">{t('reports.empty')}</div>
              ) : (
                <TableWrap label={t(`reports.tabs.${r.name}`)}>
                  <table data-testid="report-table">
                    <thead>
                      <tr>
                        {r.columns.map((c) => (
                          <th key={c} scope="col">
                            {t(`reports.cols.${c}`)}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {r.rows.map((row, i) => (
                        <tr key={i}>
                          {r.columns.map((c, j) =>
                            j === 0 ? (
                              <th key={c} scope="row">
                                {cell(c, row[c] ?? null, row)}
                              </th>
                            ) : (
                              <td
                                key={c}
                                className={typeof row[c] === 'number' ? 'num' : undefined}
                              >
                                {cell(c, row[c] ?? null, row)}
                              </td>
                            ),
                          )}
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr>
                        {r.columns.map((c, j) => (
                          <td key={c} className={j > 0 ? 'num' : undefined}>
                            {j === 0
                              ? t('reports.total')
                              : c in r.totals
                                ? cell(c, r.totals[c] ?? null, {})
                                : ''}
                          </td>
                        ))}
                      </tr>
                    </tfoot>
                  </table>
                </TableWrap>
              )}
              {r.name === 'dues' ? (
                <p className="muted" data-testid="dues-ageing">
                  {t('reports.ageing', {
                    a: formatINR(Number(r.totals['age_0-7'] ?? 0)),
                    b: formatINR(Number(r.totals['age_8-30'] ?? 0)),
                    c: formatINR(Number(r.totals['age_31-60'] ?? 0)),
                    d: formatINR(Number(r.totals['age_61+'] ?? 0)),
                  })}
                </p>
              ) : null}
            </>
          ) : null}
        </>
      )}
    </div>
  );
}

/** Who did what and when, newest first. "Show more" loads older entries. */
function ActivityLog() {
  const { t, i18n } = useTranslation();
  const [group, setGroup] = useState('');
  const [day, setDay] = useState('');
  const q = useInfiniteQuery({
    queryKey: ['audit', group, day],
    initialPageParam: 0,
    queryFn: ({ pageParam }) =>
      call<{ items: AuditItem[]; nextBefore: number | null }>(
        `/admin/audit-logs?limit=50${group ? `&action=${group}` : ''}${
          day ? `&from=${day}&to=${day}` : ''
        }${pageParam ? `&before=${pageParam}` : ''}`,
      ),
    getNextPageParam: (last) => last.nextBefore ?? undefined,
  });
  const items = q.data?.pages.flatMap((p) => p.items) ?? [];
  const when = (iso: string) =>
    new Date(iso).toLocaleString(i18n.language === 'ml' ? 'ml-IN' : 'en-IN', {
      day: 'numeric',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
      timeZone: 'Asia/Kolkata',
    });
  const detail = (v: unknown) =>
    v && typeof v === 'object' && Object.keys(v).length ? JSON.stringify(v, null, 1) : null;

  return (
    <section aria-labelledby="activity-h">
      <h2 id="activity-h" className="visually-hidden">
        {t('reports.tabs.activity')}
      </h2>
      <div className="row-actions">
        <label className="inline-field">
          {t('reports.what')}
          <select value={group} onChange={(e) => setGroup(e.target.value)}>
            <option value="">{t('reports.everything')}</option>
            {ACTION_GROUPS.map((g) => (
              <option key={g} value={g}>
                {t(`reports.groups.${g}`)}
              </option>
            ))}
          </select>
        </label>
        <label className="inline-field">
          {t('reports.day')}
          <input type="date" value={day} onChange={(e) => setDay(e.target.value)} />
        </label>
      </div>
      {q.isError ? (
        <div className="card empty" role="alert">
          {errorText(t, q.error)}
        </div>
      ) : null}
      {q.isPending ? <div className="card empty">{t('common.loading')}</div> : null}
      {q.isSuccess && items.length === 0 ? (
        <div className="card empty">{t('reports.noActivity')}</div>
      ) : null}
      {items.length > 0 ? (
        <TableWrap label={t('reports.tabs.activity')}>
          <table data-testid="activity">
            <thead>
              <tr>
                <th scope="col">{t('stock.cols.when')}</th>
                <th scope="col">{t('reports.who')}</th>
                <th scope="col">{t('reports.what')}</th>
                <th scope="col">{t('reports.details')}</th>
              </tr>
            </thead>
            <tbody>
              {items.map((i) => {
                const before = detail(i.before);
                const after = detail(i.after);
                return (
                  <tr key={i.id}>
                    <td>{when(i.createdAt)}</td>
                    <td>
                      {i.actorName ?? t('reports.system')}
                      {i.actorRole ? (
                        <span className="cell-note">{t(`roles.${i.actorRole}`)}</span>
                      ) : null}
                    </td>
                    <th scope="row">
                      {t(`reports.actions.${i.action.replace(/\./g, '_')}`, {
                        defaultValue: i.action,
                      })}
                    </th>
                    <td className="wrap">
                      {before || after ? (
                        <details>
                          <summary>{t('reports.show')}</summary>
                          {before ? (
                            <>
                              <span className="cell-note">{t('reports.before')}</span>
                              <pre className="json">{before}</pre>
                            </>
                          ) : null}
                          {after ? (
                            <>
                              <span className="cell-note">{t('reports.after')}</span>
                              <pre className="json">{after}</pre>
                            </>
                          ) : null}
                        </details>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </TableWrap>
      ) : null}
      {q.hasNextPage ? (
        <button
          type="button"
          className="btn btn-secondary"
          disabled={q.isFetchingNextPage}
          onClick={() => void q.fetchNextPage()}
        >
          {t('reports.more')}
        </button>
      ) : null}
    </section>
  );
}
