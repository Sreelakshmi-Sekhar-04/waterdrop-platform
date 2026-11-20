import { useState } from 'react';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { formatINR } from '@wtrdrop/shared';
import { call } from '../lib/api';
import { isOwner, useAuth } from '../lib/auth';
import { errorText } from '../lib/errors';
import { dayLabel, orderNo, windowText, type OrderRow } from '../lib/orders';
import { Dialog } from './Dialog';
import { NewOrderDialog, createdText } from './NewOrderDialog';
import { LiveMessage, OrderStatusChip, TableWrap } from './ui';

/** The customer's orders, newest first, and a button to take a phone order for them. */
export function CustomerOrders({ customerId, active }: { customerId: string; active: boolean }) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const [adding, setAdding] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const q = useQuery({
    queryKey: ['orders', 'customer', customerId],
    queryFn: async () =>
      (await call<{ orders: OrderRow[] }>(`/admin/orders?customerId=${customerId}`)).orders,
  });
  const rows = [...(q.data ?? [])].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return (
    <section aria-labelledby="orders-h">
      <div className="section-head">
        <h2 id="orders-h">{t('customer.orders')}</h2>
        <button
          type="button"
          className="btn btn-primary btn-compact"
          disabled={!active}
          onClick={() => setAdding(true)}
        >
          {t('today.newOrder')}
        </button>
      </div>
      <LiveMessage text={message} tone="success" />
      {q.isError ? (
        <div className="card empty" role="alert">
          {errorText(t, q.error)}
        </div>
      ) : null}
      {q.data && rows.length === 0 ? (
        <div className="card empty">{t('customer.noOrders')}</div>
      ) : null}
      {rows.length ? (
        <TableWrap label={t('customer.orders')}>
          <table>
            <thead>
              <tr>
                <th scope="col">{t('orders.cols.order')}</th>
                <th scope="col">{t('orders.cols.slot')}</th>
                <th scope="col">{t('orders.cols.cans')}</th>
                <th scope="col">{t('orders.cols.total')}</th>
                <th scope="col">{t('orders.cols.status')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((o) => (
                <tr key={o.id}>
                  <th scope="row">
                    <Link to={`/orders/${o.id}`}>{orderNo(o.orderNo)}</Link>
                  </th>
                  <td>
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
                  </td>
                  <td className="num">{o.qty}</td>
                  <td className="num">{formatINR(o.totalPaise)}</td>
                  <td>
                    <OrderStatusChip status={o.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableWrap>
      ) : null}
      <NewOrderDialog
        open={adding}
        customerId={customerId}
        onClose={() => setAdding(false)}
        onCreated={(o) => setMessage(createdText(t, o))}
      />
    </section>
  );
}

/** D-11: an office or shop can have its own price. Only the owner changes it. */
export function CustomerPrice({ customerId }: { customerId: string }) {
  const { t } = useTranslation();
  const { me } = useAuth();
  const qc = useQueryClient();
  const key = ['customer-price', customerId];
  const q = useQuery({
    queryKey: key,
    queryFn: () =>
      call<{ standardPricePaise: number | null; specialPricePaise: number | null }>(
        `/admin/customers/${customerId}/price`,
      ),
  });
  const [editing, setEditing] = useState(false);
  const [rupees, setRupees] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const save = async (pricePaise: number | null) => {
    setError(null);
    try {
      await call(`/admin/customers/${customerId}/price`, { method: 'PUT', body: { pricePaise } });
      await qc.invalidateQueries({ queryKey: key });
      setEditing(false);
      setMessage(pricePaise === null ? t('price.backToStandard') : t('price.saved'));
    } catch (e) {
      setError(errorText(t, e));
    }
  };
  const d = q.data;
  const valid = /^\d{1,5}(\.\d{1,2})?$/.test(rupees.trim());
  return (
    <section className="card price-card" aria-labelledby="price-h">
      <h2 id="price-h">{t('price.label')}</h2>
      <p className="stat-value stat-small">
        {d ? formatINR(d.specialPricePaise ?? d.standardPricePaise ?? 0) : '…'}
      </p>
      <p className="stat-note">
        {d?.specialPricePaise != null ? t('price.special') : t('price.standard')}
        {isOwner(me) ? (
          <>
            {' '}
            <button
              type="button"
              className="btn btn-link"
              onClick={() => {
                setRupees(d?.specialPricePaise != null ? String(d.specialPricePaise / 100) : '');
                setEditing(true);
              }}
            >
              {t('price.change')}
            </button>
          </>
        ) : null}
      </p>
      <LiveMessage text={message} tone="success" />
      <Dialog open={editing} title={t('price.title')} onClose={() => setEditing(false)}>
        <form
          className="form"
          onSubmit={(e) => {
            e.preventDefault();
            if (valid) void save(Math.round(Number(rupees) * 100));
          }}
        >
          <p className="muted">
            {t('price.help', { standard: formatINR(d?.standardPricePaise ?? 0) })}
          </p>
          <label className="field">
            <span>{t('price.perCan')}</span>
            <input
              inputMode="decimal"
              value={rupees}
              onChange={(e) => setRupees(e.target.value)}
              aria-invalid={!!rupees && !valid}
              autoFocus
            />
          </label>
          {error ? (
            <p className="field-error" role="alert">
              {error}
            </p>
          ) : null}
          <div className="form-actions">
            <button type="submit" className="btn btn-primary" disabled={!valid}>
              {t('common.save')}
            </button>
            {d?.specialPricePaise != null ? (
              <button type="button" className="btn btn-secondary" onClick={() => void save(null)}>
                {t('price.useStandard')}
              </button>
            ) : null}
            <button type="button" className="btn btn-secondary" onClick={() => setEditing(false)}>
              {t('common.cancel')}
            </button>
          </div>
        </form>
      </Dialog>
    </section>
  );
}
