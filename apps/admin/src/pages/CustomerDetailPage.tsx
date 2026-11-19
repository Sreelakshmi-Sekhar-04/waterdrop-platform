import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { addressInputSchema, type CustomerType } from '@wtrdrop/shared';
import { call } from '../lib/api';
import { errorText } from '../lib/errors';
import { Dialog } from '../components/Dialog';
import { Chip, LiveMessage, PageHeader } from '../components/ui';
import { CustomerOrders, CustomerPrice } from '../components/CustomerOrders';

interface Address {
  id: string;
  label: string;
  line: string;
  landmark: string;
  pincode: string;
  latitude: number | null;
  longitude: number | null;
  deliveryNote: string | null;
  isDefault: boolean;
  areaName: string;
}
interface Customer {
  id: string;
  name: string | null;
  phone: string;
  preferredLanguage: 'en' | 'ml';
  type: CustomerType;
  status: 'active' | 'disabled';
  privacyAcceptedAt: string | null;
  createdAt: string;
  addresses: Address[];
}

export function CustomerDetailPage() {
  const { t } = useTranslation();
  const { id = '' } = useParams();
  const qc = useQueryClient();
  const key = ['customer', id];
  const q = useQuery({
    queryKey: key,
    queryFn: async () => (await call<{ customer: Customer }>(`/admin/customers/${id}`)).customer,
  });
  const [adding, setAdding] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (q.isPending)
    return (
      <div className="page">
        <div className="card empty">{t('common.loading')}</div>
      </div>
    );
  if (q.isError) {
    return (
      <div className="page">
        <PageHeader title={t('customer.notFound')} />
        <p role="alert">{errorText(t, q.error)}</p>
        <Link to="/customers">{t('customer.back')}</Link>
      </div>
    );
  }
  const c = q.data;
  const toggleStatus = async () => {
    setError(null);
    try {
      const next = c.status === 'active' ? 'disabled' : 'active';
      const r = await call<{ customer: Customer }>(`/admin/customers/${c.id}`, {
        method: 'PATCH',
        body: { status: next },
      });
      qc.setQueryData(key, r.customer);
      setMessage(next === 'disabled' ? t('customer.switchedOff') : t('customer.switchedOn'));
    } catch (e) {
      setError(errorText(t, e));
    }
  };

  return (
    <div className="page">
      <p className="breadcrumb">
        <Link to="/customers">{t('customer.back')}</Link>
      </p>
      <PageHeader
        title={c.name ?? t('customers.noName')}
        subtitle={
          <>
            {`+91 ${c.phone.slice(3, 8)} ${c.phone.slice(8)}`} · {t(`customers.type.${c.type}`)}
            {c.status === 'disabled' ? <Chip tone="warning">{t('common.switchedOff')}</Chip> : null}
          </>
        }
        actions={
          <button
            type="button"
            className={`btn ${c.status === 'active' ? 'btn-warning' : 'btn-secondary'}`}
            onClick={() => void toggleStatus()}
          >
            {c.status === 'active' ? t('customer.switchOff') : t('customer.switchOn')}
          </button>
        }
      />
      <LiveMessage text={message} tone="success" />
      {error ? (
        <p className="field-error" role="alert">
          {error}
        </p>
      ) : null}

      <dl className="grid grid-stats">
        <div className="card stat">
          <dt>{t('customer.cards.language')}</dt>
          <dd className="stat-value stat-small">
            {c.preferredLanguage === 'ml' ? 'മലയാളം' : 'English'}
          </dd>
        </div>
        <div className="card stat">
          <dt>{t('customer.cards.privacy')}</dt>
          <dd className="stat-value stat-small">
            {c.privacyAcceptedAt ? (
              new Date(c.privacyAcceptedAt).toLocaleDateString('en-IN', {
                day: 'numeric',
                month: 'short',
                year: 'numeric',
              })
            ) : (
              <span className="tone-warning">{t('customer.cards.privacyPending')}</span>
            )}
          </dd>
          {!c.privacyAcceptedAt ? (
            <dd className="stat-note">{t('customer.cards.privacyNote')}</dd>
          ) : null}
        </div>
        <div className="card stat">
          <dt>{t('customer.cards.since')}</dt>
          <dd className="stat-value stat-small">
            {new Date(c.createdAt).toLocaleDateString('en-IN', {
              day: 'numeric',
              month: 'short',
              year: 'numeric',
            })}
          </dd>
        </div>
      </dl>
      <CustomerPrice customerId={c.id} />

      <section aria-labelledby="addr-h">
        <div className="section-head">
          <h2 id="addr-h">{t('customer.addresses')}</h2>
          <button
            type="button"
            className="btn btn-secondary btn-compact"
            onClick={() => setAdding(true)}
          >
            {t('customer.addAddress')}
          </button>
        </div>
        {c.addresses.length === 0 ? (
          <div className="card empty">{t('customer.noAddresses')}</div>
        ) : (
          <ul className="grid grid-attention">
            {c.addresses.map((a) => (
              <li key={a.id} className="card attention">
                <strong>
                  {a.label} {a.isDefault ? <Chip tone="info">{t('customer.default')}</Chip> : null}
                </strong>
                <span>{a.line}</span>
                <span className="muted">
                  {a.landmark} · {a.areaName} {a.pincode}
                </span>
                {a.deliveryNote ? (
                  <span className="cell-note">
                    {t('customer.note')}: {a.deliveryNote}
                  </span>
                ) : null}
                {a.latitude !== null && a.longitude !== null ? (
                  <a
                    href={`https://www.google.com/maps?q=${a.latitude},${a.longitude}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {t('customer.openMap')}
                  </a>
                ) : (
                  <span className="cell-note">{t('customer.noPin')}</span>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <CustomerOrders customerId={c.id} active={c.status === 'active' && c.addresses.length > 0} />

      <section aria-labelledby="ledger-h">
        <h2 id="ledger-h">{t('customer.ledger.title')}</h2>
        <div className="card empty">{t('customer.ledger.notYet')}</div>
      </section>

      <AddAddressDialog
        customerId={c.id}
        open={adding}
        onClose={() => setAdding(false)}
        onSaved={() => void qc.invalidateQueries({ queryKey: key })}
      />
    </div>
  );
}

function AddAddressDialog({
  customerId,
  open,
  onClose,
  onSaved,
}: {
  customerId: string;
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t } = useTranslation();
  const [f, setF] = useState({ label: '', line: '', landmark: '', pincode: '', deliveryNote: '' });
  const [tried, setTried] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const input = {
    ...f,
    label: f.label || t('customers.addressLabel'),
    deliveryNote: f.deliveryNote || null,
  };
  const check = addressInputSchema.safeParse(input);
  const bad = (k: string) =>
    tried && !check.success && check.error.issues.some((i) => i.path[0] === k);
  const close = () => {
    setF({ label: '', line: '', landmark: '', pincode: '', deliveryNote: '' });
    setTried(false);
    setError(null);
    onClose();
  };
  const save = async () => {
    setTried(true);
    if (!check.success) return;
    try {
      await call(`/admin/customers/${customerId}/addresses`, { method: 'POST', body: input });
      onSaved();
      close();
    } catch (e) {
      setError(errorText(t, e));
    }
  };
  const field = (k: keyof typeof f, label: string, extra: object = {}) => (
    <label className="field">
      <span>{label}</span>
      <input
        value={f[k]}
        onChange={(e) =>
          setF({
            ...f,
            [k]: k === 'pincode' ? e.target.value.replace(/\D/g, '').slice(0, 6) : e.target.value,
          })
        }
        aria-invalid={bad(k)}
        {...extra}
      />
      {bad(k) ? <span className="field-error">{t(`address.errors.${k}`)}</span> : null}
    </label>
  );
  return (
    <Dialog open={open} title={t('customer.addAddress')} onClose={close}>
      <form
        className="form"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        {field('label', t('address.label'), { placeholder: t('customers.addressLabel') })}
        {field('line', t('address.line'))}
        {field('landmark', t('address.landmark'))}
        {field('pincode', t('address.pincode'), { inputMode: 'numeric' })}
        {field('deliveryNote', t('address.note'))}
        {error ? (
          <p className="field-error" role="alert">
            {error}
          </p>
        ) : null}
        <div className="form-actions">
          <button type="submit" className="btn btn-primary">
            {t('address.save')}
          </button>
          <button type="button" className="btn btn-secondary" onClick={close}>
            {t('common.cancel')}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
