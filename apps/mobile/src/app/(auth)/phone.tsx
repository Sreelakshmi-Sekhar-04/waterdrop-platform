import { useState } from 'react';
import { router, useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { indianMobileSchema, normaliseMobileInput } from '@wtrdrop/shared';
import { Button } from '../../components/Button';
import { Header } from '../../components/Header';
import { Message } from '../../components/Message';
import { Screen } from '../../components/Screen';
import { Text } from '../../components/Text';
import { TextField } from '../../components/TextField';
import { api } from '../../lib/api';
import { errorText } from '../../lib/errors';

/** Step 1 of sign-in: the phone number. The same screen serves customers and delivery staff. */
export default function PhoneScreen() {
  const { t } = useTranslation();
  const { app = 'customer' } = useLocalSearchParams<{ app?: 'customer' | 'staff' }>();
  const [digits, setDigits] = useState('');
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const valid = indianMobileSchema.safeParse(digits).success;
  const showError = touched && digits.length > 0 && !valid;

  const send = async () => {
    setBusy(true);
    setError(null);
    try {
      await api('/auth/otp/request', { method: 'POST', body: { phone: digits }, auth: false });
      router.push({ pathname: '/(auth)/otp', params: { phone: digits, app } });
    } catch (e) {
      setError(errorText(t, e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen
      footer={
        <Button
          label={busy ? t('auth.sending') : t('auth.sendCode')}
          disabled={!valid || busy}
          onPress={() => void send()}
        />
      }
    >
      <Header title={app === 'staff' ? t('auth.staffPhoneTitle') : t('auth.phoneTitle')} back />
      <Text muted>{t('auth.phoneBody')}</Text>
      <TextField
        label={t('auth.phoneLabel')}
        prefix="+91"
        value={digits}
        onChangeText={(v) => setDigits(normaliseMobileInput(v))}
        onBlur={() => setTouched(true)}
        onSubmitEditing={() => valid && void send()}
        keyboardType="number-pad"
        autoComplete="tel"
        textContentType="telephoneNumber"
        autoFocus
        error={showError ? t('auth.phoneError') : null}
      />
      {error ? <Message tone="warning" text={error} /> : null}
    </Screen>
  );
}
