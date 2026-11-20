import { useState } from 'react';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { call } from '../lib/api';
import { errorText } from '../lib/errors';
import { Dialog } from '../components/Dialog';
import { LiveMessage, PageHeader, TableWrap } from '../components/ui';

interface Stock {
  depotFull: number;
  depotEmpty: number;
  damaged: number;
  vanFull: number;
  vanEmpty: number;
  withCustomers: number;
  total: number;
  routesNotChecked: number;
  recent: {
    id: number;
    kind: string;
    fromPlace: string;
    fromState: string;
    toPlace: string;
    toState: string;
    qty: number;
    note: string | null;
    at: string;
    actorName: string | null;
  }[];
}

type Action = 'filled' | 'bought' | 'discarded' | 'count';

/**
 * Can stock (Phase 5): where every can is right now. Routes move cans automatically; the office
 * records what happens at the depot. All counts come from the movement log, never typed totals.
 */
export function StockPage() {
  const { t, i18n } = useTranslation();
  const qc = useQueryClient();
  const [action, setAction] = useState<Action | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const q = useQuery({ queryKey: ['stock'], queryFn: () => call<Stock>('/admin/stock') });
  const s = q.data;
  const when = (iso: string) =>
    new Date(iso).toLocaleString(i18n.language === 'ml' ? 'ml-IN' : 'en-IN', {
      day: 'numeric',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
      timeZone: 'Asia/Kolkata',
    });

  return (
    <div className="page">
      <PageHeader
        title={t('nav.stock')}
        subtitle={s ? t('stock.total', { count: s.total }) : undefined}
        actions={
          <>
            <button type="button" className="btn btn-primary" onClick={() => setAction('filled')}>
              {t('stock.actions.filled')}
            </button>
            <button type="button" className="btn btn-secondary" onClick={() => setAction('count')}>
              {t('stock.actions.count')}
            </button>
            <button type="button" className="btn btn-secondary" onClick={() => setAction('bought')}>
              {t('stock.actions.bought')}
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => setAction('discarded')}
            >
              {t('stock.actions.discarded')}
            </button>
          </>
        }
      />
      <LiveMessage text={message} tone="success" />
      {q.isError ? (
        <div className="card empty" role="alert">
          {errorText(t, q.error)}
        </div>
      ) : null}
      {q.isPending ? <div className="card empty">{t('common.loading')}</div> : null}
      {s ? (
        <>
          <dl className="grid grid-stats" data-testid="stock-counts">
            <div className="card stat">
              <dt>{t('stock.depotFull')}</dt>
              <dd className="stat-value">{s.depotFull}</dd>
            </div>
            <div className="card stat">
              <dt>{t('stock.depotEmpty')}</dt>
              <dd className="stat-value">{s.depotEmpty}</dd>
            </div>
            <div className="card stat">
              <dt>{t('stock.onVans')}</dt>
              <dd className="stat-value">{s.vanFull + s.vanEmpty}</dd>
              <dd className="stat-note">
                {t('stock.vanSplit', { full: s.vanFull, empty: s.vanEmpty })}
              </dd>
            </div>
            <div className="card stat">
              <dt>{t('stock.withCustomers')}</dt>
              <dd className="stat-value">{s.withCustomers}</dd>
            </div>
            <div className="card stat">
              <dt>{t('stock.damaged')}</dt>
              <dd className="stat-value">{s.damaged}</dd>
            </div>
          </dl>
          {s.routesNotChecked > 0 ? (
            <p className="muted">
              {t('stock.routesOpen', { count: s.routesNotChecked })}{' '}
              <Link to="/deliveries">{t('nav.deliveries')}</Link>
            </p>
          ) : null}

          <section aria-labelledby="moves-h">
            <h2 id="moves-h">{t('stock.recent')}</h2>
            {s.recent.length === 0 ? (
              <div className="card empty">{t('stock.noneYet')}</div>
            ) : (
              <TableWrap label={t('stock.recent')}>
                <table>
                  <thead>
                    <tr>
                      <th scope="col">{t('stock.cols.when')}</th>
                      <th scope="col">{t('stock.cols.what')}</th>
                      <th scope="col">{t('stock.cols.cans')}</th>
                      <th scope="col">{t('stock.cols.by')}</th>
                      <th scope="col">{t('stock.cols.note')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {s.recent.map((m) => (
                      <tr key={m.id}>
                        <td>{when(m.at)}</td>
                        <th scope="row">
                          {t(`stock.kind.${m.kind}`)}
                          <span className="cell-note">
                            {t(`stock.place.${m.fromPlace}`)} → {t(`stock.place.${m.toPlace}`)} (
                            {t(`stock.state.${m.toState}`)})
                          </span>
                        </th>
                        <td className="num">{m.qty}</td>
                        <td>{m.actorName ?? ''}</td>
                        <td className="wrap">{m.note ?? ''}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableWrap>
            )}
          </section>
        </>
      ) : null}
      <StockDialog
        action={action}
        stock={s}
        onClose={() => setAction(null)}
        onSaved={(next, text) => {
          qc.setQueryData(['stock'], next);
          setMessage(text);
        }}
      />
    </div>
  );
}

function StockDialog({
  action,
  stock,
  onClose,
  onSaved,
}: {
  action: Action | null;
  stock: Stock | undefined;
  onClose: () => void;
  onSaved: (s: Stock, text: string) => void;
}) {
  const { t } = useTranslation();
  const [qty, setQty] = useState('');
  const [state, setState] = useState<'full' | 'empty'>('empty');
  const [count, setCount] = useState<{ full: string; empty: string; damaged: string } | null>(null);
  const [note, setNote] = useState('');
  const [tried, setTried] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const c = count ?? {
    full: String(stock?.depotFull ?? 0),
    empty: String(stock?.depotEmpty ?? 0),
    damaged: String(stock?.damaged ?? 0),
  };
  const num = (v: string) => (/^\d+$/.test(v) ? Number(v) : NaN);
  const needsNote = action === 'count' || action === 'discarded';
  const qtyBad = action !== 'count' && !(num(qty) >= 1);
  const countBad =
    action === 'count' && [c.full, c.empty, c.damaged].some((v) => Number.isNaN(num(v)));
  const noteBad = needsNote && note.trim().length < 3;

  const close = () => {
    setQty('');
    setState('empty');
    setCount(null);
    setNote('');
    setTried(false);
    setError(null);
    onClose();
  };
  const save = async () => {
    setTried(true);
    if ((action !== 'count' && qtyBad) || countBad || noteBad || !action) return;
    const body =
      action === 'count'
        ? { kind: 'count', full: num(c.full), empty: num(c.empty), damaged: num(c.damaged), note }
        : action === 'bought'
          ? { kind: 'bought', qty: num(qty), state, note: note || undefined }
          : { kind: action, qty: num(qty), note: note || undefined };
    try {
      const next = await call<Stock>('/admin/stock', { method: 'POST', body });
      onSaved(next, t(`stock.saved.${action}`, { count: num(qty) }));
      close();
    } catch (e) {
      setError(errorText(t, e));
    }
  };
  const numberField = (label: string, value: string, set: (v: string) => void, bad: boolean) => (
    <label className="field">
      <span>{label}</span>
      <input
        inputMode="numeric"
        value={value}
        onChange={(e) => set(e.target.value.replace(/\D/g, '').slice(0, 6))}
        aria-invalid={tried && bad}
      />
    </label>
  );

  return (
    <Dialog open={!!action} title={action ? t(`stock.actions.${action}`) : ''} onClose={close}>
      {action ? (
        <form
          className="form"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <p className="muted">{t(`stock.help.${action}`)}</p>
          {action === 'count' ? (
            <>
              {numberField(
                t('stock.depotFull'),
                c.full,
                (v) => setCount({ ...c, full: v }),
                Number.isNaN(num(c.full)),
              )}
              {numberField(
                t('stock.depotEmpty'),
                c.empty,
                (v) => setCount({ ...c, empty: v }),
                Number.isNaN(num(c.empty)),
              )}
              {numberField(
                t('stock.damaged'),
                c.damaged,
                (v) => setCount({ ...c, damaged: v }),
                Number.isNaN(num(c.damaged)),
              )}
            </>
          ) : (
            numberField(t('stock.cans'), qty, setQty, qtyBad)
          )}
          {action === 'bought' ? (
            <fieldset className="fieldset">
              <legend>{t('stock.boughtAs')}</legend>
              {(['empty', 'full'] as const).map((v) => (
                <label key={v} className="inline-field">
                  <input
                    type="radio"
                    name="bought-state"
                    checked={state === v}
                    onChange={() => setState(v)}
                  />
                  {t(`stock.state.${v}`)}
                </label>
              ))}
            </fieldset>
          ) : null}
          <label className="field">
            <span>{needsNote ? t('stock.noteRequired') : t('stock.noteOptional')}</span>
            <input
              value={note}
              maxLength={300}
              onChange={(e) => setNote(e.target.value)}
              aria-invalid={tried && noteBad}
            />
            {tried && noteBad ? (
              <span className="field-error">{t('errors.REASON_REQUIRED')}</span>
            ) : null}
          </label>
          {tried && (qtyBad || countBad) ? (
            <p className="field-error" role="alert">
              {t('stock.numberNeeded')}
            </p>
          ) : null}
          {error ? (
            <p className="field-error" role="alert">
              {error}
            </p>
          ) : null}
          <div className="form-actions">
            <button type="submit" className="btn btn-primary">
              {t('common.save')}
            </button>
            <button type="button" className="btn btn-secondary" onClick={close}>
              {t('common.cancel')}
            </button>
          </div>
        </form>
      ) : null}
    </Dialog>
  );
}
