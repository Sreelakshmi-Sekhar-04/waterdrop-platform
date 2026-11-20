import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { depositRefund, formatINR, istDate, type RefundMethod } from '@wtrdrop/shared';
import { call } from '../lib/api';
import { errorText } from '../lib/errors';
import { Dialog } from './Dialog';

/** "380", "1,240.50" → paise; anything else → null. */
export function parseRupees(text: string): number | null {
  const s = text.replace(/[₹,\s]/g, '');
  if (!/^\d{1,6}(\.\d{1,2})?$/.test(s)) return null;
  const p = Math.round(Number(s) * 100);
  return p > 0 && p <= 10_000_000 ? p : null;
}

/** Like parseRupees, but 0 and a leading minus (paid in advance) are allowed. */
function parseSignedRupees(text: string): number | null {
  const s = text.replace(/[₹,\s]/g, '');
  if (!/^-?\d{1,6}(\.\d{1,2})?$/.test(s)) return null;
  return Math.round(Number(s) * 100);
}

const rupeesText = (paise: number) => String(paise / 100);

export interface Balances {
  cansHeld: number;
  depositHeldPaise: number;
  depositCoverCans: number;
  balancePaise: number;
  creditLimitPaise: number;
}

/** A small form inside a dialog: Save and Cancel, the error, and a reset when it closes. */
function FormDialog({
  open,
  title,
  onClose,
  onSave,
  saveLabel,
  error,
  children,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  onSave: () => void;
  saveLabel: string;
  error: string | null;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  return (
    <Dialog open={open} title={title} onClose={onClose}>
      <form
        className="form"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          onSave();
        }}
      >
        {children}
        {error ? (
          <p className="field-error" role="alert">
            {error}
          </p>
        ) : null}
        <div className="form-actions">
          <button type="submit" className="btn btn-primary">
            {saveLabel}
          </button>
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            {t('common.cancel')}
          </button>
        </div>
      </form>
    </Dialog>
  );
}

function useSaving() {
  const { t } = useTranslation();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const run = async (fn: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(errorText(t, e));
    } finally {
      setBusy(false);
    }
  };
  return { error, setError, run };
}

/** The office takes a payment (at the depot, or UPI straight to the business). */
export function RecordPaymentDialog({
  open,
  customerId,
  customerName,
  duePaise,
  onClose,
  onSaved,
}: {
  open: boolean;
  customerId: string;
  customerName: string;
  duePaise: number;
  onClose: () => void;
  onSaved: (text: string) => void;
}) {
  const { t } = useTranslation();
  const today = istDate(new Date());
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState<'cash' | 'upi'>('cash');
  const [reference, setReference] = useState('');
  const [paidOn, setPaidOn] = useState(today);
  const [tried, setTried] = useState(false);
  // One id per payment being typed: Save pressed twice (or a retry) records it once.
  const [requestId, setRequestId] = useState(() => crypto.randomUUID());
  const { error, setError, run } = useSaving();
  const paise = parseRupees(amount);
  const close = () => {
    setAmount('');
    setMethod('cash');
    setReference('');
    setPaidOn(today);
    setTried(false);
    setError(null);
    setRequestId(crypto.randomUUID());
    onClose();
  };
  const save = () =>
    run(async () => {
      setTried(true);
      if (paise === null || !paidOn || paidOn > today) return;
      await call(`/admin/customers/${customerId}/payments`, {
        method: 'POST',
        body: {
          clientRequestId: requestId,
          method,
          amountPaise: paise,
          paidOn,
          reference: reference.trim() || undefined,
        },
      });
      onSaved(t('money.paymentSaved', { amount: formatINR(paise), name: customerName }));
      close();
    });
  return (
    <FormDialog
      open={open}
      title={t('money.recordPayment')}
      onClose={close}
      onSave={() => void save()}
      saveLabel={paise ? t('money.savePayment', { amount: formatINR(paise) }) : t('common.save')}
      error={error}
    >
      <p className="muted">
        {customerName} ·{' '}
        {duePaise > 0 ? t('money.dueNow', { amount: formatINR(duePaise) }) : t('money.nothingDue')}
      </p>
      <label className="field">
        <span>{t('money.amount')}</span>
        <input
          inputMode="decimal"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          aria-invalid={tried && paise === null}
          autoFocus
        />
        {duePaise > 0 ? (
          <button
            type="button"
            className="btn btn-link"
            onClick={() => setAmount(rupeesText(duePaise))}
          >
            {t('money.fullDue', { amount: formatINR(duePaise) })}
          </button>
        ) : null}
        {tried && paise === null ? (
          <span className="field-error">{t('money.badAmount')}</span>
        ) : null}
      </label>
      <fieldset className="fieldset">
        <legend>{t('money.method')}</legend>
        {(['cash', 'upi'] as const).map((m) => (
          <label key={m} className="inline-field">
            <input
              type="radio"
              name="pay-method"
              checked={method === m}
              onChange={() => setMethod(m)}
            />
            {t(`deliveries.method.${m}`)}
          </label>
        ))}
      </fieldset>
      {method === 'upi' ? (
        <label className="field">
          <span>{t('money.reference')}</span>
          <input value={reference} maxLength={40} onChange={(e) => setReference(e.target.value)} />
        </label>
      ) : null}
      <label className="field">
        <span>{t('money.paidOn')}</span>
        <input
          type="date"
          max={today}
          value={paidOn}
          onChange={(e) => setPaidOn(e.target.value)}
          aria-invalid={tried && (!paidOn || paidOn > today)}
        />
      </label>
      {method === 'upi' ? <p className="field-hint">{t('money.upiCheckHint')}</p> : null}
    </FormDialog>
  );
}

/** D-04, M-05: deposit back for cans that came back; it can pay off dues instead. */
export function RefundDialog({
  open,
  customerId,
  balances,
  onClose,
  onSaved,
}: {
  open: boolean;
  customerId: string;
  balances: Balances;
  onClose: () => void;
  onSaved: (text: string) => void;
}) {
  const { t } = useTranslation();
  const r0 = depositRefund({ ...balances, cans: 1 });
  const [cans, setCans] = useState('');
  const [method, setMethod] = useState<RefundMethod>(balances.balancePaise > 0 ? 'adjust' : 'cash');
  const [reason, setReason] = useState('');
  const [requestId, setRequestId] = useState(() => crypto.randomUUID());
  const { error, setError, run } = useSaving();
  const n = /^\d+$/.test(cans) ? Number(cans) : r0.refundableCans;
  const r = depositRefund({ ...balances, cans: n });
  const close = () => {
    setCans('');
    setReason('');
    setError(null);
    setRequestId(crypto.randomUUID());
    onClose();
  };
  const save = () =>
    run(async () => {
      if (r.amountPaise === 0) return;
      await call(`/admin/customers/${customerId}/deposit-refund`, {
        method: 'POST',
        body: { clientRequestId: requestId, cans: n, method, reason: reason.trim() || undefined },
      });
      onSaved(
        t(method === 'adjust' ? 'money.refundAdjusted' : 'money.refundPaid', {
          amount: formatINR(r.amountPaise),
          count: n,
        }),
      );
      close();
    });
  return (
    <FormDialog
      open={open}
      title={t('money.refundDeposit')}
      onClose={close}
      onSave={() => void save()}
      saveLabel={
        r.amountPaise
          ? t('money.refundSave', { amount: formatINR(r.amountPaise) })
          : t('common.save')
      }
      error={error}
    >
      <p className="muted">
        {t('money.refundHelp', {
          deposit: formatINR(balances.depositHeldPaise),
          cover: balances.depositCoverCans,
          held: balances.cansHeld,
          count: r0.refundableCans,
        })}
      </p>
      {r0.refundableCans === 0 ? (
        <p className="field-error" role="alert">
          {t('errors.NOTHING_TO_REFUND')}
        </p>
      ) : (
        <>
          <label className="field">
            <span>{t('money.refundCans')}</span>
            <input
              inputMode="numeric"
              value={cans}
              placeholder={String(r0.refundableCans)}
              onChange={(e) => setCans(e.target.value.replace(/\D/g, '').slice(0, 4))}
              aria-invalid={r.amountPaise === 0}
            />
            {r.amountPaise === 0 ? (
              <span className="field-error">
                {t('money.refundMax', { count: r0.refundableCans })}
              </span>
            ) : (
              <span className="field-hint">
                {t('money.refundAmount', { amount: formatINR(r.amountPaise) })}
              </span>
            )}
          </label>
          <fieldset className="fieldset">
            <legend>{t('money.refundHow')}</legend>
            {(['adjust', 'cash', 'upi'] as const).map((m) => (
              <label key={m} className="inline-field">
                <input
                  type="radio"
                  name="refund-method"
                  checked={method === m}
                  onChange={() => setMethod(m)}
                />
                {t(`money.refundMethod.${m}`)}
              </label>
            ))}
          </fieldset>
          <label className="field">
            <span>{t('money.noteOptional')}</span>
            <input value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} />
          </label>
        </>
      )}
    </FormDialog>
  );
}

/** Set the balances to what is true; each difference is saved as a correction with the reason. */
export function CorrectionDialog({
  open,
  customerId,
  balances,
  onClose,
  onSaved,
}: {
  open: boolean;
  customerId: string;
  balances: Balances;
  onClose: () => void;
  onSaved: (text: string) => void;
}) {
  const { t } = useTranslation();
  const start = () => ({
    cansHeld: String(balances.cansHeld),
    depositHeld: rupeesText(balances.depositHeldPaise),
    depositCover: String(balances.depositCoverCans),
    balance: rupeesText(balances.balancePaise),
  });
  const [f, setF] = useState<ReturnType<typeof start> | null>(null);
  const v = f ?? start();
  const [reason, setReason] = useState('');
  const [tried, setTried] = useState(false);
  const { error, setError, run } = useSaving();
  const whole = (s: string) => (/^\d{1,4}$/.test(s) ? Number(s) : null);
  const next = {
    cansHeld: whole(v.cansHeld),
    depositHeldPaise: v.depositHeld.trim() === '0' ? 0 : parseRupees(v.depositHeld),
    depositCoverCans: whole(v.depositCover),
    balancePaise: parseSignedRupees(v.balance),
  };
  const bad = (k: keyof typeof next) => tried && next[k] === null;
  const close = () => {
    setF(null);
    setReason('');
    setTried(false);
    setError(null);
    onClose();
  };
  const save = () =>
    run(async () => {
      setTried(true);
      if (Object.values(next).some((x) => x === null) || reason.trim().length < 3) return;
      const changed = Object.fromEntries(
        Object.entries(next).filter(([k, x]) => x !== balances[k as keyof Balances]),
      );
      if (Object.keys(changed).length === 0) {
        setError(t('errors.NOTHING_CHANGED'));
        return;
      }
      await call(`/admin/customers/${customerId}/corrections`, {
        method: 'POST',
        body: { ...changed, reason: reason.trim() },
      });
      onSaved(t('money.corrected'));
      close();
    });
  const field = (k: keyof typeof v, label: string, hint?: string, key?: keyof typeof next) => (
    <label className="field">
      <span>{label}</span>
      <input
        inputMode="decimal"
        value={v[k]}
        onChange={(e) => setF({ ...v, [k]: e.target.value })}
        aria-invalid={key ? bad(key) : false}
      />
      {hint ? <span className="field-hint">{hint}</span> : null}
    </label>
  );
  return (
    <FormDialog
      open={open}
      title={t('money.correct')}
      onClose={close}
      onSave={() => void save()}
      saveLabel={t('money.correctSave')}
      error={error}
    >
      <p className="muted">{t('money.correctHelp')}</p>
      {field('cansHeld', t('ledger.cansHeld'), undefined, 'cansHeld')}
      {field('depositHeld', t('money.depositRupees'), undefined, 'depositHeldPaise')}
      {field('depositCover', t('money.depositCans'), undefined, 'depositCoverCans')}
      {field('balance', t('money.balanceRupees'), t('money.balanceHint'), 'balancePaise')}
      {tried && Object.values(next).some((x) => x === null) ? (
        <p className="field-error">{t('money.badNumbers')}</p>
      ) : null}
      <label className="field">
        <span>{t('money.reasonNeeded')}</span>
        <input
          value={reason}
          maxLength={300}
          onChange={(e) => setReason(e.target.value)}
          aria-invalid={tried && reason.trim().length < 3}
        />
        {tried && reason.trim().length < 3 ? (
          <span className="field-error">{t('errors.REASON_REQUIRED')}</span>
        ) : null}
      </label>
    </FormDialog>
  );
}

/** D-03: how much this customer may owe before the office is warned. Owner only. */
export function CreditLimitDialog({
  open,
  customerId,
  current,
  onClose,
  onSaved,
}: {
  open: boolean;
  customerId: string;
  current: number;
  onClose: () => void;
  onSaved: (text: string) => void;
}) {
  const { t } = useTranslation();
  const [text, setText] = useState<string | null>(null);
  const value = text ?? rupeesText(current);
  const paise = value.trim() === '0' ? 0 : parseRupees(value);
  const { error, setError, run } = useSaving();
  const close = () => {
    setText(null);
    setError(null);
    onClose();
  };
  const save = () =>
    run(async () => {
      if (paise === null) return;
      await call(`/admin/customers/${customerId}/credit-limit`, {
        method: 'PUT',
        body: { creditLimitPaise: paise },
      });
      onSaved(t('money.limitSaved', { amount: formatINR(paise) }));
      close();
    });
  return (
    <FormDialog
      open={open}
      title={t('money.creditLimit')}
      onClose={close}
      onSave={() => void save()}
      saveLabel={t('common.save')}
      error={error}
    >
      <p className="muted">{t('money.limitHelp')}</p>
      <label className="field">
        <span>{t('money.limitRupees')}</span>
        <input
          inputMode="decimal"
          value={value}
          onChange={(e) => setText(e.target.value)}
          aria-invalid={paise === null}
          autoFocus
        />
        {paise === null ? <span className="field-error">{t('money.badAmount')}</span> : null}
      </label>
    </FormDialog>
  );
}

/** "Not received": the payment stays in the list, marked, and the customer owes it again. */
export function ReversePaymentDialog({
  payment,
  onClose,
  onSaved,
}: {
  payment: { id: string; amountPaise: number; customerName: string | null } | null;
  onClose: () => void;
  onSaved: (text: string) => void;
}) {
  const { t } = useTranslation();
  const [reason, setReason] = useState('');
  const [tried, setTried] = useState(false);
  const { error, setError, run } = useSaving();
  const close = () => {
    setReason('');
    setTried(false);
    setError(null);
    onClose();
  };
  const save = () =>
    run(async () => {
      setTried(true);
      if (!payment || reason.trim().length < 3) return;
      await call(`/admin/payments/${payment.id}/reverse`, {
        method: 'POST',
        body: { reason: reason.trim() },
      });
      onSaved(
        t('money.reversed', {
          amount: formatINR(payment.amountPaise),
          name: payment.customerName ?? '',
        }),
      );
      close();
    });
  return (
    <FormDialog
      open={!!payment}
      title={t('money.notReceived')}
      onClose={close}
      onSave={() => void save()}
      saveLabel={t('money.notReceivedSave')}
      error={error}
    >
      {payment ? (
        <p className="muted">
          {t('money.notReceivedHelp', {
            amount: formatINR(payment.amountPaise),
            name: payment.customerName ?? '',
          })}
        </p>
      ) : null}
      <label className="field">
        <span>{t('money.reasonNeeded')}</span>
        <input
          value={reason}
          maxLength={300}
          onChange={(e) => setReason(e.target.value)}
          aria-invalid={tried && reason.trim().length < 3}
          autoFocus
        />
        {tried && reason.trim().length < 3 ? (
          <span className="field-error">{t('errors.REASON_REQUIRED')}</span>
        ) : null}
      </label>
    </FormDialog>
  );
}
