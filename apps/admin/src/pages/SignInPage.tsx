import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { indianMobileSchema, normaliseMobileInput } from '@wtrdrop/shared';
import { LogoMark, Wordmark } from '../components/Logo';
import { publicCall } from '../lib/api';
import { useAuth } from '../lib/auth';
import { errorText } from '../lib/errors';

type Step = 'phone' | 'code' | 'newPassword';
type Verify =
  | { status: 'signed_in'; accessToken: string }
  | { status: 'password_setup_required'; setupToken: string };

/** Office sign-in: SMS code plus password (decision D-02). First time: create the password. */
export function SignInPage() {
  const { t, i18n } = useTranslation();
  const { completeSignIn } = useAuth();
  const [step, setStep] = useState<Step>('phone');
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [setupToken, setSetupToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [seconds, setSeconds] = useState(0);

  useEffect(() => {
    if (seconds <= 0) return;
    const id = setTimeout(() => setSeconds((s) => s - 1), 1000);
    return () => clearTimeout(id);
  }, [seconds]);

  const run = async (fn: () => Promise<void>) => {
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

  const sendCode = () =>
    run(async () => {
      await publicCall('/auth/otp/request', { phone });
      setStep('code');
      setSeconds(30);
    });

  const verify = () =>
    run(async () => {
      const r = await publicCall<Verify>('/auth/otp/verify', {
        app: 'admin',
        phone,
        code,
        password: password || undefined,
      });
      if (r.status === 'password_setup_required') {
        setSetupToken(r.setupToken);
        setStep('newPassword');
      } else {
        await completeSignIn(r.accessToken);
      }
    });

  const createPassword = () =>
    run(async () => {
      if (newPassword !== confirm) throw Object.assign(new Error('mismatch'), {});
      const r = await publicCall<{ accessToken: string }>('/auth/admin/password/setup', {
        setupToken,
        password: newPassword,
      });
      await completeSignIn(r.accessToken);
    }).then(() => undefined);

  const phoneOk = indianMobileSchema.safeParse(phone).success;
  const mismatch = confirm.length > 0 && confirm !== newPassword;

  return (
    <div className="signin">
      <div className="signin-card card">
        <div className="brand">
          <LogoMark size={40} />
          <Wordmark />
        </div>
        <button
          type="button"
          className="btn btn-link signin-lang"
          onClick={() => void i18n.changeLanguage(i18n.language === 'ml' ? 'en' : 'ml')}
          aria-label={t('app.languageLabel')}
        >
          {t('app.language')}
        </button>

        {step === 'phone' ? (
          <form
            className="form"
            onSubmit={(e) => {
              e.preventDefault();
              if (phoneOk) void sendCode();
            }}
          >
            <h1>{t('signIn.title')}</h1>
            <p className="muted">{t('signIn.body')}</p>
            <label className="field">
              <span>{t('signIn.phone')}</span>
              <input
                type="tel"
                inputMode="numeric"
                autoComplete="tel"
                value={phone}
                onChange={(e) => setPhone(normaliseMobileInput(e.target.value))}
                autoFocus
              />
            </label>
            {error ? (
              <p className="field-error" role="alert">
                {error}
              </p>
            ) : null}
            <button type="submit" className="btn btn-primary" disabled={!phoneOk || busy}>
              {busy ? t('signIn.sending') : t('signIn.sendCode')}
            </button>
          </form>
        ) : null}

        {step === 'code' ? (
          <form
            className="form"
            onSubmit={(e) => {
              e.preventDefault();
              void verify();
            }}
          >
            <h1>{t('signIn.codeTitle')}</h1>
            <p className="muted">
              {t('signIn.codeBody', { phone: `+91 ${phone.slice(0, 5)} ${phone.slice(5)}` })}
            </p>
            <label className="field">
              <span>{t('signIn.code')}</span>
              <input
                inputMode="numeric"
                autoComplete="one-time-code"
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                autoFocus
              />
            </label>
            <label className="field">
              <span>{t('signIn.password')}</span>
              <input
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                aria-describedby="pw-hint"
              />
              <span id="pw-hint" className="field-hint">
                {t('signIn.passwordHint')}
              </span>
            </label>
            {error ? (
              <p className="field-error" role="alert">
                {error}
              </p>
            ) : null}
            <button type="submit" className="btn btn-primary" disabled={code.length !== 6 || busy}>
              {busy ? t('signIn.checking') : t('signIn.signIn')}
            </button>
            <div className="form-actions">
              <button
                type="button"
                className="btn btn-link"
                disabled={seconds > 0 || busy}
                onClick={() => void sendCode()}
              >
                {seconds > 0 ? t('signIn.resendIn', { seconds }) : t('signIn.resend')}
              </button>
              <button type="button" className="btn btn-link" onClick={() => setStep('phone')}>
                {t('signIn.changeNumber')}
              </button>
            </div>
          </form>
        ) : null}

        {step === 'newPassword' ? (
          <form
            className="form"
            onSubmit={(e) => {
              e.preventDefault();
              if (!mismatch) void createPassword();
            }}
          >
            <h1>{t('signIn.newPasswordTitle')}</h1>
            <p className="muted">{t('signIn.newPasswordBody')}</p>
            <label className="field">
              <span>{t('signIn.newPassword')}</span>
              <input
                type="password"
                autoComplete="new-password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                autoFocus
                aria-describedby="np-hint"
              />
              <span id="np-hint" className="field-hint">
                {t('signIn.newPasswordHint')}
              </span>
            </label>
            <label className="field">
              <span>{t('signIn.confirmPassword')}</span>
              <input
                type="password"
                autoComplete="new-password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                aria-invalid={mismatch}
              />
              {mismatch ? <span className="field-error">{t('signIn.mismatch')}</span> : null}
            </label>
            {error ? (
              <p className="field-error" role="alert">
                {error}
              </p>
            ) : null}
            <button
              type="submit"
              className="btn btn-primary"
              disabled={newPassword.length < 10 || mismatch || !confirm || busy}
            >
              {t('signIn.createPassword')}
            </button>
          </form>
        ) : null}
      </div>
    </div>
  );
}
