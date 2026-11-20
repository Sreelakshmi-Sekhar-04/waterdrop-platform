import { useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { DUES_REMINDER_GAP_HOURS, formatINR, istDate } from '@wtrdrop/shared';
import { call } from '../lib/api';
import { errorText } from '../lib/errors';
import { Chip, LiveMessage, PageHeader, TableWrap, maskPhone } from '../components/ui';
import { RecordPaymentDialog, ReversePaymentDialog } from '../components/MoneyDialogs';

interface Due {
  customerId: string;
  name: string | null;
  phoneLast4: string;
  areaName: string | null;
  balancePaise: number;
  creditLimitPaise: number;
  cansHeld: number;
  owingSince: string | null;
  lastPaidOn: string | null;
  lastRemindedAt: string | null;
  overLimit: boolean;
}
interface Dues {
  dues: Due[];
  totals: { customers: number; duePaise: number; overLimit: number };
}
interface Payment {
  id: string;
  customerId: string;
  customerName: string | null;
  method: 'cash' | 'upi';
  amountPaise: number;
  reference: string | null;
  paidOn: string;
  note: string | null;
  fromDelivery: boolean;
  verifiedAt: string | null;
  reversedAt: string | null;
  reverseReason: string | null;
  createdAt: string;
  collectedByName: string | null;
}
interface Refund {
  id: string;
  customerId: string;
  customerName: string | null;
  cans: number;
  amountPaise: number;
  method: 'cash' | 'upi' | 'adjust';
  reason: string | null;
  createdAt: string;
}
interface Payments {
  payments: Payment[];
  refunds: Refund[];
  totals: { cashPaise: number; upiPaise: number; refundedPaise: number };
  toCheck: { count: number; amountPaise: number };
}

type Tab = 'dues' | 'day' | 'upi';
const TABS: Tab[] = ['dues', 'day', 'upi'];

/** Days between an ISO time and today, in India. */
function daysSince(iso: string, today: string): number {
  const d = istDate(new Date(iso));
  return Math.max(
    0,
    Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${d}T00:00:00Z`)) / 86_400_000),
  );
}

/**
 * Payments (Phase 6): who owes what and since when, every payment of a day, and UPI payments the
 * office has not yet seen in the bank. "Not received" never deletes a payment; it adds an entry
 * that puts the amount back on the customer's account.
 */
export function PaymentsPage() {
  const { t, i18n } = useTranslation();
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();
  const today = istDate(new Date());
  const tab = (TABS as string[]).includes(params.get('tab') ?? '')
    ? (params.get('tab') as Tab)
    : 'dues';
  const day = params.get('day') ?? today;
  const [paying, setPaying] = useState<Due | null>(null);
  const [reversing, setReversing] = useState<Payment | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const dues = useQuery({
    queryKey: ['dues'],
    queryFn: () => call<Dues>('/admin/dues'),
    enabled: tab === 'dues',
  });
  const list = useQuery({
    queryKey: ['payments', tab, day],
    queryFn: () =>
      call<Payments>(
        tab === 'upi' ? '/admin/payments?toCheck=1' : `/admin/payments?from=${day}&to=${day}`,
      ),
    enabled: tab !== 'dues',
  });
  const refresh = (text: string) => {
    setMessage(text);
    void qc.invalidateQueries({ queryKey: ['dues'] });
    void qc.invalidateQueries({ queryKey: ['payments'] });
    void qc.invalidateQueries({ queryKey: ['customer-ledgers'] });
  };
  const verify = async (p: Payment) => {
    setError(null);
    try {
      await call(`/admin/payments/${p.id}/verify`, { method: 'POST' });
      refresh(
        t('money.verified', { amount: formatINR(p.amountPaise), name: p.customerName ?? '' }),
      );
    } catch (e) {
      setError(errorText(t, e));
    }
  };
  const go = (next: Tab) => setParams(next === 'dues' ? {} : { tab: next }, { replace: true });
  const dateText = (d: string) =>
    new Date(`${d}T00:00:00Z`).toLocaleDateString(i18n.language === 'ml' ? 'ml-IN' : 'en-IN', {
      day: 'numeric',
      month: 'short',
      timeZone: 'UTC',
    });
  const time = (iso: string) =>
    new Date(iso).toLocaleTimeString(i18n.language === 'ml' ? 'ml-IN' : 'en-IN', {
      hour: '2-digit',
      minute: '2-digit',
      timeZone: 'Asia/Kolkata',
    });

  const paymentStatus = (p: Payment) =>
    p.reversedAt ? (
      <Chip tone="warning">{t('money.status.reversed')}</Chip>
    ) : p.method === 'upi' && !p.verifiedAt ? (
      <Chip tone="info">{t('money.status.toCheck')}</Chip>
    ) : (
      <Chip tone="success">{t('money.status.received')}</Chip>
    );

  const paymentRows = (rows: Payment[]) => (
    <TableWrap label={t(`money.tabs.${tab}`)}>
      <table>
        <thead>
          <tr>
            <th scope="col">{t('money.cols.customer')}</th>
            <th scope="col">{t('money.cols.amount')}</th>
            <th scope="col">{t('money.cols.how')}</th>
            <th scope="col">{t('money.cols.status')}</th>
            <th scope="col">{t('money.cols.actions')}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((p) => (
            <tr key={p.id} className={p.reversedAt ? 'row-muted' : undefined}>
              <th scope="row">
                <Link to={`/customers/${p.customerId}`}>
                  {p.customerName ?? t('customers.noName')}
                </Link>
                <span className="cell-note">
                  {tab === 'upi' ? dateText(p.paidOn) : time(p.createdAt)}
                  {p.collectedByName
                    ? ` · ${t(p.fromDelivery ? 'money.byStaff' : 'money.byOffice', { name: p.collectedByName })}`
                    : ''}
                </span>
              </th>
              <td className="num">{formatINR(p.amountPaise)}</td>
              <td>
                {t(`deliveries.method.${p.method}`)}
                {p.reference ? <span className="cell-note">{p.reference}</span> : null}
              </td>
              <td className="wrap">
                {paymentStatus(p)}
                {p.reverseReason ? <span className="cell-note">{p.reverseReason}</span> : null}
              </td>
              <td>
                {p.reversedAt ? null : (
                  <div className="row-actions">
                    {p.method === 'upi' && !p.verifiedAt ? (
                      <button
                        type="button"
                        className="btn btn-primary btn-compact"
                        onClick={() => void verify(p)}
                        aria-label={t('money.receivedFor', { name: p.customerName ?? '' })}
                      >
                        {t('money.received')}
                      </button>
                    ) : null}
                    <button
                      type="button"
                      className="btn btn-secondary btn-compact"
                      onClick={() => setReversing(p)}
                      aria-label={t('money.notReceivedFor', { name: p.customerName ?? '' })}
                    >
                      {t('money.notReceived')}
                    </button>
                  </div>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </TableWrap>
  );

  const d = dues.data;
  const l = list.data;
  const failed = tab === 'dues' ? dues : list;

  return (
    <div className="page">
      <PageHeader
        title={t('nav.payments')}
        subtitle={t('money.subtitle')}
        actions={
          tab === 'day' ? (
            <label className="inline-field">
              {t('money.day')}
              <input
                type="date"
                max={today}
                value={day}
                onChange={(e) =>
                  e.target.value &&
                  setParams({ tab: 'day', day: e.target.value }, { replace: true })
                }
              />
            </label>
          ) : null
        }
      />
      <div className="filters" role="group" aria-label={t('nav.payments')}>
        {TABS.map((k) => (
          <button
            key={k}
            type="button"
            className="filter"
            aria-pressed={tab === k}
            onClick={() => go(k)}
          >
            {t(`money.tabs.${k}`)}
          </button>
        ))}
      </div>
      <LiveMessage text={message} tone="success" />
      {error ? (
        <p className="field-error" role="alert">
          {error}
        </p>
      ) : null}
      {failed.isError ? (
        <div className="card empty" role="alert">
          {errorText(t, failed.error)}
        </div>
      ) : null}
      {failed.isPending ? <div className="card empty">{t('common.loading')}</div> : null}

      {tab === 'dues' && d ? (
        <>
          <dl className="grid grid-stats" data-testid="dues-totals">
            <div className="card stat">
              <dt>{t('money.totalDue')}</dt>
              <dd className="stat-value tone-warning">{formatINR(d.totals.duePaise)}</dd>
              <dd className="stat-note">
                {t('money.customersOwing', { count: d.totals.customers })}
              </dd>
            </div>
            <div className="card stat">
              <dt>{t('money.overLimit')}</dt>
              <dd className="stat-value">{d.totals.overLimit}</dd>
            </div>
          </dl>
          {d.dues.length === 0 ? (
            <div className="card empty">{t('money.noDues')}</div>
          ) : (
            <TableWrap label={t('money.tabs.dues')}>
              <table>
                <thead>
                  <tr>
                    <th scope="col">{t('money.cols.customer')}</th>
                    <th scope="col">{t('money.cols.due')}</th>
                    <th scope="col">{t('money.cols.since')}</th>
                    <th scope="col">{t('money.cols.lastPaid')}</th>
                    <th scope="col">{t('money.cols.actions')}</th>
                  </tr>
                </thead>
                <tbody>
                  {d.dues.map((r) => {
                    const days = r.owingSince ? daysSince(r.owingSince, today) : null;
                    return (
                      <tr key={r.customerId}>
                        <th scope="row">
                          <Link to={`/customers/${r.customerId}`}>
                            {r.name ?? t('customers.noName')}
                          </Link>
                          <span className="cell-note">
                            {maskPhone(r.phoneLast4)}
                            {r.areaName ? ` · ${r.areaName}` : ''}
                          </span>
                        </th>
                        <td className="num">
                          {formatINR(r.balancePaise)}
                          {r.overLimit ? (
                            <span className="cell-note">
                              <Chip tone="warning">
                                {r.creditLimitPaise > 0
                                  ? t('ledger.overLimit', {
                                      limit: formatINR(r.creditLimitPaise),
                                    })
                                  : t('ledger.noCredit')}
                              </Chip>
                            </span>
                          ) : null}
                        </td>
                        <td>
                          {days === null ? '—' : t('money.daysAgo', { count: days })}
                          {days !== null && days > 30 ? (
                            <span className="cell-note">
                              <Chip tone="warning">{t('money.overMonth')}</Chip>
                            </span>
                          ) : null}
                        </td>
                        <td>{r.lastPaidOn ? dateText(r.lastPaidOn) : t('money.never')}</td>
                        <td>
                          <div className="row-actions">
                            <button
                              type="button"
                              className="btn btn-primary btn-compact"
                              onClick={() => setPaying(r)}
                              aria-label={t('money.recordFor', { name: r.name ?? '' })}
                            >
                              {t('money.recordPayment')}
                            </button>
                            <RemindButton due={r} onDone={refresh} onError={setError} />
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </TableWrap>
          )}
        </>
      ) : null}

      {tab === 'day' && l ? (
        <>
          <dl className="grid grid-stats" data-testid="day-totals">
            <div className="card stat">
              <dt>{t('deliveries.method.cash')}</dt>
              <dd className="stat-value">{formatINR(l.totals.cashPaise)}</dd>
            </div>
            <div className="card stat">
              <dt>{t('deliveries.method.upi')}</dt>
              <dd className="stat-value">{formatINR(l.totals.upiPaise)}</dd>
            </div>
            <div className="card stat">
              <dt>{t('money.refundsPaid')}</dt>
              <dd className="stat-value">{formatINR(l.totals.refundedPaise)}</dd>
            </div>
          </dl>
          {l.payments.length === 0 ? (
            <div className="card empty">{t('money.noPayments', { day: dateText(day) })}</div>
          ) : (
            paymentRows(l.payments)
          )}
          {l.refunds.length > 0 ? (
            <section aria-labelledby="refunds-h">
              <h2 id="refunds-h">{t('money.refunds')}</h2>
              <TableWrap label={t('money.refunds')}>
                <table>
                  <thead>
                    <tr>
                      <th scope="col">{t('money.cols.customer')}</th>
                      <th scope="col">{t('money.cols.amount')}</th>
                      <th scope="col">{t('money.cols.how')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {l.refunds.map((r) => (
                      <tr key={r.id}>
                        <th scope="row">
                          <Link to={`/customers/${r.customerId}`}>
                            {r.customerName ?? t('customers.noName')}
                          </Link>
                          <span className="cell-note">
                            {t('money.refundCansNote', { count: r.cans })}
                          </span>
                        </th>
                        <td className="num">{formatINR(r.amountPaise)}</td>
                        <td className="wrap">
                          {t(`money.refundMethod.${r.method}`)}
                          {r.reason ? <span className="cell-note">{r.reason}</span> : null}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableWrap>
            </section>
          ) : null}
        </>
      ) : null}

      {tab === 'upi' && l ? (
        <>
          <p className="muted">{t('money.upiHelp')}</p>
          {l.payments.length === 0 ? (
            <div className="card empty">{t('money.upiNone')}</div>
          ) : (
            paymentRows(l.payments)
          )}
        </>
      ) : null}

      <RecordPaymentDialog
        open={!!paying}
        customerId={paying?.customerId ?? ''}
        customerName={paying?.name ?? t('customers.noName')}
        duePaise={paying?.balancePaise ?? 0}
        onClose={() => setPaying(null)}
        onSaved={refresh}
      />
      <ReversePaymentDialog
        payment={reversing}
        onClose={() => setReversing(null)}
        onSaved={refresh}
      />
    </div>
  );
}

/**
 * Sends the customer a message about their dues (push and in the app). Once a day at most, so the
 * button says when the last one went.
 */
function RemindButton({
  due,
  onDone,
  onError,
}: {
  due: Due;
  onDone: (text: string) => void;
  onError: (text: string | null) => void;
}) {
  const { t, i18n } = useTranslation();
  const [busy, setBusy] = useState(false);
  const last = due.lastRemindedAt ? new Date(due.lastRemindedAt) : null;
  const recent = last !== null && Date.now() - last.getTime() < DUES_REMINDER_GAP_HOURS * 3600_000;
  const name = due.name ?? t('customers.noName');
  const send = async () => {
    setBusy(true);
    onError(null);
    try {
      await call(`/admin/customers/${due.customerId}/remind`, { method: 'POST' });
      onDone(t('money.reminded', { name }));
    } catch (e) {
      onError(errorText(t, e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <button
        type="button"
        className="btn btn-secondary btn-compact"
        disabled={busy || recent}
        onClick={() => void send()}
        aria-label={t('money.remindFor', { name })}
      >
        {t('money.remind')}
      </button>
      {last ? (
        <span className="cell-note">
          {t('money.lastReminded', {
            when: last.toLocaleString(i18n.language === 'ml' ? 'ml-IN' : 'en-IN', {
              day: 'numeric',
              month: 'short',
              hour: '2-digit',
              minute: '2-digit',
              timeZone: 'Asia/Kolkata',
            }),
          })}
        </span>
      ) : null}
    </>
  );
}
