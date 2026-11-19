import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { formatINR, pincodeSchema, serviceAreaInputSchema } from '@wtrdrop/shared';
import { call } from '../lib/api';
import { errorText } from '../lib/errors';
import { isOwner, useAuth } from '../lib/auth';
import { Dialog } from '../components/Dialog';
import { Chip, LiveMessage, PageHeader, TableWrap } from '../components/ui';
import { TeamTable } from '../components/TeamTable';
import {
  ClosedDaySettings,
  PriceSettings,
  WindowSettings,
  rupeesToPaise,
} from '../components/OrderingSettings';

interface Area {
  id: string;
  name: string;
  nameMl: string | null;
  pincodes: string[];
  status: 'active' | 'disabled';
  deliveryChargePaise: number | null;
  freeAboveCans: number | null;
}

export function SettingsPage() {
  const { t } = useTranslation();
  const { me } = useAuth();
  return (
    <div className="page">
      <PageHeader title={t('nav.settings')} />
      <section aria-labelledby="price-h">
        <h2 id="price-h">{t('settings.price')}</h2>
        <PriceSettings />
      </section>
      <section aria-labelledby="windows-h">
        <h2 id="windows-h">{t('settings.windows')}</h2>
        <p className="muted">{t('settings.windowsHelp')}</p>
        <WindowSettings />
      </section>
      <section aria-labelledby="closed-h">
        <h2 id="closed-h">{t('settings.closedDays')}</h2>
        <p className="muted">{t('settings.closedDaysHelp')}</p>
        <ClosedDaySettings />
      </section>
      <section aria-labelledby="areas-h">
        <h2 id="areas-h">{t('settings.areas')}</h2>
        <p className="muted">{t('settings.areasHelp')}</p>
        <ServiceAreas />
      </section>
      {isOwner(me) ? (
        <section aria-labelledby="team-h">
          <h2 id="team-h">{t('settings.team')}</h2>
          <p className="muted">{t('settings.teamHelp')}</p>
          <TeamTable kind="team" />
        </section>
      ) : null}
      <section aria-labelledby="pw-h">
        <h2 id="pw-h">{t('settings.password')}</h2>
        <ChangePassword />
      </section>
    </div>
  );
}

function ServiceAreas() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ['areas'],
    queryFn: async () => (await call<{ areas: Area[] }>('/admin/service-areas')).areas,
  });
  const [editing, setEditing] = useState<Area | 'new' | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  return (
    <>
      <div className="section-head">
        <span />
        <button
          type="button"
          className="btn btn-primary btn-compact"
          onClick={() => setEditing('new')}
        >
          {t('settings.addArea')}
        </button>
      </div>
      <LiveMessage text={message} tone="success" />
      {q.isError ? (
        <div className="card empty" role="alert">
          {errorText(t, q.error)}
        </div>
      ) : null}
      {q.data?.length === 0 ? <div className="card empty">{t('settings.noAreas')}</div> : null}
      {q.data && q.data.length > 0 ? (
        <TableWrap label={t('settings.areas')}>
          <table>
            <thead>
              <tr>
                <th scope="col">{t('settings.areaName')}</th>
                <th scope="col">{t('settings.pincodes')}</th>
                <th scope="col">{t('settings.deliveryCharge')}</th>
                <th scope="col">{t('team.cols.status')}</th>
                <th scope="col">{t('team.cols.actions')}</th>
              </tr>
            </thead>
            <tbody>
              {q.data.map((a) => (
                <tr key={a.id}>
                  <th scope="row">
                    {a.name}
                    {a.nameMl ? (
                      <span className="cell-note" lang="ml">
                        {a.nameMl}
                      </span>
                    ) : null}
                  </th>
                  <td className="wrap">{a.pincodes.join(', ')}</td>
                  <td className="wrap">
                    {a.deliveryChargePaise === null && a.freeAboveCans === null
                      ? t('settings.chargeDefault')
                      : a.deliveryChargePaise
                        ? a.freeAboveCans
                          ? t('settings.chargeFreeAbove', {
                              amount: formatINR(a.deliveryChargePaise),
                              count: a.freeAboveCans,
                            })
                          : formatINR(a.deliveryChargePaise)
                        : t('settings.chargeFree')}
                  </td>
                  <td>
                    {a.status === 'active' ? (
                      <Chip tone="success">{t('common.active')}</Chip>
                    ) : (
                      <Chip tone="neutral">{t('common.switchedOff')}</Chip>
                    )}
                  </td>
                  <td>
                    <button
                      type="button"
                      className="btn btn-link"
                      onClick={() => setEditing(a)}
                      aria-label={t('settings.editArea', { name: a.name })}
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
      <AreaDialog
        area={editing}
        onClose={() => setEditing(null)}
        onSaved={(name) => {
          setMessage(t('settings.areaSaved', { name }));
          void qc.invalidateQueries({ queryKey: ['areas'] });
        }}
      />
    </>
  );
}

function AreaDialog({
  area,
  onClose,
  onSaved,
}: {
  area: Area | 'new' | null;
  onClose: () => void;
  onSaved: (name: string) => void;
}) {
  const { t } = useTranslation();
  const existing = area && area !== 'new' ? area : null;
  const [name, setName] = useState<string | null>(null);
  const [nameMl, setNameMl] = useState<string | null>(null);
  const [pins, setPins] = useState<string | null>(null);
  const [active, setActive] = useState<boolean | null>(null);
  const [charge, setCharge] = useState<string | null>(null);
  const [freeAbove, setFreeAbove] = useState<string | null>(null);
  const [tried, setTried] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const v = {
    name: name ?? existing?.name ?? '',
    nameMl: nameMl ?? existing?.nameMl ?? '',
    pins: pins ?? existing?.pincodes.join(', ') ?? '',
    active: active ?? (existing ? existing.status === 'active' : true),
    charge:
      charge ??
      (existing?.deliveryChargePaise != null ? String(existing.deliveryChargePaise / 100) : ''),
    freeAbove: freeAbove ?? (existing?.freeAboveCans != null ? String(existing.freeAboveCans) : ''),
  };
  // Blank means "use the business-wide setting"; 0 means free in this area.
  const chargePaise = v.charge.trim() ? rupeesToPaise(v.charge) : null;
  const badCharge = !!v.charge.trim() && chargePaise === null;
  const freeAboveCans = /^\d{1,3}$/.test(v.freeAbove.trim()) ? Number(v.freeAbove) : null;
  const badFreeAbove = !!v.freeAbove.trim() && freeAboveCans === null;
  const pincodes = v.pins.split(/[\s,]+/).filter(Boolean);
  const badPins = pincodes.filter((p) => !pincodeSchema.safeParse(p).success);
  const input = {
    name: v.name,
    nameMl: v.nameMl || null,
    pincodes,
    status: v.active ? ('active' as const) : ('disabled' as const),
    deliveryChargePaise: chargePaise,
    freeAboveCans,
  };
  const check = serviceAreaInputSchema.safeParse(input);
  const close = () => {
    setName(null);
    setNameMl(null);
    setPins(null);
    setActive(null);
    setCharge(null);
    setFreeAbove(null);
    setTried(false);
    setError(null);
    onClose();
  };
  const save = async () => {
    setTried(true);
    if (!check.success || badPins.length || badCharge || badFreeAbove) return;
    try {
      if (existing)
        await call(`/admin/service-areas/${existing.id}`, { method: 'PATCH', body: input });
      else await call('/admin/service-areas', { method: 'POST', body: input });
      onSaved(input.name);
      close();
    } catch (e) {
      setError(errorText(t, e));
    }
  };
  return (
    <Dialog
      open={!!area}
      title={existing ? t('settings.editArea', { name: existing.name }) : t('settings.addArea')}
      onClose={close}
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
          <span>{t('settings.areaName')}</span>
          <input
            value={v.name}
            onChange={(e) => setName(e.target.value)}
            aria-invalid={tried && !v.name.trim()}
            autoFocus
          />
        </label>
        <label className="field">
          <span>{t('settings.areaNameMl')}</span>
          <input lang="ml" value={v.nameMl} onChange={(e) => setNameMl(e.target.value)} />
        </label>
        <label className="field">
          <span>{t('settings.pincodes')}</span>
          <textarea
            rows={2}
            value={v.pins}
            onChange={(e) => setPins(e.target.value)}
            aria-invalid={tried && (badPins.length > 0 || pincodes.length === 0)}
            aria-describedby="pins-hint"
          />
          {tried && badPins.length ? (
            <span className="field-error">
              {t('settings.badPins', { pins: badPins.join(', ') })}
            </span>
          ) : tried && pincodes.length === 0 ? (
            <span className="field-error">{t('settings.needPin')}</span>
          ) : (
            <span id="pins-hint" className="field-hint">
              {t('settings.pincodesHint')}
            </span>
          )}
        </label>
        <div className="field-row">
          <label className="field">
            <span>{t('settings.chargeLabel')}</span>
            <input
              inputMode="decimal"
              value={v.charge}
              onChange={(e) => setCharge(e.target.value)}
              aria-invalid={tried && badCharge}
              aria-describedby="charge-hint"
            />
          </label>
          <label className="field">
            <span>{t('settings.freeAboveLabel')}</span>
            <input
              inputMode="numeric"
              value={v.freeAbove}
              onChange={(e) => setFreeAbove(e.target.value)}
              aria-invalid={tried && badFreeAbove}
              aria-describedby="charge-hint"
            />
          </label>
        </div>
        {tried && (badCharge || badFreeAbove) ? (
          <span className="field-error">{t('settings.badCharge')}</span>
        ) : (
          <span id="charge-hint" className="field-hint">
            {t('settings.chargeHint')}
          </span>
        )}
        {existing ? (
          <label className="check">
            <input
              type="checkbox"
              checked={v.active}
              onChange={(e) => setActive(e.target.checked)}
            />
            {t('settings.areaActive')}
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
          <button type="button" className="btn btn-secondary" onClick={close}>
            {t('common.cancel')}
          </button>
        </div>
      </form>
    </Dialog>
  );
}

function ChangePassword() {
  const { t } = useTranslation();
  const [cur, setCur] = useState('');
  const [next, setNext] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const save = async () => {
    setError(null);
    try {
      await call('/auth/admin/password/change', {
        method: 'POST',
        body: { currentPassword: cur, newPassword: next },
      });
      setCur('');
      setNext('');
      setMessage(t('settings.passwordChanged'));
    } catch (e) {
      setError(errorText(t, e));
    }
  };
  return (
    <form
      className="form card narrow"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <label className="field">
        <span>{t('settings.currentPassword')}</span>
        <input
          type="password"
          autoComplete="current-password"
          value={cur}
          onChange={(e) => setCur(e.target.value)}
        />
      </label>
      <label className="field">
        <span>{t('signIn.newPassword')}</span>
        <input
          type="password"
          autoComplete="new-password"
          value={next}
          onChange={(e) => setNext(e.target.value)}
          aria-describedby="cp-hint"
        />
        <span id="cp-hint" className="field-hint">
          {t('signIn.newPasswordHint')}
        </span>
      </label>
      {error ? (
        <p className="field-error" role="alert">
          {error}
        </p>
      ) : null}
      <LiveMessage text={message} tone="success" />
      <div className="form-actions">
        <button type="submit" className="btn btn-primary" disabled={!cur || next.length < 10}>
          {t('settings.changePassword')}
        </button>
      </div>
    </form>
  );
}
