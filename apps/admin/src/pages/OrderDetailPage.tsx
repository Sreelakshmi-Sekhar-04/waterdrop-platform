import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { TERMINAL_STATUSES, formatINR } from '@wtrdrop/shared';
import { call } from '../lib/api';
import { errorText } from '../lib/errors';
import { dayLabel, orderNo, windowText, type OrderDetail } from '../lib/orders';
import { Dialog } from '../components/Dialog';
import { LiveMessage, OrderStatusChip, PageHeader } from '../components/ui';

type Action = 'REJECTED' | 'CANCELLED';

/** One order: what, where, when, money, every status change, and accept / reject / cancel. */
export function OrderDetailPage() {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const { id = '' } = useParams();
  const qc = useQueryClient();
  const key = ['order', id];
  const q = useQuery({
    queryKey: key,
    queryFn: async () => (await call<{ order: OrderDetail }>(`/admin/orders/${id}`)).order,
  });
  const [action, setAction] = useState<Action | null>(null);
  const [reason, setReason] = useState('');
  const [tried, setTried] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (q.isPending)
    return (
      <div className="page">
        <div className="card empty">{t('common.loading')}</div>
      </div>
    );
  if (q.isError)
    return (
      <div className="page">
        <PageHeader title={t('order.notFound')} />
        <p role="alert">{errorText(t, q.error)}</p>
        <Link to="/orders">{t('order.back')}</Link>
      </div>
    );
  const o = q.data;
  const open = !TERMINAL_STATUSES.includes(o.status);

  const move = async (to: 'ACCEPTED' | Action, why?: string) => {
    setError(null);
    try {
      const r = await call<{ order: OrderDetail }>(`/admin/orders/${o.id}/transition`, {
        method: 'POST',
        body: why ? { to, reason: why } : { to },
      });
      qc.setQueryData(key, r.order);
      await qc.invalidateQueries({ queryKey: ['orders'] });
      await qc.invalidateQueries({ queryKey: ['window-slots'] });
      setMessage(t(`order.done.${to}`, { no: orderNo(o.orderNo) }));
      setAction(null);
    } catch (e) {
      setError(errorText(t, e));
    }
  };
  const a = o.address;
  const item = o.items[0];

  return (
    <div className="page">
      <p className="breadcrumb">
        <Link to={`/orders?date=${o.deliveryDate}`}>{t('order.back')}</Link>
      </p>
      <PageHeader
        title={orderNo(o.orderNo)}
        subtitle={
          <>
            <OrderStatusChip status={o.status} /> {t(`orders.channel.${o.channel}`)}
          </>
        }
        actions={
          <>
            {o.status === 'PLACED' ? (
              <>
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => void move('ACCEPTED')}
                >
                  {t('orders.accept')}
                </button>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setAction('REJECTED')}
                >
                  {t('order.reject')}
                </button>
              </>
            ) : null}
            {open ? (
              <button
                type="button"
                className="btn btn-warning"
                onClick={() => setAction('CANCELLED')}
              >
                {t('order.cancel')}
              </button>
            ) : null}
          </>
        }
      />
      <LiveMessage text={message} tone="success" />
      {error && !action ? (
        <p className="field-error" role="alert">
          {error}
        </p>
      ) : null}

      <div className="grid grid-two">
        <section className="card" aria-labelledby="who-h">
          <h2 id="who-h">{t('order.customer')}</h2>
          <p>
            <Link to={`/customers/${o.customerId}`}>{o.customerName ?? t('customers.noName')}</Link>
            <br />
            <a
              href={`tel:${o.customerPhone}`}
            >{`+91 ${o.customerPhone.slice(3, 8)} ${o.customerPhone.slice(8)}`}</a>
          </p>
          <p>
            <strong>{a.label}</strong>
            <br />
            {a.line}
            <br />
            {a.landmark} · {a.areaName} {a.pincode}
          </p>
          {a.deliveryNote ? <p className="muted">{a.deliveryNote}</p> : null}
          {o.note ? (
            <p>
              <strong>{t('order.note')}:</strong> {o.note}
            </p>
          ) : null}
        </section>
        <section className="card" aria-labelledby="what-h">
          <h2 id="what-h">{t('order.what')}</h2>
          <p>
            {dayLabel(t, o.deliveryDate, lang)} ·{' '}
            {windowText(
              {
                nameEn: o.windowNameEn,
                nameMl: o.windowNameMl,
                startTime: o.windowStart,
                endTime: o.windowEnd,
              },
              lang,
            )}
          </p>
          <dl className="price-lines">
            <div>
              <dt>
                {t('newOrder.cansLine', {
                  count: o.qty,
                  price: formatINR(item?.unitPricePaise ?? 0),
                })}
              </dt>
              <dd>{formatINR(o.subtotalPaise)}</dd>
            </div>
            <div>
              <dt>{t('newOrder.delivery')}</dt>
              <dd>
                {o.deliveryChargePaise ? formatINR(o.deliveryChargePaise) : t('newOrder.free0')}
              </dd>
            </div>
            {o.depositPaise ? (
              <div>
                <dt>{t('newOrder.deposit', { count: item?.depositCans ?? 0 })}</dt>
                <dd>{formatINR(o.depositPaise)}</dd>
              </div>
            ) : null}
            <div className="price-total">
              <dt>{t('newOrder.total')}</dt>
              <dd>{formatINR(o.totalPaise)}</dd>
            </div>
          </dl>
          <p className="muted">{t('order.depositNote')}</p>
        </section>
      </div>

      <section aria-labelledby="hist-h">
        <h2 id="hist-h">{t('order.history')}</h2>
        <ol className="history">
          {o.history.map((h, i) => (
            <li key={i}>
              <OrderStatusChip status={h.to} />{' '}
              <span>
                {new Date(h.at).toLocaleString(lang === 'ml' ? 'ml-IN' : 'en-IN', {
                  day: 'numeric',
                  month: 'short',
                  hour: 'numeric',
                  minute: '2-digit',
                  timeZone: 'Asia/Kolkata',
                })}{' '}
                ·{' '}
                {h.actorRole === 'system'
                  ? t('order.automatic')
                  : (h.actorName ?? t(`roles.${h.actorRole}`))}
              </span>
              {h.reason ? <span className="cell-note">{h.reason}</span> : null}
            </li>
          ))}
        </ol>
      </section>

      <Dialog
        open={!!action}
        title={action ? t(`order.confirm.${action}`, { no: orderNo(o.orderNo) }) : ''}
        onClose={() => {
          setAction(null);
          setReason('');
          setTried(false);
          setError(null);
        }}
      >
        <form
          className="form"
          onSubmit={(e) => {
            e.preventDefault();
            setTried(true);
            if (reason.trim().length >= 3 && action) void move(action, reason.trim());
          }}
        >
          <p className="muted">{t('order.reasonHelp')}</p>
          <label className="field">
            <span>{t('order.reason')}</span>
            <textarea
              rows={2}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              aria-invalid={tried && reason.trim().length < 3}
              autoFocus
            />
            {tried && reason.trim().length < 3 ? (
              <span className="field-error">{t('order.reasonNeeded')}</span>
            ) : null}
          </label>
          {error ? (
            <p className="field-error" role="alert">
              {error}
            </p>
          ) : null}
          <div className="form-actions">
            <button type="submit" className="btn btn-warning">
              {action ? t(`order.yes.${action}`) : ''}
            </button>
            <button type="button" className="btn btn-secondary" onClick={() => setAction(null)}>
              {t('order.keep')}
            </button>
          </div>
        </form>
      </Dialog>
    </div>
  );
}
