import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import { formatINR } from '@wtrdrop/shared';
import { demoCustomers, demoLedger } from '../demo/fixtures';
import { Dialog } from '../components/Dialog';
import { DemoBadge, LiveMessage, PageHeader, TableWrap, maskPhone } from '../components/ui';

/** DEMO placeholder deposit per can (changelog Part 4). Comes from settings in Phase 5. */
const DEPOSIT_PER_CAN_PAISE = 15000;

type Entry = {
  id: number;
  date: string;
  type: 'opening' | 'delivery' | 'return' | 'reversal' | 'correction';
  delta: number;
  by: string;
  note: string;
  reversesId: number | null;
};

export function CustomerDetailPage() {
  const { t } = useTranslation();
  const { id } = useParams();
  const customer = demoCustomers.find((c) => c.id === id);
  // Only Rajan K. has a demo ledger; others show an honest empty state.
  const [entries, setEntries] = useState<Entry[]>(id === 'c2' ? [...demoLedger] : []);
  const [open, setOpen] = useState(false);
  const [newCount, setNewCount] = useState('');
  const [reason, setReason] = useState('');
  const [tried, setTried] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  if (!customer) {
    return (
      <div className="page">
        <PageHeader title={t('customer.notFound')} />
        <Link to="/customers">{t('customer.back')}</Link>
      </div>
    );
  }

  let running = 0;
  const withBalance = entries.map((e) => ({ ...e, balance: (running += e.delta) }));
  const held = entries.length ? running : customer.cansHeld;

  const countNum = Number(newCount);
  const countValid =
    newCount.trim() !== '' && Number.isInteger(countNum) && countNum >= 0 && countNum <= 500;
  const reasonValid = reason.trim().length >= 5;

  const closeDialog = () => {
    setOpen(false);
    setTried(false);
    setNewCount('');
    setReason('');
  };
  const save = () => {
    setTried(true);
    if (!countValid || !reasonValid) return;
    const delta = countNum - held;
    if (delta !== 0) {
      setEntries((prev) => [
        ...prev,
        {
          id: prev.length + 1,
          date: t('customer.ledger.today'),
          type: 'correction',
          delta,
          by: t('customer.ledger.youDemo'),
          note: reason.trim(),
          reversesId: null,
        },
      ]);
    }
    setMessage(
      delta === 0 ? t('customer.correction.noChange') : t('customer.correction.savedDemo'),
    );
    closeDialog();
  };

  return (
    <div className="page">
      <p className="breadcrumb">
        <Link to="/customers">{t('customer.back')}</Link>
      </p>
      <PageHeader
        title={customer.name}
        subtitle={
          <>
            {customer.area} · {maskPhone(customer.phoneLast4)} <DemoBadge />
          </>
        }
        actions={
          <button type="button" className="btn btn-secondary" onClick={() => setOpen(true)}>
            {t('customer.correct')}
          </button>
        }
      />
      <LiveMessage text={message} tone="success" />

      <dl className="grid grid-stats">
        <div className="card stat">
          <dt>{t('customer.cards.held')}</dt>
          <dd className="stat-value">{held}</dd>
        </div>
        <div className="card stat">
          <dt>{t('customer.cards.deposit')}</dt>
          <dd className="stat-value">{formatINR(customer.depositCans * DEPOSIT_PER_CAN_PAISE)}</dd>
          <dd className="stat-note">
            {t('customer.cards.depositNote', { count: customer.depositCans })}
          </dd>
        </div>
        <div className="card stat">
          <dt>{t('customer.cards.due')}</dt>
          <dd className={`stat-value${customer.duePaise > 0 ? ' tone-warning' : ''}`}>
            {formatINR(customer.duePaise)}
          </dd>
        </div>
      </dl>

      <section aria-labelledby="ledger-h">
        <h2 id="ledger-h">{t('customer.ledger.title')}</h2>
        <p className="muted">{t('customer.ledger.help')}</p>
        {withBalance.length === 0 ? (
          <div className="card empty">{t('customer.ledger.empty')}</div>
        ) : (
          <TableWrap label={t('customer.ledger.title')}>
            <table>
              <thead>
                <tr>
                  <th scope="col">#</th>
                  <th scope="col">{t('customer.ledger.cols.date')}</th>
                  <th scope="col">{t('customer.ledger.cols.what')}</th>
                  <th scope="col" className="num">
                    {t('customer.ledger.cols.change')}
                  </th>
                  <th scope="col" className="num">
                    {t('customer.ledger.cols.balance')}
                  </th>
                  <th scope="col">{t('customer.ledger.cols.by')}</th>
                </tr>
              </thead>
              <tbody>
                {withBalance.map((e) => (
                  <tr key={e.id} className={e.type === 'reversal' ? 'row-reversal' : undefined}>
                    <td>{e.id}</td>
                    <td>{e.date}</td>
                    <th scope="row">
                      {t(`customer.ledger.types.${e.type}`)}
                      <span className="cell-note">
                        {e.reversesId
                          ? t('customer.ledger.reverses', { id: e.reversesId, note: e.note })
                          : e.note}
                      </span>
                    </th>
                    <td className="num">{e.delta > 0 ? `+${e.delta}` : `−${Math.abs(e.delta)}`}</td>
                    <td className="num">
                      <strong>{e.balance}</strong>
                    </td>
                    <td>{e.by}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        )}
      </section>

      <Dialog open={open} title={t('customer.correction.title')} onClose={closeDialog}>
        <form
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            save();
          }}
          className="form"
        >
          <p className="muted">{t('customer.correction.help', { count: held })}</p>
          <label className="field">
            <span>{t('customer.correction.count')}</span>
            <input
              type="number"
              inputMode="numeric"
              min={0}
              max={500}
              value={newCount}
              onChange={(e) => setNewCount(e.target.value)}
              aria-invalid={tried && !countValid}
              aria-describedby={tried && !countValid ? 'count-err' : undefined}
              autoFocus
            />
            {tried && !countValid ? (
              <span id="count-err" className="field-error">
                {t('customer.correction.countError')}
              </span>
            ) : null}
          </label>
          <label className="field">
            <span>{t('customer.correction.reason')}</span>
            <textarea
              rows={3}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              aria-invalid={tried && !reasonValid}
              aria-describedby={tried && !reasonValid ? 'reason-err' : 'reason-hint'}
            />
            {tried && !reasonValid ? (
              <span id="reason-err" className="field-error">
                {t('customer.correction.reasonError')}
              </span>
            ) : (
              <span id="reason-hint" className="field-hint">
                {t('customer.correction.reasonHint')}
              </span>
            )}
          </label>
          <div className="form-actions">
            <button type="submit" className="btn btn-primary">
              {t('customer.correction.save')}
            </button>
            <button type="button" className="btn btn-secondary" onClick={closeDialog}>
              {t('common.cancel')}
            </button>
          </div>
        </form>
      </Dialog>
    </div>
  );
}
