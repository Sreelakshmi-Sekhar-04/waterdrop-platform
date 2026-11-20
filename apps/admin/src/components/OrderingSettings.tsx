import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { formatINR, istDate, timeOfDaySchema } from '@wtrdrop/shared';
import { call } from '../lib/api';
import { errorText } from '../lib/errors';
import { isOwner, useAuth } from '../lib/auth';
import { dayLabel, windowName, windowText } from '../lib/orders';
import { Dialog } from './Dialog';
import { Chip, LiveMessage, TableWrap } from './ui';

interface Catalog {
  product: { id: string; nameEn: string; nameMl: string };
  currentPricePaise: number;
  scheduled: { pricePaise: number; validFrom: string }[];
  history: { pricePaise: number; validFrom: string }[];
}
interface DeliveryWindow {
  id: string;
  nameEn: string;
  nameMl: string;
  startTime: string;
  endTime: string;
  capacityCans: number;
  daysOfWeek: number[];
  status: 'active' | 'disabled';
}
interface ClosedDay {
  id: string;
  date: string;
  windowId: string | null;
  reason: string;
}

/** Rupees typed by a person ("40" or "40.50") to paise; null when it is not a sensible amount. */
export const rupeesToPaise = (text: string): number | null => {
  const s = text.trim();
  if (!/^\d{1,5}(\.\d{1,2})?$/.test(s)) return null;
  return Math.round(Number(s) * 100);
};

const DAYS = [1, 2, 3, 4, 5, 6, 0] as const;

/** M-21 / D-11: the standard can price, with prices that start on a later date. Owner changes it. */
export function PriceSettings() {
  const { t, i18n } = useTranslation();
  const { me } = useAuth();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['catalog'], queryFn: () => call<Catalog>('/admin/catalog') });
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState('');
  const [from, setFrom] = useState('');
  const [tried, setTried] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const today = istDate(new Date());
  const paise = rupeesToPaise(amount);
  const badDate = !from || from < today;

  const close = () => {
    setOpen(false);
    setTried(false);
    setError(null);
  };
  const save = async () => {
    setTried(true);
    if (paise === null || badDate) return;
    setError(null);
    try {
      await call('/admin/catalog/prices', {
        method: 'POST',
        body: { pricePaise: paise, validFrom: from },
      });
      setMessage(
        t('price.standardSaved', {
          price: formatINR(paise),
          from: dayLabel(t, from, i18n.language),
        }),
      );
      await qc.invalidateQueries({ queryKey: ['catalog'] });
      await qc.invalidateQueries({ queryKey: ['order-options'] });
      close();
    } catch (e) {
      setError(errorText(t, e));
    }
  };

  return (
    <>
      <LiveMessage text={message} tone="success" />
      {q.isError ? (
        <div className="card empty" role="alert">
          {errorText(t, q.error)}
        </div>
      ) : null}
      {q.data ? (
        <div className="card price-card">
          <p>
            <strong>
              {i18n.language === 'ml' ? q.data.product.nameMl : q.data.product.nameEn}
            </strong>
            <br />
            <span className="price-big">{formatINR(q.data.currentPricePaise)}</span>{' '}
            <span className="muted">{t('price.perCanShort')}</span>
          </p>
          {q.data.scheduled.length ? (
            <ul className="plain">
              {q.data.scheduled.map((s) => (
                <li key={s.validFrom}>
                  {t('price.scheduled', {
                    price: formatINR(s.pricePaise),
                    from: dayLabel(t, s.validFrom, i18n.language),
                  })}
                </li>
              ))}
            </ul>
          ) : null}
          {isOwner(me) ? (
            <button
              type="button"
              className="btn btn-secondary btn-compact"
              onClick={() => {
                setAmount(String(q.data.currentPricePaise / 100));
                setFrom(today);
                setOpen(true);
              }}
            >
              {t('price.changeStandard')}
            </button>
          ) : (
            <p className="muted">{t('price.ownerOnly')}</p>
          )}
          {q.data.history.length > 1 ? (
            <details>
              <summary>{t('price.history')}</summary>
              <ul className="plain">
                {q.data.history.map((h) => (
                  <li key={h.validFrom}>
                    {h.validFrom}: {formatINR(h.pricePaise)}
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
        </div>
      ) : null}
      <Dialog open={open} title={t('price.changeStandard')} onClose={close}>
        <form
          className="form"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <p className="muted">{t('price.standardHelp')}</p>
          <label className="field">
            <span>{t('price.amount')}</span>
            <input
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              aria-invalid={tried && paise === null}
              autoFocus
            />
            {tried && paise === null ? (
              <span className="field-error">{t('price.badAmount')}</span>
            ) : null}
          </label>
          <label className="field">
            <span>{t('price.from')}</span>
            <input
              type="date"
              min={today}
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              aria-invalid={tried && badDate}
            />
            {tried && badDate ? <span className="field-error">{t('price.badDate')}</span> : null}
          </label>
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
      </Dialog>
    </>
  );
}

/** D-07 / D-08: broad delivery times with a number of cans each. */
export function WindowSettings() {
  const { t, i18n } = useTranslation();
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ['windows'],
    queryFn: async () => (await call<{ windows: DeliveryWindow[] }>('/admin/windows')).windows,
  });
  const [editing, setEditing] = useState<DeliveryWindow | 'new' | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const lang = i18n.language;
  return (
    <>
      <div className="section-head">
        <span />
        <button
          type="button"
          className="btn btn-primary btn-compact"
          onClick={() => setEditing('new')}
        >
          {t('windows.add')}
        </button>
      </div>
      <LiveMessage text={message} tone="success" />
      {q.isError ? (
        <div className="card empty" role="alert">
          {errorText(t, q.error)}
        </div>
      ) : null}
      {q.data?.length === 0 ? <div className="card empty">{t('windows.none')}</div> : null}
      {q.data && q.data.length > 0 ? (
        <TableWrap label={t('settings.windows')}>
          <table>
            <thead>
              <tr>
                <th scope="col">{t('windows.cols.name')}</th>
                <th scope="col">{t('windows.cols.cans')}</th>
                <th scope="col">{t('windows.cols.days')}</th>
                <th scope="col">{t('team.cols.status')}</th>
                <th scope="col">{t('team.cols.actions')}</th>
              </tr>
            </thead>
            <tbody>
              {q.data.map((w) => (
                <tr key={w.id}>
                  <th scope="row">{windowText(w, lang)}</th>
                  <td className="num">{w.capacityCans}</td>
                  <td className="wrap">
                    {DAYS.filter((d) => w.daysOfWeek.includes(d))
                      .map((d) => t(`windows.day.${d}`))
                      .join(', ')}
                  </td>
                  <td>
                    {w.status === 'active' ? (
                      <Chip tone="success">{t('common.active')}</Chip>
                    ) : (
                      <Chip tone="neutral">{t('common.switchedOff')}</Chip>
                    )}
                  </td>
                  <td>
                    <button
                      type="button"
                      className="btn btn-link"
                      onClick={() => setEditing(w)}
                      aria-label={t('windows.edit', { name: windowName(w, lang) })}
                    >
                      {t('common.edit')}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableWrap>
      ) : null}
      <WindowDialog
        key={editing === null ? 'closed' : editing === 'new' ? 'new' : editing.id}
        window={editing}
        onClose={() => setEditing(null)}
        onSaved={(name) => {
          setMessage(t('windows.saved', { name }));
          void qc.invalidateQueries({ queryKey: ['windows'] });
          void qc.invalidateQueries({ queryKey: ['window-slots'] });
        }}
      />
    </>
  );
}

function WindowDialog({
  window: w,
  onClose,
  onSaved,
}: {
  window: DeliveryWindow | 'new' | null;
  onClose: () => void;
  onSaved: (name: string) => void;
}) {
  const { t } = useTranslation();
  const existing = w && w !== 'new' ? w : null;
  const [nameEn, setNameEn] = useState(existing?.nameEn ?? '');
  const [nameMl, setNameMl] = useState(existing?.nameMl ?? '');
  const [start, setStart] = useState(existing?.startTime ?? '');
  const [end, setEnd] = useState(existing?.endTime ?? '');
  const [cans, setCans] = useState(String(existing?.capacityCans ?? 100));
  const [days, setDays] = useState<number[]>(existing?.daysOfWeek ?? [1, 2, 3, 4, 5, 6]);
  const [active, setActive] = useState(existing ? existing.status === 'active' : true);
  const [tried, setTried] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const cansN = /^\d{1,5}$/.test(cans.trim()) ? Number(cans) : null;
  const timesOk =
    timeOfDaySchema.safeParse(start).success &&
    timeOfDaySchema.safeParse(end).success &&
    start < end;
  const ok = nameEn.trim() && nameMl.trim() && timesOk && cansN !== null && days.length > 0;

  const save = async () => {
    setTried(true);
    if (!ok) return;
    setError(null);
    const body = {
      nameEn: nameEn.trim(),
      nameMl: nameMl.trim(),
      startTime: start,
      endTime: end,
      capacityCans: cansN,
      daysOfWeek: days,
      status: active ? 'active' : 'disabled',
    };
    try {
      if (existing) await call(`/admin/windows/${existing.id}`, { method: 'PATCH', body });
      else await call('/admin/windows', { method: 'POST', body });
      onSaved(body.nameEn);
      onClose();
    } catch (e) {
      setError(errorText(t, e));
    }
  };

  return (
    <Dialog
      open={!!w}
      title={existing ? t('windows.edit', { name: existing.nameEn }) : t('windows.add')}
      onClose={onClose}
    >
      <form
        className="form"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <label className="field">
          <span>{t('windows.nameEn')}</span>
          <input
            value={nameEn}
            maxLength={40}
            onChange={(e) => setNameEn(e.target.value)}
            aria-invalid={tried && !nameEn.trim()}
            autoFocus
          />
        </label>
        <label className="field">
          <span>{t('windows.nameMl')}</span>
          <input
            lang="ml"
            value={nameMl}
            maxLength={40}
            onChange={(e) => setNameMl(e.target.value)}
            aria-invalid={tried && !nameMl.trim()}
          />
        </label>
        <div className="field-row">
          <label className="field">
            <span>{t('windows.start')}</span>
            <input
              type="time"
              value={start}
              onChange={(e) => setStart(e.target.value)}
              aria-invalid={tried && !timesOk}
            />
          </label>
          <label className="field">
            <span>{t('windows.end')}</span>
            <input
              type="time"
              value={end}
              onChange={(e) => setEnd(e.target.value)}
              aria-invalid={tried && !timesOk}
            />
          </label>
        </div>
        {tried && !timesOk ? <span className="field-error">{t('windows.badTimes')}</span> : null}
        <label className="field">
          <span>{t('windows.cans')}</span>
          <input
            inputMode="numeric"
            value={cans}
            onChange={(e) => setCans(e.target.value)}
            aria-invalid={tried && cansN === null}
            aria-describedby="cans-hint"
          />
          <span id="cans-hint" className="field-hint">
            {t('windows.cansHint')}
          </span>
        </label>
        <fieldset className="fieldset">
          <legend>{t('windows.days')}</legend>
          <div className="day-picks">
            {DAYS.map((d) => (
              <label key={d} className="check">
                <input
                  type="checkbox"
                  checked={days.includes(d)}
                  onChange={(e) =>
                    setDays((prev) =>
                      e.target.checked ? [...prev, d] : prev.filter((x) => x !== d),
                    )
                  }
                />
                {t(`windows.day.${d}`)}
              </label>
            ))}
          </div>
          {tried && days.length === 0 ? (
            <span className="field-error">{t('windows.needDay')}</span>
          ) : null}
        </fieldset>
        {existing ? (
          <label className="check">
            <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
            {t('windows.active')}
          </label>
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
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            {t('common.cancel')}
          </button>
        </div>
      </form>
    </Dialog>
  );
}

/** M-12: holidays and days off. Orders already booked stay; the office is told how many to call. */
export function ClosedDaySettings() {
  const { t, i18n } = useTranslation();
  const qc = useQueryClient();
  const lang = i18n.language;
  const list = useQuery({
    queryKey: ['closed-days'],
    queryFn: async () => (await call<{ closedDays: ClosedDay[] }>('/admin/closed-days')).closedDays,
  });
  const windows = useQuery({
    queryKey: ['windows'],
    queryFn: async () => (await call<{ windows: DeliveryWindow[] }>('/admin/windows')).windows,
  });
  const today = istDate(new Date());
  const [open, setOpen] = useState(false);
  const [date, setDate] = useState('');
  const [windowId, setWindowId] = useState('');
  const [reason, setReason] = useState('');
  const [tried, setTried] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const nameOf = (id: string | null) => {
    const w = id ? windows.data?.find((x) => x.id === id) : null;
    return w ? windowName(w, lang) : t('closed.wholeDay');
  };
  const refresh = async () => {
    await qc.invalidateQueries({ queryKey: ['closed-days'] });
    await qc.invalidateQueries({ queryKey: ['window-slots'] });
    await qc.invalidateQueries({ queryKey: ['order-options'] });
  };
  const close = () => {
    setOpen(false);
    setTried(false);
    setError(null);
  };
  const save = async () => {
    setTried(true);
    if (!date || date < today || reason.trim().length < 3) return;
    setError(null);
    try {
      const r = await call<{ closedDay: ClosedDay & { ordersAlreadyBooked: number } }>(
        '/admin/closed-days',
        { method: 'POST', body: { date, windowId: windowId || null, reason: reason.trim() } },
      );
      const when = `${dayLabel(t, date, lang)} · ${nameOf(r.closedDay.windowId)}`;
      setMessage(
        r.closedDay.ordersAlreadyBooked
          ? t('closed.savedWithOrders', { when, count: r.closedDay.ordersAlreadyBooked })
          : t('closed.saved', { when }),
      );
      await refresh();
      close();
    } catch (e) {
      setError(errorText(t, e));
    }
  };
  const reopen = async (c: ClosedDay) => {
    setError(null);
    try {
      await call(`/admin/closed-days/${c.id}`, { method: 'DELETE' });
      setMessage(
        t('closed.reopened', { when: `${dayLabel(t, c.date, lang)} · ${nameOf(c.windowId)}` }),
      );
      await refresh();
    } catch (e) {
      setMessage(null);
      setError(errorText(t, e));
    }
  };

  return (
    <>
      <div className="section-head">
        <span />
        <button
          type="button"
          className="btn btn-primary btn-compact"
          onClick={() => {
            setDate('');
            setWindowId('');
            setReason('');
            setOpen(true);
          }}
        >
          {t('closed.add')}
        </button>
      </div>
      <LiveMessage text={message} tone="success" />
      {error && !open ? (
        <p className="field-error" role="alert">
          {error}
        </p>
      ) : null}
      {list.isError ? (
        <div className="card empty" role="alert">
          {errorText(t, list.error)}
        </div>
      ) : null}
      {list.data?.length === 0 ? <div className="card empty">{t('closed.none')}</div> : null}
      {list.data && list.data.length > 0 ? (
        <TableWrap label={t('settings.closedDays')}>
          <table>
            <thead>
              <tr>
                <th scope="col">{t('closed.cols.date')}</th>
                <th scope="col">{t('closed.cols.time')}</th>
                <th scope="col">{t('closed.cols.reason')}</th>
                <th scope="col">{t('team.cols.actions')}</th>
              </tr>
            </thead>
            <tbody>
              {list.data.map((c) => (
                <tr key={c.id}>
                  <th scope="row">{dayLabel(t, c.date, lang)}</th>
                  <td>{nameOf(c.windowId)}</td>
                  <td className="wrap">{c.reason}</td>
                  <td>
                    <button
                      type="button"
                      className="btn btn-link"
                      onClick={() => void reopen(c)}
                      aria-label={t('closed.reopenLabel', {
                        when: `${dayLabel(t, c.date, lang)} · ${nameOf(c.windowId)}`,
                      })}
                    >
                      {t('closed.reopen')}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableWrap>
      ) : null}
      <Dialog open={open} title={t('closed.add')} onClose={close}>
        <form
          className="form"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <p className="muted">{t('closed.help')}</p>
          <label className="field">
            <span>{t('closed.cols.date')}</span>
            <input
              type="date"
              min={today}
              value={date}
              onChange={(e) => setDate(e.target.value)}
              aria-invalid={tried && (!date || date < today)}
              autoFocus
            />
            {tried && (!date || date < today) ? (
              <span className="field-error">{t('price.badDate')}</span>
            ) : null}
          </label>
          <label className="field">
            <span>{t('closed.cols.time')}</span>
            <select value={windowId} onChange={(e) => setWindowId(e.target.value)}>
              <option value="">{t('closed.wholeDay')}</option>
              {windows.data?.map((w) => (
                <option key={w.id} value={w.id}>
                  {windowText(w, lang)}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>{t('closed.cols.reason')}</span>
            <input
              value={reason}
              maxLength={300}
              onChange={(e) => setReason(e.target.value)}
              aria-invalid={tried && reason.trim().length < 3}
              aria-describedby="closed-reason-hint"
            />
            {tried && reason.trim().length < 3 ? (
              <span className="field-error">{t('order.reasonNeeded')}</span>
            ) : (
              <span id="closed-reason-hint" className="field-hint">
                {t('closed.reasonHint')}
              </span>
            )}
          </label>
          {error ? (
            <p className="field-error" role="alert">
              {error}
            </p>
          ) : null}
          <div className="form-actions">
            <button type="submit" className="btn btn-primary">
              {t('closed.save')}
            </button>
            <button type="button" className="btn btn-secondary" onClick={close}>
              {t('common.cancel')}
            </button>
          </div>
        </form>
      </Dialog>
    </>
  );
}
