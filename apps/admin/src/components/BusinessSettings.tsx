import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { businessInputSchema } from '@wtrdrop/shared';
import { call } from '../lib/api';
import { errorText } from '../lib/errors';
import { isOwner, useAuth } from '../lib/auth';
import { LiveMessage } from './ui';
import { rupeesToPaise } from './OrderingSettings';

interface Business {
  name: string;
  gstin: string | null;
  fssaiNo: string | null;
}
interface Rules {
  deliveryChargePaise?: number;
  freeDeliveryAboveCans?: number;
  depositPerCanPaise?: number;
  sameDayCutoff?: string;
  maxCansPerOrder?: number;
  staffUndoWindowMinutes?: number;
  autoAcceptOrders?: boolean;
  supportPhone?: string | null;
}

const paiseText = (p: number | undefined) => (p === undefined ? '' : String(p / 100));
const numText = (n: number | undefined) => (n === undefined ? '' : String(n));

/** Name, GSTIN and FSSAI licence: printed on statements. Only the owner changes them. */
export function BusinessDetails() {
  const { t } = useTranslation();
  const { me } = useAuth();
  const owner = isOwner(me);
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ['business'],
    queryFn: async () => (await call<{ business: Business }>('/admin/business')).business,
  });
  const [draft, setDraft] = useState<Record<'name' | 'gstin' | 'fssaiNo', string> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  if (q.isError)
    return (
      <p className="field-error" role="alert">
        {errorText(t, q.error)}
      </p>
    );
  if (!q.data) return <div className="card empty">{t('common.loading')}</div>;
  const b = q.data;
  const f = draft ?? { name: b.name, gstin: b.gstin ?? '', fssaiNo: b.fssaiNo ?? '' };
  const set = (k: keyof typeof f, v: string) => setDraft({ ...f, [k]: v });
  const save = async () => {
    setError(null);
    setMessage(null);
    const body = {
      name: f.name.trim(),
      gstin: f.gstin.trim() ? f.gstin.trim().toUpperCase() : null,
      fssaiNo: f.fssaiNo.trim() || null,
    };
    const ok = businessInputSchema.safeParse(body);
    if (!ok.success) {
      const field = ok.error.issues[0]?.path[0];
      setError(t(`business.bad.${String(field ?? 'name')}`));
      return;
    }
    try {
      const r = await call<{ business: Business }>('/admin/business', {
        method: 'PATCH',
        body,
      });
      qc.setQueryData(['business'], r.business);
      setDraft(null);
      setMessage(t('business.saved'));
    } catch (e) {
      setError(errorText(t, e));
    }
  };
  return (
    <form
      className="form card narrow"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      {!owner ? <p className="muted">{t('business.ownerOnly')}</p> : null}
      <fieldset className="fieldset-plain" disabled={!owner}>
        <label className="field">
          <span>{t('business.name')}</span>
          <input value={f.name} maxLength={80} onChange={(e) => set('name', e.target.value)} />
        </label>
        <label className="field">
          <span>{t('business.gstin')}</span>
          <input
            value={f.gstin}
            maxLength={15}
            autoCapitalize="characters"
            onChange={(e) => set('gstin', e.target.value)}
            aria-describedby="gstin-hint"
          />
          <span id="gstin-hint" className="field-hint">
            {t('business.gstinHint')}
          </span>
        </label>
        <label className="field">
          <span>{t('business.fssai')}</span>
          <input
            value={f.fssaiNo}
            inputMode="numeric"
            maxLength={14}
            onChange={(e) => set('fssaiNo', e.target.value)}
          />
        </label>
      </fieldset>
      {error ? (
        <p className="field-error" role="alert">
          {error}
        </p>
      ) : null}
      <LiveMessage text={message} tone="success" />
      {owner ? (
        <div className="form-actions">
          <button type="submit" className="btn btn-primary" disabled={draft === null}>
            {t('business.save')}
          </button>
        </div>
      ) : null}
    </form>
  );
}

type RuleField =
  'deposit' | 'charge' | 'freeAbove' | 'cutoff' | 'maxCans' | 'undoMinutes' | 'supportPhone';

/**
 * The business rules (Phase 0 Part 4). The values installed at setup are demo values: the owner
 * replaces them with real ones before launch. Office admins can see them but not change them.
 */
export function BusinessRules() {
  const { t } = useTranslation();
  const { me } = useAuth();
  const owner = isOwner(me);
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ['settings'],
    queryFn: async () => (await call<{ settings: Rules }>('/admin/settings')).settings,
  });
  const [draft, setDraft] = useState<(Record<RuleField, string> & { auto: boolean }) | null>(null);
  const [bad, setBad] = useState<RuleField[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  if (q.isError)
    return (
      <p className="field-error" role="alert">
        {errorText(t, q.error)}
      </p>
    );
  if (!q.data) return <div className="card empty">{t('common.loading')}</div>;
  const s = q.data;
  const f = draft ?? {
    deposit: paiseText(s.depositPerCanPaise),
    charge: paiseText(s.deliveryChargePaise),
    freeAbove: numText(s.freeDeliveryAboveCans),
    cutoff: s.sameDayCutoff ?? '',
    maxCans: numText(s.maxCansPerOrder),
    undoMinutes: numText(s.staffUndoWindowMinutes),
    supportPhone: s.supportPhone ? s.supportPhone.slice(3) : '',
    auto: s.autoAcceptOrders ?? true,
  };
  const set = (k: RuleField, v: string) => setDraft({ ...f, [k]: v });
  const whole = (v: string, min: number, max: number) =>
    /^\d{1,3}$/.test(v.trim()) && Number(v) >= min && Number(v) <= max ? Number(v) : null;

  const save = async () => {
    setError(null);
    setMessage(null);
    const deposit = f.deposit.trim() === '0' ? 0 : rupeesToPaise(f.deposit);
    const charge = f.charge.trim() === '0' ? 0 : rupeesToPaise(f.charge);
    const freeAbove = whole(f.freeAbove, 0, 100);
    const maxCans = whole(f.maxCans, 1, 100);
    const undo = whole(f.undoMinutes, 0, 60);
    const cutoffOk = /^([01]\d|2[0-3]):[0-5]\d$/.test(f.cutoff);
    const phone = f.supportPhone.replace(/\D/g, '').replace(/^91(?=\d{10}$)/, '');
    const phoneOk = phone === '' || /^[6-9]\d{9}$/.test(phone);
    const wrong: RuleField[] = [];
    if (deposit === null) wrong.push('deposit');
    if (charge === null) wrong.push('charge');
    if (freeAbove === null) wrong.push('freeAbove');
    if (!cutoffOk) wrong.push('cutoff');
    if (maxCans === null) wrong.push('maxCans');
    if (undo === null) wrong.push('undoMinutes');
    if (!phoneOk) wrong.push('supportPhone');
    setBad(wrong);
    if (wrong.length) return;
    const next: Rules = {
      depositPerCanPaise: deposit!,
      deliveryChargePaise: charge!,
      freeDeliveryAboveCans: freeAbove!,
      sameDayCutoff: f.cutoff,
      maxCansPerOrder: maxCans!,
      staffUndoWindowMinutes: undo!,
      autoAcceptOrders: f.auto,
      supportPhone: phone ? `+91${phone}` : null,
    };
    // Only what changed is sent, so the activity log shows exactly what the owner changed.
    const patch = Object.fromEntries(
      Object.entries(next).filter(
        ([k, v]) => s[k as keyof Rules] !== v && !(v === null && s[k as keyof Rules] === undefined),
      ),
    );
    if (Object.keys(patch).length === 0) {
      setDraft(null);
      return;
    }
    try {
      const r = await call<{ settings: Rules }>('/admin/settings', {
        method: 'PATCH',
        body: patch,
      });
      qc.setQueryData(['settings'], r.settings);
      setDraft(null);
      setMessage(t('business.rulesSaved'));
    } catch (e) {
      setError(errorText(t, e));
    }
  };

  const field = (
    k: RuleField,
    props: { inputMode?: 'numeric' | 'decimal' | 'tel'; type?: string; prefix?: string },
  ) => (
    <label className="field">
      <span>{t(`business.rules.${k}`)}</span>
      <span className={props.prefix ? 'input-prefix' : undefined}>
        {props.prefix ? <span aria-hidden="true">{props.prefix}</span> : null}
        <input
          type={props.type ?? 'text'}
          inputMode={props.inputMode}
          value={f[k]}
          onChange={(e) => set(k, e.target.value)}
          aria-invalid={bad.includes(k)}
          aria-describedby={`rule-${k}-hint`}
        />
      </span>
      <span id={`rule-${k}-hint`} className={bad.includes(k) ? 'field-error' : 'field-hint'}>
        {t(`business.hints.${k}`)}
      </span>
    </label>
  );

  return (
    <form
      className="form card narrow"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
      data-testid="business-rules"
    >
      <p className="muted">{owner ? t('business.rulesHelp') : t('business.ownerOnly')}</p>
      <fieldset className="fieldset-plain" disabled={!owner}>
        {field('deposit', { inputMode: 'decimal' })}
        {field('charge', { inputMode: 'decimal' })}
        {field('freeAbove', { inputMode: 'numeric' })}
        {field('cutoff', { type: 'time' })}
        {field('maxCans', { inputMode: 'numeric' })}
        {field('undoMinutes', { inputMode: 'numeric' })}
        {field('supportPhone', { inputMode: 'tel', prefix: '+91' })}
        <label className="inline-field">
          <input
            type="checkbox"
            checked={f.auto}
            onChange={(e) => setDraft({ ...f, auto: e.target.checked })}
          />
          {t('business.rules.auto')}
        </label>
        <p className="field-hint">{t('business.hints.auto')}</p>
      </fieldset>
      {error ? (
        <p className="field-error" role="alert">
          {error}
        </p>
      ) : null}
      <LiveMessage text={message} tone="success" />
      {owner ? (
        <div className="form-actions">
          <button type="submit" className="btn btn-primary" disabled={draft === null}>
            {t('business.saveRules')}
          </button>
        </div>
      ) : null}
    </form>
  );
}
