import { useEffect, useState } from 'react';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { formatINR } from '@wtrdrop/shared';
import { call } from '../lib/api';
import { errorText } from '../lib/errors';
import {
  dayLabel,
  orderNo,
  quoteFor,
  windowText,
  type OrderDetail,
  type OrderOptions,
} from '../lib/orders';
import { Dialog } from './Dialog';
import { SearchField, maskPhone } from './ui';

interface CustomerHit {
  id: string;
  name: string | null;
  phone: string;
  area: string | null;
  status: 'active' | 'disabled';
}
interface CustomerFull {
  id: string;
  name: string | null;
  addresses: { id: string; label: string; line: string; areaName: string; isDefault: boolean }[];
}

/**
 * M-01: an order for a customer who phoned or sent a WhatsApp message. Pick the customer (skipped
 * when opened from their page), then the same few choices the app shows, pre-filled.
 */
export function NewOrderDialog({
  open,
  customerId: fixedCustomer,
  onClose,
  onCreated,
}: {
  open: boolean;
  customerId?: string;
  onClose: () => void;
  onCreated: (o: OrderDetail) => void;
}) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const [picked, setPicked] = useState<string | null>(fixedCustomer ?? null);
  const [addressId, setAddressId] = useState<string | null>(null);
  const [qty, setQty] = useState<number | null>(null);
  const [slot, setSlot] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [requestId, setRequestId] = useState(() => crypto.randomUUID());

  useEffect(() => {
    if (!open) return;
    // A fresh order each time the dialog opens; a retry of the same one reuses this id.
    setRequestId(crypto.randomUUID());
    setPicked(fixedCustomer ?? null);
    setSearch('');
    setAddressId(null);
    setQty(null);
    setSlot('');
    setNote('');
    setError(null);
  }, [open, fixedCustomer]);

  const hits = useQuery({
    queryKey: ['customers', 'pick', search],
    enabled: open && !picked && search.trim().length >= 2,
    queryFn: async () =>
      (
        await call<{ customers: CustomerHit[] }>(
          `/admin/customers?q=${encodeURIComponent(search.trim())}`,
        )
      ).customers,
  });
  const customer = useQuery({
    queryKey: ['customer', picked],
    enabled: open && !!picked,
    queryFn: async () =>
      (await call<{ customer: CustomerFull }>(`/admin/customers/${picked}`)).customer,
  });
  const options = useQuery({
    queryKey: ['order-options', picked, addressId],
    enabled: open && !!picked,
    queryFn: () =>
      call<OrderOptions>(
        `/admin/customers/${picked}/order-options${addressId ? `?addressId=${addressId}` : ''}`,
      ),
  });
  const o = options.data;
  useEffect(() => {
    if (!o) return;
    if (qty === null) setQty(o.defaultQty);
    if (!slot || !o.windows.some((w) => `${w.date}|${w.windowId}` === slot && !w.unavailable)) {
      const first = o.windows.find((w) => !w.unavailable);
      setSlot(first ? `${first.date}|${first.windowId}` : '');
    }
  }, [o, qty, slot]);

  const close = () => onClose();
  const n = qty ?? 1;
  const q = o ? quoteFor(o, n) : null;
  const chosen = o?.windows.find((w) => `${w.date}|${w.windowId}` === slot);

  const save = async () => {
    if (!o || !picked || !chosen || !o.addressId) return;
    setBusy(true);
    setError(null);
    try {
      const r = await call<{ order: OrderDetail }>('/admin/orders', {
        method: 'POST',
        body: {
          customerId: picked,
          clientRequestId: requestId,
          addressId: o.addressId,
          windowId: chosen.windowId,
          date: chosen.date,
          qty: n,
          expectedTotalPaise: q?.totalPaise,
          note: note.trim() || undefined,
        },
      });
      await qc.invalidateQueries({ queryKey: ['orders'] });
      await qc.invalidateQueries({ queryKey: ['window-slots'] });
      onCreated(r.order);
      onClose();
    } catch (e) {
      setError(errorText(t, e));
      await options.refetch();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} title={t('newOrder.title')} onClose={close}>
      {!picked ? (
        <div className="form">
          <SearchField
            label={t('newOrder.findCustomer')}
            placeholder={t('customers.searchPlaceholder')}
            value={search}
            onChange={setSearch}
          />
          {hits.data?.length === 0 ? <p className="muted">{t('newOrder.noMatch')}</p> : null}
          <ul className="pick-list">
            {hits.data?.map((c) => (
              <li key={c.id}>
                <button
                  type="button"
                  className="pick"
                  disabled={c.status !== 'active'}
                  onClick={() => setPicked(c.id)}
                >
                  <strong>{c.name ?? t('customers.noName')}</strong>
                  <span className="cell-note">
                    {maskPhone(c.phone.slice(-4))} · {c.area ?? t('customers.noAddress')}
                    {c.status !== 'active' ? ` · ${t('common.switchedOff')}` : ''}
                  </span>
                </button>
              </li>
            ))}
          </ul>
          <div className="form-actions">
            <button type="button" className="btn btn-secondary" onClick={close}>
              {t('common.cancel')}
            </button>
          </div>
        </div>
      ) : (
        <form
          className="form"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <p>
            <strong>{customer.data?.name ?? '…'}</strong>
            {!fixedCustomer ? (
              <button type="button" className="btn btn-link" onClick={() => setPicked(null)}>
                {t('newOrder.otherCustomer')}
              </button>
            ) : null}
          </p>
          {options.isError ? (
            <p className="field-error" role="alert">
              {errorText(t, options.error)}
            </p>
          ) : null}
          {o && !o.addressId ? (
            <p className="field-error" role="alert">
              {t('newOrder.noAddress')}
            </p>
          ) : null}
          {o && o.addressId ? (
            <>
              {(customer.data?.addresses.length ?? 0) > 1 ? (
                <label className="field">
                  <span>{t('newOrder.address')}</span>
                  <select value={o.addressId} onChange={(e) => setAddressId(e.target.value)}>
                    {customer.data?.addresses.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.label} · {a.line} · {a.areaName}
                      </option>
                    ))}
                  </select>
                </label>
              ) : (
                <p className="muted">
                  {customer.data?.addresses[0]?.label} · {customer.data?.addresses[0]?.line} ·{' '}
                  {customer.data?.addresses[0]?.areaName}
                </p>
              )}
              <label className="field">
                <span>{t('newOrder.cans')}</span>
                <input
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={o.maxCans}
                  value={n}
                  onChange={(e) =>
                    setQty(Math.max(1, Math.min(o.maxCans, Number(e.target.value) || 1)))
                  }
                />
              </label>
              <label className="field">
                <span>{t('newOrder.when')}</span>
                <select value={slot} onChange={(e) => setSlot(e.target.value)}>
                  {o.windows.map((w) => (
                    <option
                      key={`${w.date}|${w.windowId}`}
                      value={`${w.date}|${w.windowId}`}
                      disabled={!!w.unavailable}
                    >
                      {dayLabel(t, w.date, lang)} · {windowText(w, lang)} ·{' '}
                      {w.unavailable
                        ? t(`newOrder.unavailable.${w.unavailable}`, {
                            reason: w.closedReason ?? '',
                          })
                        : t('newOrder.free', { count: w.remainingCans })}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>{t('newOrder.note')}</span>
                <input value={note} maxLength={200} onChange={(e) => setNote(e.target.value)} />
              </label>
              {q ? (
                <dl className="price-lines">
                  <div>
                    <dt>
                      {t('newOrder.cansLine', { count: n, price: formatINR(o.unitPricePaise) })}
                      {o.specialPrice ? ` · ${t('newOrder.specialPrice')}` : ''}
                    </dt>
                    <dd>{formatINR(q.subtotalPaise)}</dd>
                  </div>
                  <div>
                    <dt>{t('newOrder.delivery')}</dt>
                    <dd>
                      {q.deliveryChargePaise
                        ? formatINR(q.deliveryChargePaise)
                        : t('newOrder.free0')}
                    </dd>
                  </div>
                  {q.depositPaise ? (
                    <div>
                      <dt>{t('newOrder.deposit', { count: q.depositCans })}</dt>
                      <dd>{formatINR(q.depositPaise)}</dd>
                    </div>
                  ) : null}
                  <div className="price-total">
                    <dt>{t('newOrder.total')}</dt>
                    <dd>{formatINR(q.totalPaise)}</dd>
                  </div>
                </dl>
              ) : null}
            </>
          ) : null}
          {error ? (
            <p className="field-error" role="alert">
              {error}
            </p>
          ) : null}
          <div className="form-actions">
            <button
              type="submit"
              className="btn btn-primary"
              disabled={busy || !chosen || !o?.addressId}
            >
              {busy
                ? t('common.saving')
                : t('newOrder.save', { total: q ? formatINR(q.totalPaise) : '' })}
            </button>
            <button type="button" className="btn btn-secondary" onClick={close}>
              {t('common.cancel')}
            </button>
          </div>
        </form>
      )}
    </Dialog>
  );
}

export const createdText = (t: TFunction, o: OrderDetail) =>
  t('newOrder.created', { no: orderNo(o.orderNo), name: o.customerName ?? '' });
