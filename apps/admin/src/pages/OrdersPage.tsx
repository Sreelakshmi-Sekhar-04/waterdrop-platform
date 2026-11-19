import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import type { OrderStatus } from '@wtrdrop/shared';
import { demoDrivers, demoOrders, type DemoOrderRow } from '../demo/fixtures';
import {
  DemoBadge,
  LiveMessage,
  OrderStatusChip,
  PageHeader,
  TableWrap,
  maskPhone,
} from '../components/ui';

const FILTERS = {
  all: null,
  needsDriver: ['PLACED', 'ACCEPTED'],
  onTheWay: ['ASSIGNED', 'OUT_FOR_DELIVERY'],
  problems: ['RESCHEDULE_PENDING'],
  done: ['DELIVERED', 'CANCELLED', 'REJECTED'],
} as const satisfies Record<string, readonly OrderStatus[] | null>;
type FilterKey = keyof typeof FILTERS;
const FILTER_KEYS = Object.keys(FILTERS) as FilterKey[];

/** Only orders waiting for a driver can be given to one. */
const assignable = (o: DemoOrderRow) => o.status === 'PLACED' || o.status === 'ACCEPTED';
const matches = (key: FilterKey, o: DemoOrderRow) => {
  const set: readonly OrderStatus[] | null = FILTERS[key];
  return set === null || set.includes(o.status);
};

export function OrdersPage() {
  const { t } = useTranslation();
  const [params, setParams] = useSearchParams();
  const show: FilterKey = FILTER_KEYS.includes(params.get('show') as FilterKey)
    ? (params.get('show') as FilterKey)
    : 'all';
  const [orders, setOrders] = useState(demoOrders);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [driver, setDriver] = useState(demoDrivers[0]!.name);
  const [message, setMessage] = useState<string | null>(null);

  const visible = useMemo(() => orders.filter((o) => matches(show, o)), [orders, show]);
  const selectable = visible.filter(assignable);
  const allSelected = selectable.length > 0 && selectable.every((o) => selected.has(o.id));

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const toggleAll = () =>
    setSelected(allSelected ? new Set() : new Set(selectable.map((o) => o.id)));

  const assign = () => {
    const count = selected.size;
    setOrders((prev) =>
      prev.map((o) => (selected.has(o.id) ? { ...o, status: 'ASSIGNED', driver } : o)),
    );
    setSelected(new Set());
    setMessage(t('orders.assignedDemo', { count, driver }));
  };

  return (
    <div className="page">
      <PageHeader title={t('nav.orders')} subtitle={<DemoBadge />} />

      <div className="filters" role="group" aria-label={t('orders.filterLabel')}>
        {FILTER_KEYS.map((key) => {
          const count = orders.filter((o) => matches(key, o)).length;
          return (
            <button
              key={key}
              type="button"
              className="filter"
              aria-pressed={show === key}
              onClick={() => {
                setSelected(new Set());
                setParams(key === 'all' ? {} : { show: key });
              }}
            >
              {t(`orders.filters.${key}`)} <span className="filter-count">{count}</span>
            </button>
          );
        })}
      </div>

      {selected.size > 0 ? (
        <div className="action-bar" role="region" aria-label={t('orders.bulkLabel')}>
          <strong>{t('orders.selected', { count: selected.size })}</strong>
          <label className="inline-field">
            {t('orders.driverLabel')}
            <select value={driver} onChange={(e) => setDriver(e.target.value)}>
              {demoDrivers.map((d) => (
                <option key={d.name} value={d.name}>
                  {d.name} · {d.area}
                </option>
              ))}
            </select>
          </label>
          <button type="button" className="btn btn-primary" onClick={assign}>
            {t('orders.assign')}
          </button>
          <button type="button" className="btn btn-link" onClick={() => setSelected(new Set())}>
            {t('common.clear')}
          </button>
        </div>
      ) : null}
      <LiveMessage text={message} tone="success" />

      {visible.length === 0 ? (
        <div className="card empty">{t('orders.empty')}</div>
      ) : (
        <TableWrap label={t('nav.orders')}>
          <table>
            <thead>
              <tr>
                <th scope="col" className="col-check">
                  <input
                    type="checkbox"
                    checked={allSelected}
                    disabled={selectable.length === 0}
                    onChange={toggleAll}
                    aria-label={t('orders.selectAll')}
                  />
                </th>
                <th scope="col">{t('orders.cols.order')}</th>
                <th scope="col">{t('orders.cols.customer')}</th>
                <th scope="col">{t('orders.cols.cans')}</th>
                <th scope="col">{t('orders.cols.slot')}</th>
                <th scope="col">{t('orders.cols.status')}</th>
                <th scope="col">{t('orders.cols.driver')}</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((o) => (
                <tr key={o.id} className={selected.has(o.id) ? 'row-selected' : undefined}>
                  <td className="col-check">
                    {assignable(o) ? (
                      <input
                        type="checkbox"
                        checked={selected.has(o.id)}
                        onChange={() => toggle(o.id)}
                        aria-label={t('orders.selectOne', { id: o.id, name: o.customer })}
                      />
                    ) : null}
                  </td>
                  <th scope="row">
                    {o.id}
                    <span className="cell-note">{t(`orders.channel.${o.channel}`)}</span>
                  </th>
                  <td>
                    {o.customer}
                    <span className="cell-note">
                      {o.area} · {maskPhone(o.phoneLast4)}
                    </span>
                  </td>
                  <td className="num">{o.qty}</td>
                  <td>{o.slot}</td>
                  <td>
                    <OrderStatusChip status={o.status} />
                  </td>
                  <td>{o.driver ?? <span className="muted">{t('orders.noDriver')}</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableWrap>
      )}
    </div>
  );
}
