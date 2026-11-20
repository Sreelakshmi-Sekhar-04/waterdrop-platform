import { useEffect, useState } from 'react';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { isWeakPin } from '@wtrdrop/shared';
import { Header } from '../../components/Header';
import { Message } from '../../components/Message';
import { PinPad } from '../../components/PinPad';
import { Screen } from '../../components/Screen';
import { Text } from '../../components/Text';
import { api } from '../../lib/api';
import { errorText } from '../../lib/errors';
import { KEYS, secure } from '../../lib/storage';

/** Staff, first time on this phone: choose a 4-digit PIN, then type it again. */
export default function SetPin() {
  const { t } = useTranslation();
  const [first, setFirst] = useState<string | null>(null);
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (pin.length !== 4) return;
    if (!first) {
      if (isWeakPin(pin)) {
        setError(t('errors.PIN_TOO_SIMPLE'));
        setPin('');
        return;
      }
      setFirst(pin);
      setPin('');
      return;
    }
    if (pin !== first) {
      setError(t('pin.mismatch'));
      setFirst(null);
      setPin('');
      return;
    }
    setBusy(true);
    void api('/auth/staff/pin', { method: 'POST', body: { pin } })
      .then(async () => {
        await secure.set(KEYS.staffPinSet, '1');
        router.replace('/(staff)/route');
      })
      .catch((e: unknown) => {
        setError(errorText(t, e));
        setFirst(null);
        setPin('');
      })
      .finally(() => setBusy(false));
  }, [pin, first, t]);

  return (
    <Screen>
      <Header title={first ? t('pin.confirmTitle') : t('pin.setTitle')} />
      <Text muted>{t('pin.setBody')}</Text>
      {error ? <Message tone="warning" text={error} /> : null}
      <PinPad
        value={pin}
        onChange={(v) => {
          setError(null);
          setPin(v);
        }}
        label={t('pin.label')}
        disabled={busy}
      />
    </Screen>
  );
}
