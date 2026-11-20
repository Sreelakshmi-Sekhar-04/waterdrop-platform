import { Link, useParams, useSearchParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { addMonths, formatINR, istDate } from '@wtrdrop/shared';
import { call } from '../lib/api';
import { errorText } from '../lib/errors';
import { TableWrap } from '../components/ui';

export interface Statement {
  month: string;
  supplier: { name: string; gstin: string | null };
  customer: { name: string | null; phone?: string; type?: string };
  money: { openingPaise: number; chargedPaise: number; paidPaise: number; closingPaise: number };
  cans: { opening: number; delivered: number; returned: number; closing: number };
  deposit: { heldPaise: number; coverCans: number };
  entries: {
    id: number;
    at: string;
    entryType: string;
    deltaPaise: number;
    balanceAfterPaise: number;
    orderNo: number | null;
    cans: number | null;
    method: 'cash' | 'upi' | null;
    reason?: string | null;
  }[];
}

/**
 * D-11: one month of a customer's account, laid out to print on one A4 sheet. The numbers come
 * from the ledgers, so a printed statement always agrees with the customer page.
 */
export function StatementPage() {
  const { t, i18n } = useTranslation();
  const { id = '' } = useParams();
  const [params, setParams] = useSearchParams();
  const thisMonth = istDate(new Date()).slice(0, 7);
  const month = /^\d{4}-(0[1-9]|1[0-2])$/.test(params.get('month') ?? '')
    ? params.get('month')!
    : thisMonth;
  const q = useQuery({
    queryKey: ['statement', id, month],
    queryFn: async () =>
      (await call<{ statement: Statement }>(`/admin/customers/${id}/statement?month=${month}`))
        .statement,
  });
  const locale = i18n.language === 'ml' ? 'ml-IN' : 'en-IN';
  const monthName = (m: string) =>
    new Date(`${m}-01T00:00:00Z`).toLocaleDateString(locale, {
      month: 'long',
      year: 'numeric',
      timeZone: 'UTC',
    });
  const when = (iso: string) =>
    new Date(iso).toLocaleDateString(locale, {
      day: 'numeric',
      month: 'short',
      timeZone: 'Asia/Kolkata',
    });
  // Positive is owed by the customer; negative is paid in advance.
  const balance = (p: number) =>
    p > 0
      ? t('ledger.dueAmount', { amount: formatINR(p) })
      : p < 0
        ? t('statement.advance', { amount: formatINR(-p) })
        : formatINR(0);
  const signedINR = (p: number) => (p > 0 ? `+${formatINR(p)}` : `−${formatINR(-p)}`);
  const setMonth = (m: string) => setParams({ month: m }, { replace: true });
  const s = q.data;

  const detail = (e: Statement['entries'][number]) =>
    [
      e.orderNo ? t('statement.orderNo', { n: e.orderNo }) : null,
      e.cans && e.entryType === 'delivery_charge' ? t('statement.cans', { count: e.cans }) : null,
      e.method ? t(`deliveries.method.${e.method}`) : null,
      e.reason ?? null,
    ]
      .filter(Boolean)
      .join(' · ');

  return (
    <div className="page statement-page">
      <div className="no-print statement-tools">
        <Link to={`/customers/${id}`}>{t('statement.back')}</Link>
        <div className="row-actions">
          <button
            type="button"
            className="btn btn-secondary btn-compact"
            onClick={() => setMonth(addMonths(month, -1))}
          >
            {t('statement.previous')}
          </button>
          <button
            type="button"
            className="btn btn-secondary btn-compact"
            disabled={month >= thisMonth}
            onClick={() => setMonth(addMonths(month, 1))}
          >
            {t('statement.next')}
          </button>
          <button
            type="button"
            className="btn btn-primary btn-compact"
            disabled={!s}
            onClick={() => window.print()}
          >
            {t('statement.print')}
          </button>
        </div>
      </div>
      {q.isError ? (
        <div className="card empty" role="alert">
          {errorText(t, q.error)}
        </div>
      ) : null}
      {q.isPending ? <div className="card empty">{t('common.loading')}</div> : null}
      {s ? (
        <article className="statement card" aria-labelledby="statement-h">
          <header className="statement-head">
            <div>
              <strong>{s.supplier.name}</strong>
              {s.supplier.gstin ? (
                <span className="cell-note">GSTIN {s.supplier.gstin}</span>
              ) : null}
            </div>
            <div className="statement-title">
              <h1 id="statement-h">{t('statement.title')}</h1>
              <span>{monthName(s.month)}</span>
            </div>
          </header>
          <p className="statement-customer">
            <strong>{s.customer.name ?? t('customers.noName')}</strong>
            {s.customer.phone
              ? ` · +91 ${s.customer.phone.slice(3, 8)} ${s.customer.phone.slice(8)}`
              : ''}
          </p>
          <dl className="statement-sums" data-testid="statement-sums">
            <div>
              <dt>{t('statement.opening')}</dt>
              <dd>{balance(s.money.openingPaise)}</dd>
            </div>
            <div>
              <dt>{t('statement.charged')}</dt>
              <dd>{formatINR(s.money.chargedPaise)}</dd>
            </div>
            <div>
              <dt>{t('statement.paid')}</dt>
              <dd>{formatINR(s.money.paidPaise)}</dd>
            </div>
            <div className="statement-closing">
              <dt>{t('statement.closing')}</dt>
              <dd>{balance(s.money.closingPaise)}</dd>
            </div>
          </dl>
          <p className="muted">
            {t('statement.cansLine', {
              delivered: s.cans.delivered,
              returned: s.cans.returned,
              closing: s.cans.closing,
            })}{' '}
            {t('statement.depositLine', {
              amount: formatINR(s.deposit.heldPaise),
              count: s.deposit.coverCans,
            })}
          </p>
          {s.entries.length === 0 ? (
            <p className="empty">{t('statement.noEntries')}</p>
          ) : (
            <TableWrap label={t('statement.title')}>
              <table>
                <thead>
                  <tr>
                    <th scope="col">{t('statement.cols.date')}</th>
                    <th scope="col">{t('statement.cols.what')}</th>
                    <th scope="col">{t('statement.cols.amount')}</th>
                    <th scope="col">{t('statement.cols.balance')}</th>
                  </tr>
                </thead>
                <tbody>
                  {s.entries.map((e) => (
                    <tr key={e.id}>
                      <td>{when(e.at)}</td>
                      <th scope="row" className="wrap">
                        {e.entryType === 'reversal' && e.method
                          ? t('statement.notReceived')
                          : t(`ledger.entry.${e.entryType}`)}
                        {detail(e) ? <span className="cell-note">{detail(e)}</span> : null}
                      </th>
                      <td className="num">{signedINR(e.deltaPaise)}</td>
                      <td className="num">{balance(e.balanceAfterPaise)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrap>
          )}
          <p className="field-hint">{t('statement.footer')}</p>
        </article>
      ) : null}
    </div>
  );
}
