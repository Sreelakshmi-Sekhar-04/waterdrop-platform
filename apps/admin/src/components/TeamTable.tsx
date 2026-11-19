import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { indianMobileSchema, normaliseMobileInput, personNameSchema } from '@wtrdrop/shared';
import { call } from '../lib/api';
import { errorText } from '../lib/errors';
import { useAuth } from '../lib/auth';
import { Dialog } from './Dialog';
import { Chip, LiveMessage, TableWrap, maskPhone } from './ui';

export interface Member {
  userId: string;
  name: string | null;
  phone: string;
  role: string;
  status: 'active' | 'disabled';
  pinDevices: number;
  passwordSet: boolean;
}

/** Shared by the Staff page (delivery staff) and Settings (office accounts). */
export function TeamTable({ kind }: { kind: 'staff' | 'team' }) {
  const { t } = useTranslation();
  const { me } = useAuth();
  const qc = useQueryClient();
  const key = ['team', kind];
  const q = useQuery({
    queryKey: key,
    queryFn: async () => (await call<Record<string, Member[]>>(`/admin/${kind}`))[kind]!,
  });
  const [adding, setAdding] = useState(false);
  const [confirm, setConfirm] = useState<{ m: Member; action: 'off' | 'on' | 'reset' } | null>(
    null,
  );
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const act = async () => {
    if (!confirm) return;
    const { m, action } = confirm;
    setError(null);
    try {
      if (action === 'reset')
        await call(`/admin/staff/${m.userId}/reset-pin`, { method: 'POST', body: {} });
      else
        await call(`/admin/${kind}/${m.userId}`, {
          method: 'PATCH',
          body: { status: action === 'off' ? 'disabled' : 'active' },
        });
      setMessage(t(`team.done.${action}`, { name: m.name ?? '' }));
      await qc.invalidateQueries({ queryKey: key });
    } catch (e) {
      setError(errorText(t, e));
    }
    setConfirm(null);
  };

  return (
    <>
      <div className="section-head">
        <span />
        <button
          type="button"
          className="btn btn-primary btn-compact"
          onClick={() => setAdding(true)}
        >
          {kind === 'staff' ? t('team.addStaff') : t('team.addAdmin')}
        </button>
      </div>
      <LiveMessage text={message} tone="success" />
      {error ? (
        <p className="field-error" role="alert">
          {error}
        </p>
      ) : null}
      {q.isPending ? <div className="card empty">{t('common.loading')}</div> : null}
      {q.isError ? (
        <div className="card empty" role="alert">
          {errorText(t, q.error)}
        </div>
      ) : null}
      {q.data && q.data.length === 0 ? (
        <div className="card empty">
          {kind === 'staff' ? t('team.noStaff') : t('team.noAdmins')}
        </div>
      ) : null}
      {q.data && q.data.length > 0 ? (
        <TableWrap label={kind === 'staff' ? t('nav.staff') : t('settings.team')}>
          <table>
            <thead>
              <tr>
                <th scope="col">{t('team.cols.name')}</th>
                <th scope="col">{t('team.cols.status')}</th>
                <th scope="col">
                  {kind === 'staff' ? t('team.cols.pin') : t('team.cols.password')}
                </th>
                <th scope="col">{t('team.cols.actions')}</th>
              </tr>
            </thead>
            <tbody>
              {q.data.map((m) => (
                <tr key={`${m.userId}-${m.role}`}>
                  <th scope="row">
                    {m.name}
                    <span className="cell-note">
                      {maskPhone(m.phone.slice(-4))} · {t(`roles.${m.role}`)}
                    </span>
                  </th>
                  <td>
                    {m.status === 'active' ? (
                      <Chip tone="success">{t('common.active')}</Chip>
                    ) : (
                      <Chip tone="neutral">{t('common.switchedOff')}</Chip>
                    )}
                  </td>
                  <td>
                    {kind === 'staff' ? (
                      m.pinDevices > 0 ? (
                        t('team.pinSet')
                      ) : (
                        <span className="muted">{t('team.pinNotSet')}</span>
                      )
                    ) : m.passwordSet ? (
                      t('team.passwordSet')
                    ) : (
                      <span className="muted">{t('team.passwordNotSet')}</span>
                    )}
                  </td>
                  <td className="row-actions">
                    {m.role === 'owner' || m.userId === me?.id ? null : (
                      <>
                        {kind === 'staff' && m.status === 'active' && m.pinDevices > 0 ? (
                          <button
                            type="button"
                            className="btn btn-link"
                            onClick={() => setConfirm({ m, action: 'reset' })}
                          >
                            {t('team.resetPin')}
                          </button>
                        ) : null}
                        <button
                          type="button"
                          className="btn btn-link"
                          onClick={() =>
                            setConfirm({ m, action: m.status === 'active' ? 'off' : 'on' })
                          }
                        >
                          {m.status === 'active' ? t('team.switchOff') : t('team.switchOn')}
                        </button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableWrap>
      ) : null}

      <AddMemberDialog
        kind={kind}
        open={adding}
        onClose={() => setAdding(false)}
        onAdded={(name) => {
          setMessage(t('team.added', { name }));
          void qc.invalidateQueries({ queryKey: key });
        }}
      />
      <Dialog
        open={!!confirm}
        title={
          confirm ? t(`team.confirm.${confirm.action}.title`, { name: confirm.m.name ?? '' }) : ''
        }
        onClose={() => setConfirm(null)}
      >
        {confirm ? (
          <div className="form">
            <p>{t(`team.confirm.${confirm.action}.body`, { name: confirm.m.name ?? '' })}</p>
            <div className="form-actions">
              <button
                type="button"
                className={`btn ${confirm.action === 'on' ? 'btn-primary' : 'btn-warning'}`}
                onClick={() => void act()}
              >
                {t(`team.confirm.${confirm.action}.yes`)}
              </button>
              <button type="button" className="btn btn-secondary" onClick={() => setConfirm(null)}>
                {t('common.cancel')}
              </button>
            </div>
          </div>
        ) : null}
      </Dialog>
    </>
  );
}

function AddMemberDialog({
  kind,
  open,
  onClose,
  onAdded,
}: {
  kind: 'staff' | 'team';
  open: boolean;
  onClose: () => void;
  onAdded: (name: string) => void;
}) {
  const { t } = useTranslation();
  const [phone, setPhone] = useState('');
  const [name, setName] = useState('');
  const [tried, setTried] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const badPhone = !indianMobileSchema.safeParse(phone).success;
  const badName = !personNameSchema.safeParse(name).success;
  const close = () => {
    setPhone('');
    setName('');
    setTried(false);
    setError(null);
    onClose();
  };
  const save = async () => {
    setTried(true);
    if (badPhone || badName) return;
    try {
      await call(`/admin/${kind}`, { method: 'POST', body: { phone, name } });
      onAdded(name);
      close();
    } catch (e) {
      setError(errorText(t, e));
    }
  };
  return (
    <Dialog
      open={open}
      title={kind === 'staff' ? t('team.addStaff') : t('team.addAdmin')}
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
        <p className="muted">
          {kind === 'staff' ? t('team.addStaffHelp') : t('team.addAdminHelp')}
        </p>
        <label className="field">
          <span>{t('customers.name')}</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            aria-invalid={tried && badName}
            autoFocus
          />
          {tried && badName ? (
            <span className="field-error">{t('customers.nameError')}</span>
          ) : null}
        </label>
        <label className="field">
          <span>{t('customers.phone')}</span>
          <input
            type="tel"
            inputMode="numeric"
            value={phone}
            onChange={(e) => setPhone(normaliseMobileInput(e.target.value))}
            aria-invalid={tried && badPhone}
          />
          {tried && badPhone ? (
            <span className="field-error">{t('customers.phoneError')}</span>
          ) : null}
        </label>
        {error ? (
          <p className="field-error" role="alert">
            {error}
          </p>
        ) : null}
        <div className="form-actions">
          <button type="submit" className="btn btn-primary">
            {t('team.add')}
          </button>
          <button type="button" className="btn btn-secondary" onClick={close}>
            {t('common.cancel')}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
