import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  addressInputSchema,
  customerTypeSchema,
  indianMobileSchema,
  normaliseMobileInput,
  personNameSchema,
  type CustomerType,
} from '@wtrdrop/shared';
import { call, ApiRequestError } from '../lib/api';
import { errorText } from '../lib/errors';
import { isOwner, useAuth } from '../lib/auth';
import { OpeningImportDialog } from '../components/OpeningImportDialog';
import { Dialog } from '../components/Dialog';
import { LiveMessage, PageHeader, SearchField, TableWrap, maskPhone } from '../components/ui';

interface Row {
  id: string;
  name: string | null;
  phone: string;
  type: CustomerType;
  status: 'active' | 'disabled';
  area: string | null;
  createdAt: string;
}

export function CustomersPage() {
  const { t } = useTranslation();
  const [params, setParams] = useSearchParams();
  const q = params.get('q') ?? '';
  const [adding, setAdding] = useState(false);
  const [importing, setImporting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const { me } = useAuth();
  const list = useQuery({
    queryKey: ['customers', q],
    queryFn: async () =>
      (await call<{ customers: Row[] }>(`/admin/customers?q=${encodeURIComponent(q)}`)).customers,
    placeholderData: (prev) => prev,
  });
  const rows = list.data ?? [];

  return (
    <div className="page">
      <PageHeader
        title={t('nav.customers')}
        actions={
          <>
            <SearchField
              label={t('customers.searchLabel')}
              placeholder={t('customers.searchPlaceholder')}
              value={q}
              onChange={(v) => setParams(v ? { q: v } : {}, { replace: true })}
            />
            <button type="button" className="btn btn-primary" onClick={() => setAdding(true)}>
              {t('customers.add')}
            </button>
            {isOwner(me) ? (
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setImporting(true)}
              >
                {t('opening.open')}
              </button>
            ) : null}
          </>
        }
      />
      {list.isError ? (
        <div className="card empty" role="alert">
          {errorText(t, list.error)}
        </div>
      ) : null}
      {list.isPending ? <div className="card empty">{t('common.loading')}</div> : null}
      {list.isSuccess ? (
        <>
          <p className="muted" role="status" aria-live="polite">
            {t('customers.count', { count: rows.length })}
          </p>
          {rows.length === 0 ? (
            <div className="card empty">
              {q ? t('customers.empty', { q }) : t('customers.none')}
            </div>
          ) : (
            <TableWrap label={t('nav.customers')}>
              <table>
                <thead>
                  <tr>
                    <th scope="col">{t('customers.cols.name')}</th>
                    <th scope="col">{t('customers.cols.area')}</th>
                    <th scope="col">{t('customers.cols.status')}</th>
                    <th scope="col">{t('customers.cols.since')}</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((c) => (
                    <tr key={c.id}>
                      <th scope="row">
                        <Link to={`/customers/${c.id}`}>{c.name ?? t('customers.noName')}</Link>
                        <span className="cell-note">
                          {t(`customers.type.${c.type}`)} · {maskPhone(c.phone.slice(-4))}
                        </span>
                      </th>
                      <td>{c.area ?? <span className="muted">{t('customers.noAddress')}</span>}</td>
                      <td>
                        {c.status === 'active' ? (
                          t('common.active')
                        ) : (
                          <span className="tone-warning">{t('common.switchedOff')}</span>
                        )}
                      </td>
                      <td>
                        {new Date(c.createdAt).toLocaleDateString('en-IN', {
                          day: 'numeric',
                          month: 'short',
                          year: 'numeric',
                        })}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrap>
          )}
        </>
      ) : null}
      <LiveMessage text={message} tone="success" />
      <AddCustomerDialog open={adding} onClose={() => setAdding(false)} />
      <OpeningImportDialog
        open={importing}
        onClose={() => setImporting(false)}
        onDone={setMessage}
      />
    </div>
  );
}

/** A customer who phoned in (A-01). They can later sign in to the app with the same number. */
function AddCustomerDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [f, setF] = useState({
    phone: '',
    name: '',
    type: 'household' as CustomerType,
    line: '',
    landmark: '',
    pincode: '',
  });
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [existingId, setExistingId] = useState<string | null>(null);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) =>
    setF({ ...f, [k]: e.target.value });

  const hasAddress = !!(f.line || f.landmark || f.pincode);
  const address = {
    label: t('customers.addressLabel'),
    line: f.line,
    landmark: f.landmark,
    pincode: f.pincode,
  };
  const bad = {
    phone: !indianMobileSchema.safeParse(f.phone).success,
    name: !personNameSchema.safeParse(f.name).success,
    address: hasAddress && !addressInputSchema.safeParse(address).success,
  };

  const close = () => {
    setF({ phone: '', name: '', type: 'household', line: '', landmark: '', pincode: '' });
    setTried(false);
    setError(null);
    setExistingId(null);
    onClose();
  };
  const save = async () => {
    setTried(true);
    if (bad.phone || bad.name || bad.address) return;
    setBusy(true);
    setError(null);
    try {
      const r = await call<{ customer: { id: string } }>('/admin/customers', {
        method: 'POST',
        body: {
          phone: f.phone,
          name: f.name,
          type: f.type,
          address: hasAddress ? address : undefined,
        },
      });
      await qc.invalidateQueries({ queryKey: ['customers'] });
      close();
      navigate(`/customers/${r.customer.id}`);
    } catch (e) {
      setError(errorText(t, e));
      if (e instanceof ApiRequestError && e.code === 'CUSTOMER_EXISTS') {
        setExistingId((e.details as { customerId: string }).customerId);
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} title={t('customers.addTitle')} onClose={close}>
      <form
        className="form"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <label className="field">
          <span>{t('customers.phone')}</span>
          <input
            type="tel"
            inputMode="numeric"
            value={f.phone}
            onChange={(e) => setF({ ...f, phone: normaliseMobileInput(e.target.value) })}
            aria-invalid={tried && bad.phone}
            autoFocus
          />
          {tried && bad.phone ? (
            <span className="field-error">{t('customers.phoneError')}</span>
          ) : null}
        </label>
        <label className="field">
          <span>{t('customers.name')}</span>
          <input value={f.name} onChange={set('name')} aria-invalid={tried && bad.name} />
          {tried && bad.name ? (
            <span className="field-error">{t('customers.nameError')}</span>
          ) : null}
        </label>
        <label className="field">
          <span>{t('customers.typeLabel')}</span>
          <select
            value={f.type}
            onChange={(e) => setF({ ...f, type: customerTypeSchema.parse(e.target.value) })}
          >
            {customerTypeSchema.options.map((o) => (
              <option key={o} value={o}>
                {t(`customers.type.${o}`)}
              </option>
            ))}
          </select>
        </label>
        <fieldset className="fieldset">
          <legend>{t('customers.addressOptional')}</legend>
          <label className="field">
            <span>{t('address.line')}</span>
            <input value={f.line} onChange={set('line')} />
          </label>
          <label className="field">
            <span>{t('address.landmark')}</span>
            <input value={f.landmark} onChange={set('landmark')} />
          </label>
          <label className="field">
            <span>{t('address.pincode')}</span>
            <input
              inputMode="numeric"
              value={f.pincode}
              onChange={(e) =>
                setF({ ...f, pincode: e.target.value.replace(/\D/g, '').slice(0, 6) })
              }
            />
          </label>
          {tried && bad.address ? (
            <span className="field-error">{t('customers.addressError')}</span>
          ) : null}
        </fieldset>
        {error ? (
          <p className="field-error" role="alert">
            {error}{' '}
            {existingId ? (
              <Link to={`/customers/${existingId}`} onClick={close}>
                {t('customers.openExisting')}
              </Link>
            ) : null}
          </p>
        ) : null}
        <div className="form-actions">
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {t('customers.save')}
          </button>
          <button type="button" className="btn btn-secondary" onClick={close}>
            {t('common.cancel')}
          </button>
        </div>
        <LiveMessage text={null} />
      </form>
    </Dialog>
  );
}
