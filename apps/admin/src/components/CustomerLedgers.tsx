import { useState } from 'react';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { formatINR } from '@wtrdrop/shared';
import { call } from '../lib/api';
import { isOwner, useAuth } from '../lib/auth';
import { errorText } from '../lib/errors';
import { Chip, LiveMessage, TableWrap } from './ui';
import {
  CorrectionDialog,
  CreditLimitDialog,
  RecordPaymentDialog,
  RefundDialog,
} from './MoneyDialogs';

interface Ledgers {
  balances: {
    cansHeld: number;
    depositHeldPaise: number;
    depositCoverCans: number;
    balancePaise: number;
    creditLimitPaise: number;
  };
  cans: {
    id: number;
    entryType: string;
    delta: number;
    balanceAfter: number;
    orderId: string | null;
    reason: string | null;
    at: string;
  }[];
  deposit: {
    id: number;
    entryType: string;
    deltaPaise: number;
    deltaCans: number;
    balanceAfterPaise: number;
    coverAfterCans: number;
    orderId: string | null;
    reason: string | null;
    at: string;
  }[];
  money: {
    id: number;
    entryType: string;
    deltaPaise: number;
    balanceAfterPaise: number;
    orderId: string | null;
    reason: string | null;
    at: string;
  }[];
}

type Tab = 'cans' | 'deposit' | 'money';
type Open = 'pay' | 'refund' | 'correct' | 'limit' | null;

const signed = (n: number) => (n > 0 ? `+${n}` : String(n));
const signedINR = (p: number) => (p > 0 ? `+${formatINR(p)}` : `−${formatINR(-p)}`);

/**
 * A customer's three ledgers (Phase 5): balances on top, every entry below. Entries are never
 * edited; Phase 6 adds the office actions that post new entries (payment, refund, correction).
 */
export function CustomerLedgers({
  customerId,
  customerName,
}: {
  customerId: string;
  customerName: string;
}) {
  const { t, i18n } = useTranslation();
  const { me } = useAuth();
  const qc = useQueryClient();
  const [tab, setTab] = useState<Tab>('cans');
  const [open, setOpen] = useState<Open>(null);
  const [message, setMessage] = useState<string | null>(null);
  const saved = (text: string) => {
    setMessage(text);
    void qc.invalidateQueries({ queryKey: ['customer-ledgers', customerId] });
    void qc.invalidateQueries({ queryKey: ['customer-payments', customerId] });
    void qc.invalidateQueries({ queryKey: ['dues'] });
    void qc.invalidateQueries({ queryKey: ['payments'] });
  };
  const q = useQuery({
    queryKey: ['customer-ledgers', customerId],
    queryFn: () => call<Ledgers>(`/admin/customers/${customerId}/ledgers`),
  });
  const when = (iso: string) =>
    new Date(iso).toLocaleString(i18n.language === 'ml' ? 'ml-IN' : 'en-IN', {
      day: 'numeric',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
      timeZone: 'Asia/Kolkata',
    });
  const b = q.data?.balances;
  const owes = (b?.balancePaise ?? 0) > 0;
  // Same rule as the delivery screen (D-03): a due above the limit is flagged, never blocked.
  const over = !!b && b.balancePaise > 0 && b.balancePaise > b.creditLimitPaise;
  const orderLink = (id: string | null) =>
    id ? <Link to={`/orders/${id}`}>{t('ledger.order')}</Link> : null;

  return (
    <section aria-labelledby="ledger-h">
      <div className="section-head">
        <h2 id="ledger-h">{t('ledger.title')}</h2>
        {b ? (
          <div className="row-actions">
            <button
              type="button"
              className="btn btn-primary btn-compact"
              onClick={() => setOpen('pay')}
            >
              {t('money.recordPayment')}
            </button>
            <button
              type="button"
              className="btn btn-secondary btn-compact"
              onClick={() => setOpen('refund')}
            >
              {t('money.refundDeposit')}
            </button>
            <button
              type="button"
              className="btn btn-secondary btn-compact"
              onClick={() => setOpen('correct')}
            >
              {t('money.correct')}
            </button>
            <Link
              className="btn btn-secondary btn-compact"
              to={`/customers/${customerId}/statement`}
            >
              {t('statement.open')}
            </Link>
          </div>
        ) : null}
      </div>
      <LiveMessage text={message} tone="success" />
      {q.isError ? (
        <div className="card empty" role="alert">
          {errorText(t, q.error)}
        </div>
      ) : null}
      {q.isPending ? <div className="card empty">{t('common.loading')}</div> : null}
      {b && q.data ? (
        <>
          <dl className="grid grid-stats" data-testid="customer-balances">
            <div className="card stat">
              <dt>{t('ledger.cansHeld')}</dt>
              <dd className="stat-value">{b.cansHeld}</dd>
            </div>
            <div className="card stat">
              <dt>{t('ledger.deposit')}</dt>
              <dd className="stat-value">{formatINR(b.depositHeldPaise)}</dd>
              <dd className="stat-note">{t('ledger.cover', { count: b.depositCoverCans })}</dd>
            </div>
            <div className="card stat">
              <dt>{b.balancePaise < 0 ? t('ledger.advance') : t('ledger.due')}</dt>
              <dd className={`stat-value${owes ? ' tone-warning' : ''}`}>
                {formatINR(Math.abs(b.balancePaise))}
              </dd>
              {over ? (
                <dd>
                  <Chip tone="warning">
                    {b.creditLimitPaise > 0
                      ? t('ledger.overLimit', { limit: formatINR(b.creditLimitPaise) })
                      : t('ledger.noCredit')}
                  </Chip>
                </dd>
              ) : null}
            </div>
            <div className="card stat">
              <dt>{t('money.creditLimit')}</dt>
              <dd className="stat-value" data-testid="credit-limit">
                {formatINR(b.creditLimitPaise)}
              </dd>
              {isOwner(me) ? (
                <dd>
                  <button
                    type="button"
                    className="btn btn-link"
                    onClick={() => setOpen('limit')}
                    aria-label={t('money.changeLimit')}
                  >
                    {t('common.edit')}
                  </button>
                </dd>
              ) : (
                <dd className="stat-note">{t('money.ownerSetsLimit')}</dd>
              )}
            </div>
          </dl>

          <div className="filters" role="group" aria-label={t('ledger.title')}>
            {(['cans', 'deposit', 'money'] as const).map((k) => (
              <button
                key={k}
                type="button"
                className="filter"
                aria-pressed={tab === k}
                onClick={() => setTab(k)}
              >
                {t(`ledger.tabs.${k}`)} <span className="filter-count">{q.data[k].length}</span>
              </button>
            ))}
          </div>

          {q.data[tab].length === 0 ? (
            <div className="card empty">{t('ledger.empty')}</div>
          ) : (
            <TableWrap label={t(`ledger.tabs.${tab}`)}>
              <table>
                <thead>
                  <tr>
                    <th scope="col">{t('stock.cols.when')}</th>
                    <th scope="col">{t('ledger.cols.entry')}</th>
                    <th scope="col">{t('ledger.cols.change')}</th>
                    <th scope="col">{t('ledger.cols.after')}</th>
                    <th scope="col">{t('ledger.cols.ref')}</th>
                  </tr>
                </thead>
                <tbody>
                  {tab === 'cans'
                    ? q.data.cans.map((e) => (
                        <tr key={e.id}>
                          <td>{when(e.at)}</td>
                          <th scope="row">{t(`ledger.entry.${e.entryType}`)}</th>
                          <td className="num">{signed(e.delta)}</td>
                          <td className="num">{e.balanceAfter}</td>
                          <td className="wrap">
                            {orderLink(e.orderId)} {e.reason ?? ''}
                          </td>
                        </tr>
                      ))
                    : tab === 'deposit'
                      ? q.data.deposit.map((e) => (
                          <tr key={e.id}>
                            <td>{when(e.at)}</td>
                            <th scope="row">{t(`ledger.entry.${e.entryType}`)}</th>
                            <td className="num">
                              {signedINR(e.deltaPaise)}
                              <span className="cell-note">
                                {t('ledger.coverChange', { n: signed(e.deltaCans) })}
                              </span>
                            </td>
                            <td className="num">{formatINR(e.balanceAfterPaise)}</td>
                            <td className="wrap">
                              {orderLink(e.orderId)} {e.reason ?? ''}
                            </td>
                          </tr>
                        ))
                      : q.data.money.map((e) => (
                          <tr key={e.id}>
                            <td>{when(e.at)}</td>
                            <th scope="row">{t(`ledger.entry.${e.entryType}`)}</th>
                            <td className="num">{signedINR(e.deltaPaise)}</td>
                            <td className="num">
                              {e.balanceAfterPaise > 0
                                ? t('ledger.dueAmount', { amount: formatINR(e.balanceAfterPaise) })
                                : formatINR(-e.balanceAfterPaise)}
                            </td>
                            <td className="wrap">
                              {orderLink(e.orderId)} {e.reason ?? ''}
                            </td>
                          </tr>
                        ))}
                </tbody>
              </table>
            </TableWrap>
          )}
          <p className="field-hint">{t('ledger.note')}</p>
          <RecordPaymentDialog
            open={open === 'pay'}
            customerId={customerId}
            customerName={customerName}
            duePaise={b.balancePaise}
            onClose={() => setOpen(null)}
            onSaved={saved}
          />
          <RefundDialog
            open={open === 'refund'}
            customerId={customerId}
            balances={b}
            onClose={() => setOpen(null)}
            onSaved={saved}
          />
          <CorrectionDialog
            open={open === 'correct'}
            customerId={customerId}
            balances={b}
            onClose={() => setOpen(null)}
            onSaved={saved}
          />
          <CreditLimitDialog
            open={open === 'limit'}
            customerId={customerId}
            current={b.creditLimitPaise}
            onClose={() => setOpen(null)}
            onSaved={saved}
          />
        </>
      ) : null}
    </section>
  );
}
