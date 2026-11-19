import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { addDays, formatINR, istDate, isoDateSchema, type OrderStatus } from '@wtrdrop/shared';
import { call } from '../lib/api';
import { errorText } from '../lib/errors';
import { dayLabel, orderNo, windowText, type OrderRow, type WindowSlot } from '../lib/orders';
import { NewOrderDialog, createdText } from '../components/NewOrderDialog';
import {
  LiveMessage,
  OrderStatusChip,
  PageHeader,
  SearchField,
  TableWrap,
  maskPhone,
} from '../components/ui';

const FILTERS = {
  all: null,
  toAccept: ['PLACED'],
  needsDriver: ['ACCEPTED'],
  onTheWay: ['ASSIGNED', 'OUT_FOR_DELIVERY'],
  problems: ['RESCHEDULE_PENDING'],
  done: ['DELIVERED', 'CANCELLED', 'REJECTED'],
} as const satisfies Record<string, readonly OrderStatus[] | null>;
type FilterKey = keyof typeof FILTERS;
const FILTER_KEYS = Object.keys(FILTERS) as FilterKey[];
const matches = (key: FilterKey, o: OrderRow) => {
  const set: readonly OrderStatus[] | null = FILTERS[key];
  return set === null || set.includes(o.status);
};

/** One delivery day's orders: filter, search, accept waiting orders in bulk, take a phone order. */
export function OrdersPage() {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();
  const today = istDate(new Date());
  const date = isoDateSchema.safeParse(params.get('date')).success ? params.get('date')! : today;
  const show: FilterKey = FILTER_KEYS.includes(params.get('show') as FilterKey)
    ? (params.get('show') as FilterKey)
    : 'all';
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  const set = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) {
      if (v === null) next.delete(k);
      else next.set(k, v);
    }
    setSelected(new Set());
    setParams(next);
  };

  const list = useQuery({
    queryKey: ['orders', date, search.trim()],
    queryFn: async () =>
      (
        await call<{ orders: OrderRow[] }>(
          `/admin/orders?date=${date}${search.trim() ? `&q=${encodeURIComponent(search.trim())}` : ''}`,
        )
      ).orders,
    placeholderData: (prev) => prev,
  });
  const slots = useQuery({
    queryKey: ['window-slots', date],
    queryFn: async () =>
      (await call<{ slots: WindowSlot[] }>(`/admin/window-slots?from=${date}&days=1`)).slots,
  });

  const orders = useMemo(() => list.data ?? [], [list.data]);
  const visible = orders.filter((o) => matches(show, o));
  const selectable = visible.filter((o) => o.status === 'PLACED');
  const allSelected = selectable.length > 0 && selectable.every((o) => selected.has(o.id));
  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const acceptSelected = async () => {
    setError(null);
    try {
      const r = await call<{ accepted: number; skipped: { id: string; code: string }[] }>(
        '/admin/orders/bulk-accept',
        { method: 'POST', body: { ids: [...selected] } },
      );
      setSelected(new Set());
      setMessage(
        r.skipped.length
          ? t('orders.acceptedSome', { count: r.accepted, skipped: r.skipped.length })
          : t('orders.accepted', { count: r.accepted }),
      );
      await qc.invalidateQueries({ queryKey: ['orders'] });
    } catch (e) {
      setError(errorText(t, e));
    }
  };

  return (
    <div className="page">
      <PageHeader
        title={t('nav.orders')}
        subtitle={dayLabel(t, date, lang)}
        actions={
          <button type="button" className="btn btn-primary" onClick={() => setAdding(true)}>
            {t('today.newOrder')}
          </button>
        }
      />

      <div className="toolbar">
        <div className="day-nav" role="group" aria-label={t('orders.dayLabel')}>
          <button
            type="button"
            className="btn btn-secondary btn-compact"
            onClick={() => set({ date: addDays(date, -1) })}
          >
            ← {t('orders.prevDay')}
          </button>
          <label className="inline-field">
            <span className="visually-hidden">{t('orders.date')}</span>
            <input
              type="date"
              value={date}
              onChange={(e) => e.target.value && set({ date: e.target.value })}
            />
          </label>
          <button
            type="button"
            className="btn btn-secondary btn-compact"
            onClick={() => set({ date: addDays(date, 1) })}
          >
            {t('orders.nextDay')} →
          </button>
          {date !== today ? (
            <button type="button" className="btn btn-link" onClick={() => set({ date: null })}>
              {t('orders.backToToday')}
            </button>
          ) : null}
        </div>
        <SearchField
          label={t('orders.searchLabel')}
          placeholder={t('orders.searchPlaceholder')}
          value={search}
          onChange={setSearch}
        />
      </div>

      {slots.data?.length ? (
        <ul className="capacity" aria-label={t('orders.capacityLabel')}>
          {slots.data.map((s) => (
            <li key={s.windowId} className="card capacity-item">
              <strong>{windowText(s, lang)}</strong>
              <span>
                {s.unavailable === 'CLOSED'
                  ? t('orders.closed', { reason: s.closedReason ?? '' })
                  : t('orders.booked', { reserved: s.reservedCans, capacity: s.capacityCans })}
              </span>
              <meter
                min={0}
                max={s.capacityCans || 1}
                value={s.reservedCans}
                aria-label={windowText(s, lang)}
              />
            </li>
          ))}
        </ul>
      ) : null}

      <div className="filters" role="group" aria-label={t('orders.filterLabel')}>
        {FILTER_KEYS.map((key) => (
          <button
            key={key}
            type="button"
            className="filter"
            aria-pressed={show === key}
            onClick={() => set({ show: key === 'all' ? null : key })}
          >
            {t(`orders.filters.${key}`)}{' '}
            <span className="filter-count">{orders.filter((o) => matches(key, o)).length}</span>
          </button>
        ))}
      </div>

      {selected.size > 0 ? (
        <div className="action-bar" role="region" aria-label={t('orders.bulkLabel')}>
          <strong>{t('orders.selected', { count: selected.size })}</strong>
          <button type="button" className="btn btn-primary" onClick={() => void acceptSelected()}>
            {t('orders.accept')}
          </button>
          <button type="button" className="btn btn-link" onClick={() => setSelected(new Set())}>
            {t('common.clear')}
          </button>
        </div>
      ) : null}
      <LiveMessage text={message} tone="success" />
      {error ? (
        <p className="field-error" role="alert">
          {error}
        </p>
      ) : null}
      {show === 'needsDriver' && visible.length > 0 ? (
        <p className="muted">{t('orders.assignLater')}</p>
      ) : null}

      {list.isError ? (
        <div className="card empty" role="alert">
          {errorText(t, list.error)}
        </div>
      ) : null}
      {list.isPending ? <div className="card empty">{t('common.loading')}</div> : null}
      {list.data && visible.length === 0 ? (
        <div className="card empty">{t('orders.empty')}</div>
      ) : null}
      {visible.length > 0 ? (
        <TableWrap label={t('nav.orders')}>
          <table>
            <thead>
              <tr>
                <th scope="col" className="col-check">
                  <input
                    type="checkbox"
                    checked={allSelected}
                    disabled={selectable.length === 0}
                    onChange={() =>
                      setSelected(allSelected ? new Set() : new Set(selectable.map((o) => o.id)))
                    }
                    aria-label={t('orders.selectAll')}
                  />
                </th>
                <th scope="col">{t('orders.cols.order')}</th>
                <th scope="col">{t('orders.cols.customer')}</th>
                <th scope="col">{t('orders.cols.cans')}</th>
                <th scope="col">{t('orders.cols.slot')}</th>
                <th scope="col">{t('orders.cols.total')}</th>
                <th scope="col">{t('orders.cols.status')}</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((o) => (
                <tr key={o.id} className={selected.has(o.id) ? 'row-selected' : undefined}>
                  <td className="col-check">
                    {o.status === 'PLACED' ? (
                      <input
                        type="checkbox"
                        checked={selected.has(o.id)}
                        onChange={() => toggle(o.id)}
                        aria-label={t('orders.selectOne', {
                          id: orderNo(o.orderNo),
                          name: o.customerName ?? '',
                        })}
                      />
                    ) : null}
                  </td>
                  <th scope="row">
                    <Link to={`/orders/${o.id}`}>{orderNo(o.orderNo)}</Link>
                    <span className="cell-note">{t(`orders.channel.${o.channel}`)}</span>
                  </th>
                  <td className="wrap">
                    {o.customerName ?? t('customers.noName')}
                    <span className="cell-note">
                      {(lang === 'ml' && o.areaNameMl) || o.areaName} · {o.landmark} ·{' '}
                      {maskPhone(o.phoneLast4)}
                    </span>
                  </td>
                  <td className="num">{o.qty}</td>
                  <td>
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
        onClose={() => setAdding(false)}
        onCreated={(o) => {
          setMessage(createdText(t, o));
          if (o.deliveryDate !== date) set({ date: o.deliveryDate });
        }}
      />
    </div>
  );
}
