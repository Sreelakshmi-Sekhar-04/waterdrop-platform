import { useState } from 'react';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { COMPLAINT_CATEGORIES, type ComplaintCategory } from '@wtrdrop/shared';
import { call } from '../lib/api';
import { orderNo } from '../lib/orders';
import { errorText } from '../lib/errors';
import { FormDialog, useSaving } from './MoneyDialogs';
import { Chip, LiveMessage, TableWrap, maskPhone } from './ui';

export interface Complaint {
  id: string;
  customerId: string;
  customerName: string | null;
  phoneLast4: string;
  orderId: string | null;
  orderNo: number | null;
  category: ComplaintCategory;
  note: string | null;
  status: 'open' | 'resolved';
  resolution: string | null;
  resolvedAt: string | null;
  createdAt: string;
}

export function useWhen() {
  const { i18n } = useTranslation();
  return (iso: string) =>
    new Date(iso).toLocaleString(i18n.language === 'ml' ? 'ml-IN' : 'en-IN', {
      day: 'numeric',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
      timeZone: 'Asia/Kolkata',
    });
}

/**
 * Complaints as a table. On the Complaints page it names the customer; on a customer's page it
 * does not. Open complaints have a Resolve button.
 */
export function ComplaintTable({
  items,
  showCustomer,
  onChanged,
}: {
  items: Complaint[];
  showCustomer: boolean;
  onChanged: (text: string) => void;
}) {
  const { t } = useTranslation();
  const when = useWhen();
  const [resolving, setResolving] = useState<Complaint | null>(null);
  return (
    <>
      <TableWrap label={t('complaints.title')}>
        <table data-testid="complaints">
          <thead>
            <tr>
              <th scope="col">{t('complaints.cols.problem')}</th>
              {showCustomer ? <th scope="col">{t('money.cols.customer')}</th> : null}
              <th scope="col">{t('complaints.cols.when')}</th>
              <th scope="col">{t('complaints.cols.status')}</th>
            </tr>
          </thead>
          <tbody>
            {items.map((c) => (
              <tr key={c.id}>
                <th scope="row" className="wrap">
                  {t(`complaints.category.${c.category}`)}
                  {c.orderNo ? (
                    <span className="cell-note">
                      <Link to={`/orders/${c.orderId}`}>{orderNo(c.orderNo)}</Link>
                    </span>
                  ) : null}
                  {c.note ? <span className="cell-note">“{c.note}”</span> : null}
                </th>
                {showCustomer ? (
                  <td>
                    <Link to={`/customers/${c.customerId}`}>
                      {c.customerName ?? t('customers.noName')}
                    </Link>
                    <span className="cell-note">{maskPhone(c.phoneLast4)}</span>
                  </td>
                ) : null}
                <td>{when(c.createdAt)}</td>
                <td className="wrap">
                  {c.status === 'open' ? (
                    <div className="row-actions">
                      <Chip tone="warning">{t('complaints.status.open')}</Chip>
                      <button
                        type="button"
                        className="btn btn-primary btn-compact"
                        onClick={() => setResolving(c)}
                        aria-label={t('complaints.resolveFor', {
                          problem: t(`complaints.category.${c.category}`),
                          name: c.customerName ?? '',
                        })}
                      >
                        {t('complaints.resolve')}
                      </button>
                    </div>
                  ) : (
                    <>
                      <Chip tone="success">{t('complaints.status.resolved')}</Chip>
                      {c.resolution ? <span className="cell-note">{c.resolution}</span> : null}
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableWrap>
      <ResolveDialog
        complaint={resolving}
        onClose={() => setResolving(null)}
        onSaved={(text) => {
          setResolving(null);
          onChanged(text);
        }}
      />
    </>
  );
}

function ResolveDialog({
  complaint,
  onClose,
  onSaved,
}: {
  complaint: Complaint | null;
  onClose: () => void;
  onSaved: (text: string) => void;
}) {
  const { t } = useTranslation();
  const [text, setText] = useState('');
  const [tried, setTried] = useState(false);
  const { error, setError, run } = useSaving();
  const ok = text.trim().length >= 3;
  const close = () => {
    setText('');
    setTried(false);
    setError(null);
    onClose();
  };
  const save = () =>
    run(async () => {
      setTried(true);
      if (!ok || !complaint) return;
      await call(`/admin/complaints/${complaint.id}/resolve`, {
        method: 'POST',
        body: { resolution: text.trim() },
      });
      setText('');
      setTried(false);
      onSaved(t('complaints.resolved', { name: complaint.customerName ?? '' }));
    });
  return (
    <FormDialog
      open={complaint !== null}
      title={t('complaints.resolve')}
      onClose={close}
      onSave={() => void save()}
      saveLabel={t('complaints.resolveSave')}
      error={error}
    >
      {complaint ? (
        <p className="muted">
          {complaint.customerName ?? t('customers.noName')} ·{' '}
          {t(`complaints.category.${complaint.category}`)}
          {complaint.note ? ` · “${complaint.note}”` : ''}
        </p>
      ) : null}
      <label className="field">
        <span>{t('complaints.whatDone')}</span>
        <textarea
          rows={3}
          maxLength={500}
          value={text}
          onChange={(e) => setText(e.target.value)}
          aria-invalid={tried && !ok}
          aria-describedby="resolve-hint"
          autoFocus
        />
        <span id="resolve-hint" className="field-hint">
          {t('complaints.whatDoneHint')}
        </span>
        {tried && !ok ? <span className="field-error">{t('complaints.writeMore')}</span> : null}
      </label>
    </FormDialog>
  );
}

/** The office notes a complaint the customer phoned in. */
export function NoteComplaintDialog({
  open,
  customerId,
  onClose,
  onSaved,
}: {
  open: boolean;
  customerId: string;
  onClose: () => void;
  onSaved: (text: string) => void;
}) {
  const { t } = useTranslation();
  const [category, setCategory] = useState<ComplaintCategory>('CAN_COUNT');
  const [note, setNote] = useState('');
  const [tried, setTried] = useState(false);
  const [requestId, setRequestId] = useState(() => crypto.randomUUID());
  const { error, setError, run } = useSaving();
  const ok = category !== 'OTHER' || note.trim().length >= 3;
  const close = () => {
    setCategory('CAN_COUNT');
    setNote('');
    setTried(false);
    setError(null);
    setRequestId(crypto.randomUUID());
    onClose();
  };
  const save = () =>
    run(async () => {
      setTried(true);
      if (!ok) return;
      await call(`/admin/customers/${customerId}/complaints`, {
        method: 'POST',
        body: { clientRequestId: requestId, category, note: note.trim() || undefined },
      });
      onSaved(t('complaints.noted'));
      close();
    });
  return (
    <FormDialog
      open={open}
      title={t('complaints.note')}
      onClose={close}
      onSave={() => void save()}
      saveLabel={t('complaints.noteSave')}
      error={error}
    >
      <fieldset className="fieldset">
        <legend>{t('complaints.whatProblem')}</legend>
        {COMPLAINT_CATEGORIES.map((c) => (
          <label key={c} className="inline-field">
            <input
              type="radio"
              name="complaint-category"
              checked={category === c}
              onChange={() => setCategory(c)}
            />
            {t(`complaints.category.${c}`)}
          </label>
        ))}
      </fieldset>
      <label className="field">
        <span>
          {category === 'OTHER' ? t('complaints.details') : t('complaints.detailsOptional')}
        </span>
        <textarea
          rows={3}
          maxLength={500}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          aria-invalid={tried && !ok}
        />
        {tried && !ok ? <span className="field-error">{t('complaints.writeMore')}</span> : null}
      </label>
    </FormDialog>
  );
}

/** A customer's complaints on their page, with "Note a complaint". */
export function CustomerComplaints({ customerId }: { customerId: string }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [adding, setAdding] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const q = useQuery({
    queryKey: ['complaints', 'customer', customerId],
    queryFn: async () =>
      (await call<{ complaints: Complaint[] }>(`/admin/complaints?customerId=${customerId}`))
        .complaints,
  });
  const changed = (text: string) => {
    setMessage(text);
    void qc.invalidateQueries({ queryKey: ['complaints'] });
    void qc.invalidateQueries({ queryKey: ['dashboard'] });
  };
  return (
    <section aria-labelledby="complaints-h">
      <div className="section-head">
        <h2 id="complaints-h">{t('complaints.title')}</h2>
        <button type="button" className="btn btn-secondary" onClick={() => setAdding(true)}>
          {t('complaints.note')}
        </button>
      </div>
      <LiveMessage text={message} tone="success" />
      {q.isError ? (
        <p className="field-error" role="alert">
          {errorText(t, q.error)}
        </p>
      ) : null}
      {q.data && q.data.length === 0 ? (
        <div className="card empty">{t('complaints.noneForCustomer')}</div>
      ) : null}
      {q.data && q.data.length > 0 ? (
        <ComplaintTable items={q.data} showCustomer={false} onChanged={changed} />
      ) : null}
      <NoteComplaintDialog
        open={adding}
        customerId={customerId}
        onClose={() => setAdding(false)}
        onSaved={changed}
      />
    </section>
  );
}
