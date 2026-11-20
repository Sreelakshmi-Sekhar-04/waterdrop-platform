import { useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { addDays, formatINR, istDate, isoDateSchema } from '@wtrdrop/shared';
import { call } from '../lib/api';
import { errorText } from '../lib/errors';
import { dayLabel, orderNo, windowText, type WindowSlot } from '../lib/orders';
import { windowOf, type OfficeDay, type Route, type Stop, type Waiting } from '../lib/deliveries';
import { Dialog } from '../components/Dialog';
import {
  Chip,
  LiveMessage,
  OrderStatusChip,
  PageHeader,
  TableWrap,
  maskPhone,
} from '../components/ui';
import type { Tone } from '../components/ui';

const TRIP_TONE: Record<Route['trip']['status'], Tone> = {
  planned: 'neutral',
  on_route: 'info',
  ended: 'warning',
  reconciled: 'success',
};

/**
 * One delivery day for the office (Phase 5): give accepted orders to a delivery person, arrange the
 * stops, follow each route, re-book orders that could not be delivered, and check each finished day.
 */
export function DeliveriesPage() {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();
  const today = istDate(new Date());
  const date = isoDateSchema.safeParse(params.get('date')).success ? params.get('date')! : today;
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [staffId, setStaffId] = useState('');
  const [rescheduling, setRescheduling] = useState<Waiting | null>(null);
  const [checking, setChecking] = useState<Route | null>(null);
  const [moving, setMoving] = useState<Route | null>(null);

  const setDate = (d: string | null) => {
    const next = new URLSearchParams(params);
    if (d === null) next.delete('date');
    else next.set('date', d);
    setSelected(new Set());
    setParams(next);
  };

  const day = useQuery({
    queryKey: ['deliveries', date],
    queryFn: () => call<OfficeDay>(`/admin/deliveries?date=${date}`),
    placeholderData: (prev) => prev,
    refetchInterval: 30_000,
  });
  const d = day.data?.date === date ? day.data : undefined;
  const staff = d?.staff ?? [];
  const chosen = staff.some((s) => s.userId === staffId) ? staffId : (staff[0]?.userId ?? '');

  /** Runs an office action, shows its result, and reloads the day (and orders/stock). */
  const run = async (fn: () => Promise<string | null>) => {
    setError(null);
    setMessage(null);
    try {
      const text = await fn();
      if (text) setMessage(text);
      return true;
    } catch (e) {
      setError(errorText(t, e));
      return false;
    } finally {
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['deliveries'] }),
        qc.invalidateQueries({ queryKey: ['orders'] }),
        qc.invalidateQueries({ queryKey: ['stock'] }),
      ]);
    }
  };

  const assign = () =>
    run(async () => {
      const r = await call<{ assigned: number; skipped: unknown[] }>('/admin/deliveries/assign', {
        method: 'POST',
        body: { date, staffUserId: chosen, orderIds: [...selected] },
      });
      setSelected(new Set());
      const name = staff.find((s) => s.userId === chosen)?.name ?? '';
      return r.skipped.length
        ? t('deliveries.assignedSome', { count: r.assigned, name, skipped: r.skipped.length })
        : t('deliveries.assigned', { count: r.assigned, name });
    });

  const unassigned = d?.unassigned ?? [];
  const allSelected = unassigned.length > 0 && unassigned.every((o) => selected.has(o.orderId));
  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <div className="page">
      <PageHeader title={t('nav.deliveries')} subtitle={dayLabel(t, date, lang)} />

      <div className="toolbar">
        <div className="day-nav" role="group" aria-label={t('orders.dayLabel')}>
          <button
            type="button"
            className="btn btn-secondary btn-compact"
            onClick={() => setDate(addDays(date, -1))}
          >
            ← {t('orders.prevDay')}
          </button>
          <label className="inline-field">
            <span className="visually-hidden">{t('orders.date')}</span>
            <input
              type="date"
              value={date}
              onChange={(e) => e.target.value && setDate(e.target.value)}
            />
          </label>
          <button
            type="button"
            className="btn btn-secondary btn-compact"
            onClick={() => setDate(addDays(date, 1))}
          >
            {t('orders.nextDay')} →
          </button>
          {date !== today ? (
            <button type="button" className="btn btn-link" onClick={() => setDate(null)}>
              {t('orders.backToToday')}
            </button>
          ) : null}
        </div>
      </div>

      <LiveMessage text={message} tone="success" />
      {error ? (
        <p className="field-error" role="alert">
          {error}
        </p>
      ) : null}
      {day.isError ? (
        <div className="card empty" role="alert">
          {errorText(t, day.error)}
        </div>
      ) : null}
      {!d && !day.isError ? <div className="card empty">{t('common.loading')}</div> : null}

      {d && d.toReconcile.length > 0 ? (
        <section aria-labelledby="check-h" className="card attention-list">
          <h2 id="check-h">{t('deliveries.toCheck')}</h2>
          <ul className="plain-list">
            {d.toReconcile.map((r) => (
              <li key={r.id}>
                {r.date === date ? (
                  <span>
                    {r.staffName} · {dayLabel(t, r.date, lang)}
                  </span>
                ) : (
                  <button type="button" className="btn btn-link" onClick={() => setDate(r.date)}>
                    {r.staffName} · {dayLabel(t, r.date, lang)}
                  </button>
                )}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {d ? (
        <section aria-labelledby="waiting-h">
          <div className="section-head">
            <h2 id="waiting-h">
              {t('deliveries.waiting')} <span className="filter-count">{unassigned.length}</span>
            </h2>
          </div>
          {staff.length === 0 ? (
            <p className="muted">
              {t('deliveries.noStaff')} <Link to="/staff">{t('nav.staff')}</Link>
            </p>
          ) : null}
          {unassigned.length === 0 ? (
            <div className="card empty">{t('deliveries.noneWaiting')}</div>
          ) : (
            <>
              {selected.size > 0 && staff.length > 0 ? (
                <div className="action-bar" role="region" aria-label={t('deliveries.assignLabel')}>
                  <strong>{t('orders.selected', { count: selected.size })}</strong>
                  <label className="inline-field">
                    <span>{t('deliveries.giveTo')}</span>
                    <select value={chosen} onChange={(e) => setStaffId(e.target.value)}>
                      {staff.map((s) => (
                        <option key={s.userId} value={s.userId}>
                          {s.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <button type="button" className="btn btn-primary" onClick={() => void assign()}>
                    {t('deliveries.assign')}
                  </button>
                  <button
                    type="button"
                    className="btn btn-link"
                    onClick={() => setSelected(new Set())}
                  >
                    {t('common.clear')}
                  </button>
                </div>
              ) : null}
              <TableWrap label={t('deliveries.waiting')}>
                <table>
                  <thead>
                    <tr>
                      <th scope="col" className="col-check">
                        <input
                          type="checkbox"
                          checked={allSelected}
                          onChange={() =>
                            setSelected(
                              allSelected ? new Set() : new Set(unassigned.map((o) => o.orderId)),
                            )
                          }
                          aria-label={t('deliveries.selectAll')}
                        />
                      </th>
                      <th scope="col">{t('orders.cols.order')}</th>
                      <th scope="col">{t('orders.cols.customer')}</th>
                      <th scope="col">{t('orders.cols.cans')}</th>
                      <th scope="col">{t('orders.cols.slot')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {unassigned.map((o) => (
                      <tr
                        key={o.orderId}
                        className={selected.has(o.orderId) ? 'row-selected' : undefined}
                      >
                        <td className="col-check">
                          <input
                            type="checkbox"
                            checked={selected.has(o.orderId)}
                            onChange={() => toggle(o.orderId)}
                            aria-label={t('orders.selectOne', {
                              id: orderNo(o.orderNo),
                              name: o.customerName ?? '',
                            })}
                          />
                        </td>
                        <th scope="row">
                          <Link to={`/orders/${o.orderId}`}>{orderNo(o.orderNo)}</Link>
                        </th>
                        <td className="wrap">
                          {o.customerName ?? t('customers.noName')}
                          <span className="cell-note">
                            {o.address.areaName} · {o.address.landmark}
                          </span>
                        </td>
                        <td className="num">{o.qty}</td>
                        <td>{windowText(windowOf(o), lang)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableWrap>
            </>
          )}
        </section>
      ) : null}

      {d && d.toReschedule.length > 0 ? (
        <section aria-labelledby="failed-h">
          <h2 id="failed-h">
            {t('deliveries.failed')} <span className="filter-count">{d.toReschedule.length}</span>
          </h2>
          <ul className="grid grid-attention">
            {d.toReschedule.map((o) => (
              <li key={o.orderId} className="card attention">
                <strong>
                  <Link to={`/orders/${o.orderId}`}>{orderNo(o.orderNo)}</Link> ·{' '}
                  {o.customerName ?? t('customers.noName')} ·{' '}
                  {t('deliveries.cans', { count: o.qty })}
                </strong>
                <span className="muted">
                  {o.address.areaName} · {o.address.landmark} · {dayLabel(t, o.deliveryDate, lang)}
                </span>
                {o.failure ? (
                  <span>
                    {t(`deliveries.reason.${o.failure.reason ?? 'OTHER'}`)}
                    {o.failure.note ? ` · ${o.failure.note}` : ''}
                  </span>
                ) : null}
                <button
                  type="button"
                  className="btn btn-secondary btn-compact"
                  onClick={() => setRescheduling(o)}
                >
                  {t('deliveries.newTime')}
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {d ? (
        <section aria-labelledby="routes-h">
          <h2 id="routes-h">{t('deliveries.routes')}</h2>
          {d.routes.length === 0 ? (
            <div className="card empty">{t('deliveries.noRoutes')}</div>
          ) : (
            d.routes.map((r) => (
              <RouteCard
                key={r.trip.id}
                route={r}
                onMove={() => setMoving(r)}
                onCheck={() => setChecking(r)}
                canMove={staff.length > 1}
                run={run}
              />
            ))
          )}
        </section>
      ) : null}

      <RescheduleDialog
        order={rescheduling}
        from={today}
        onClose={() => setRescheduling(null)}
        run={run}
      />
      <ReconcileDialog route={checking} onClose={() => setChecking(null)} run={run} />
      <MoveDialog route={moving} staff={staff} onClose={() => setMoving(null)} run={run} />
    </div>
  );
}

type Run = (fn: () => Promise<string | null>) => Promise<boolean>;

function stopResult(t: ReturnType<typeof useTranslation>['t'], s: Stop) {
  const a = s.attempt;
  if (!a) return null;
  if (a.outcome === 'failed') return t(`deliveries.reason.${a.failureReason ?? 'OTHER'}`);
  const money =
    a.paymentMethod === 'later'
      ? t('deliveries.payLater')
      : `${formatINR(a.amountCollectedPaise)} ${t(`deliveries.method.${a.paymentMethod ?? 'cash'}`)}`;
  return t('deliveries.delivered', {
    full: a.fullDelivered,
    empty: a.emptyCollected + a.extraEmpties,
    money,
  });
}

function RouteCard({
  route,
  onMove,
  onCheck,
  canMove,
  run,
}: {
  route: Route;
  onMove: () => void;
  onCheck: () => void;
  canMove: boolean;
  run: Run;
}) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const { trip, totals, stops, differences } = route;
  const planned = trip.status === 'planned';
  const ids = stops.map((s) => s.orderId);
  const name = route.staffName ?? '';
  const headingId = `route-${trip.id}`;

  const moveStop = (i: number, by: -1 | 1) => {
    const next = [...ids];
    [next[i], next[i + by]] = [next[i + by]!, next[i]!];
    void run(async () => {
      await call(`/admin/trips/${trip.id}/sequence`, { method: 'PUT', body: { orderIds: next } });
      return null;
    });
  };
  const remove = (s: Stop) =>
    void run(async () => {
      await call('/admin/deliveries/unassign', { method: 'POST', body: { orderIds: [s.orderId] } });
      return t('deliveries.removed', { no: orderNo(s.orderNo), name });
    });

  return (
    <article className="card route" aria-labelledby={headingId}>
      <div className="section-head">
        <h3 id={headingId}>
          {name} <Chip tone={TRIP_TONE[trip.status]}>{t(`deliveries.trip.${trip.status}`)}</Chip>
        </h3>
        <div className="page-actions">
          {planned && canMove ? (
            <button type="button" className="btn btn-secondary btn-compact" onClick={onMove}>
              {t('deliveries.move')}
            </button>
          ) : null}
          {trip.status === 'ended' ? (
            <button type="button" className="btn btn-primary btn-compact" onClick={onCheck}>
              {t('deliveries.check')}
            </button>
          ) : null}
        </div>
      </div>

      <p className="route-progress">
        <span>{t('deliveries.progress', { done: totals.done, count: totals.stops })}</span>
        <meter min={0} max={totals.stops || 1} value={totals.done} aria-label={name} />
      </p>
      <dl className="route-totals">
        <div>
          <dt>{planned ? t('deliveries.toLoad') : t('deliveries.loaded')}</dt>
          <dd>{planned ? totals.plannedLoad : (trip.loadFull ?? 0)}</dd>
        </div>
        <div>
          <dt>{t('deliveries.fullDelivered')}</dt>
          <dd>{totals.fullDelivered}</dd>
        </div>
        <div>
          <dt>{t('deliveries.empties')}</dt>
          <dd>{totals.emptiesCollected}</dd>
        </div>
        <div>
          <dt>{t('deliveries.method.cash')}</dt>
          <dd>{formatINR(totals.cashPaise)}</dd>
        </div>
        <div>
          <dt>{t('deliveries.method.upi')}</dt>
          <dd>{formatINR(totals.upiPaise)}</dd>
        </div>
        <div>
          <dt>{t('deliveries.method.later')}</dt>
          <dd>{formatINR(totals.laterPaise)}</dd>
        </div>
      </dl>

      {differences ? (
        <p className={trip.status === 'ended' ? 'route-diff tone-warning' : 'route-diff'}>
          {diffText(t, differences)}
          {trip.endNote ? ` · ${t('deliveries.staffNote')}: ${trip.endNote}` : ''}
          {trip.reconcileNote ? ` · ${t('deliveries.officeNote')}: ${trip.reconcileNote}` : ''}
        </p>
      ) : null}

      <ol className="stops">
        {stops.map((s, i) => (
          <li key={s.orderId} className="stop">
            <span className="stop-no" aria-hidden="true">
              {i + 1}
            </span>
            <div className="stop-main">
              <strong>
                <Link to={`/orders/${s.orderId}`}>{orderNo(s.orderNo)}</Link> ·{' '}
                {s.customerName ?? t('customers.noName')} · {t('deliveries.cans', { count: s.qty })}
              </strong>
              <span className="cell-note">
                {s.address.areaName} · {s.address.landmark} · {maskPhone(s.phoneLast4)} ·{' '}
                {windowText(windowOf(s), lang)}
              </span>
              {s.attempt ? <span className="cell-note">{stopResult(t, s)}</span> : null}
              {s.attempt?.overCreditLimit ? (
                <Chip tone="warning">{t('deliveries.overLimit')}</Chip>
              ) : null}
            </div>
            <OrderStatusChip status={s.status} />
            {planned ? (
              <div className="stop-actions">
                <button
                  type="button"
                  className="btn btn-secondary btn-icon"
                  disabled={i === 0}
                  onClick={() => moveStop(i, -1)}
                  aria-label={t('deliveries.up', { no: orderNo(s.orderNo) })}
                >
                  ↑
                </button>
                <button
                  type="button"
                  className="btn btn-secondary btn-icon"
                  disabled={i === stops.length - 1}
                  onClick={() => moveStop(i, 1)}
                  aria-label={t('deliveries.down', { no: orderNo(s.orderNo) })}
                >
                  ↓
                </button>
                {s.status === 'ASSIGNED' ? (
                  <button type="button" className="btn btn-link" onClick={() => remove(s)}>
                    {t('deliveries.remove')}
                  </button>
                ) : null}
              </div>
            ) : null}
          </li>
        ))}
      </ol>
    </article>
  );
}

function diffText(
  t: ReturnType<typeof useTranslation>['t'],
  d: { full: number; empty: number; cashPaise: number },
) {
  if (d.full === 0 && d.empty === 0 && d.cashPaise === 0) return t('deliveries.allMatch');
  const part = (label: string, n: number, show: string) =>
    n === 0 ? null : t(n < 0 ? 'deliveries.short' : 'deliveries.extra', { what: label, n: show });
  return [
    part(t('deliveries.fullCans'), d.full, String(Math.abs(d.full))),
    part(t('deliveries.emptyCans'), d.empty, String(Math.abs(d.empty))),
    part(t('deliveries.cash'), d.cashPaise, formatINR(Math.abs(d.cashPaise))),
  ]
    .filter(Boolean)
    .join(' · ');
}

function RescheduleDialog({
  order,
  from,
  onClose,
  run,
}: {
  order: Waiting | null;
  from: string;
  onClose: () => void;
  run: Run;
}) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const [date, setDate] = useState(from);
  const [windowId, setWindowId] = useState('');
  const slots = useQuery({
    queryKey: ['window-slots', date],
    enabled: !!order,
    queryFn: async () =>
      (await call<{ slots: WindowSlot[] }>(`/admin/window-slots?from=${date}&days=1`)).slots,
  });
  const open = (slots.data ?? []).filter((s) => s.unavailable !== 'CLOSED');
  const pick = open.some((s) => s.windowId === windowId && s.remainingCans >= (order?.qty ?? 1))
    ? windowId
    : (open.find((s) => s.remainingCans >= (order?.qty ?? 1))?.windowId ?? '');
  const close = () => {
    setDate(from);
    setWindowId('');
    onClose();
  };
  const save = async () => {
    if (!order || !pick) return;
    const ok = await run(async () => {
      await call(`/admin/orders/${order.orderId}/reschedule`, {
        method: 'POST',
        body: { date, windowId: pick },
      });
      return t('deliveries.rescheduled', {
        no: orderNo(order.orderNo),
        when: dayLabel(t, date, lang),
      });
    });
    if (ok) close();
  };
  return (
    <Dialog open={!!order} title={t('deliveries.newTime')} onClose={close}>
      {order ? (
        <form
          className="form"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <p className="muted">
            {orderNo(order.orderNo)} · {order.customerName} ·{' '}
            {t('deliveries.cans', { count: order.qty })}
          </p>
          <label className="field">
            <span>{t('orders.date')}</span>
            <input
              type="date"
              min={from}
              value={date}
              onChange={(e) => e.target.value && setDate(e.target.value)}
            />
          </label>
          <label className="field">
            <span>{t('newOrder.when')}</span>
            <select value={pick} onChange={(e) => setWindowId(e.target.value)}>
              {open.map((s) => (
                <option key={s.windowId} value={s.windowId} disabled={s.remainingCans < order.qty}>
                  {windowText(s, lang)} · {t('newOrder.free', { count: s.remainingCans })}
                </option>
              ))}
            </select>
          </label>
          {slots.data && !pick ? (
            <p className="field-error" role="alert">
              {t('deliveries.noSlot')}
            </p>
          ) : null}
          <div className="form-actions">
            <button type="submit" className="btn btn-primary" disabled={!pick}>
              {t('deliveries.saveTime')}
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

function ReconcileDialog({
  route,
  onClose,
  run,
}: {
  route: Route | null;
  onClose: () => void;
  run: Run;
}) {
  const { t } = useTranslation();
  const [note, setNote] = useState('');
  const [tried, setTried] = useState(false);
  const d = route?.differences;
  const differs = !!d && (d.full !== 0 || d.empty !== 0 || d.cashPaise !== 0);
  const bad = tried && differs && note.trim().length < 3;
  const close = () => {
    setNote('');
    setTried(false);
    onClose();
  };
  const save = async () => {
    setTried(true);
    if (!route || (differs && note.trim().length < 3)) return;
    const ok = await run(async () => {
      await call(`/admin/trips/${route.trip.id}/reconcile`, {
        method: 'POST',
        body: { note: note.trim() || undefined },
      });
      return t('deliveries.checked', { name: route.staffName ?? '' });
    });
    if (ok) close();
  };
  const tr = route?.trip;
  return (
    <Dialog
      open={!!route}
      title={t('deliveries.checkTitle', { name: route?.staffName ?? '' })}
      onClose={close}
    >
      {route && tr && d ? (
        <form
          className="form"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <TableWrap label={t('deliveries.checkTitle', { name: route.staffName ?? '' })}>
            <table>
              <thead>
                <tr>
                  <th scope="col">{t('deliveries.what')}</th>
                  <th scope="col">{t('deliveries.expected')}</th>
                  <th scope="col">{t('deliveries.counted')}</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <th scope="row">{t('deliveries.fullCans')}</th>
                  <td className="num">{tr.expectedFull}</td>
                  <td className="num">{tr.returnFull}</td>
                </tr>
                <tr>
                  <th scope="row">{t('deliveries.emptyCans')}</th>
                  <td className="num">{tr.expectedEmpty}</td>
                  <td className="num">
                    {tr.returnEmpty}
                    {tr.returnDamaged ? (
                      <span className="cell-note">
                        {t('deliveries.damagedOf', { count: tr.returnDamaged })}
                      </span>
                    ) : null}
                  </td>
                </tr>
                <tr>
                  <th scope="row">{t('deliveries.cash')}</th>
                  <td className="num">{formatINR(tr.expectedCashPaise ?? 0)}</td>
                  <td className="num">{formatINR(tr.cashHandedPaise ?? 0)}</td>
                </tr>
              </tbody>
            </table>
          </TableWrap>
          <p className={differs ? 'tone-warning' : undefined}>{diffText(t, d)}</p>
          {tr.endNote ? (
            <p className="muted">
              {t('deliveries.staffNote')}: {tr.endNote}
            </p>
          ) : null}
          <label className="field">
            <span>{differs ? t('deliveries.whatHappened') : t('deliveries.noteOptional')}</span>
            <textarea
              value={note}
              maxLength={300}
              onChange={(e) => setNote(e.target.value)}
              aria-invalid={bad}
            />
            {bad ? <span className="field-error">{t('errors.REASON_REQUIRED')}</span> : null}
          </label>
          {differs ? <p className="field-hint">{t('deliveries.writeOffHint')}</p> : null}
          <div className="form-actions">
            <button type="submit" className="btn btn-primary">
              {t('deliveries.closeDay')}
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

function MoveDialog({
  route,
  staff,
  onClose,
  run,
}: {
  route: Route | null;
  staff: OfficeDay['staff'];
  onClose: () => void;
  run: Run;
}) {
  const { t } = useTranslation();
  const others = staff.filter((s) => s.userId !== route?.trip.staffUserId);
  const [to, setTo] = useState('');
  const target = others.some((s) => s.userId === to) ? to : (others[0]?.userId ?? '');
  const close = () => {
    setTo('');
    onClose();
  };
  const save = async () => {
    if (!route || !target) return;
    const name = others.find((s) => s.userId === target)?.name ?? '';
    const ok = await run(async () => {
      const r = await call<{ moved: number }>(`/admin/trips/${route.trip.id}/move`, {
        method: 'POST',
        body: { staffUserId: target },
      });
      return t('deliveries.moved', { count: r.moved, from: route.staffName ?? '', to: name });
    });
    if (ok) close();
  };
  return (
    <Dialog
      open={!!route}
      title={t('deliveries.moveTitle', { name: route?.staffName ?? '' })}
      onClose={close}
    >
      <form
        className="form"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <p className="muted">{t('deliveries.moveHint')}</p>
        <label className="field">
          <span>{t('deliveries.giveTo')}</span>
          <select value={target} onChange={(e) => setTo(e.target.value)}>
            {others.map((s) => (
              <option key={s.userId} value={s.userId}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
        <div className="form-actions">
          <button type="submit" className="btn btn-primary" disabled={!target}>
            {t('deliveries.moveSave')}
          </button>
          <button type="button" className="btn btn-secondary" onClick={close}>
            {t('common.cancel')}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
