import { useState } from 'react';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { indianMobileSchema, normaliseMobileInput } from '@wtrdrop/shared';
import { Button } from '../../components/Button';
import { Header } from '../../components/Header';
import { Message } from '../../components/Message';
import { Screen } from '../../components/Screen';
import { Text } from '../../components/Text';
import { TextField } from '../../components/TextField';

/** Step 1 of sign-in. Layout only in Phase 2; the code is sent from Phase 3. */
export default function PhoneScreen() {
  const { t } = useTranslation();
  const [digits, setDigits] = useState('');
  const [touched, setTouched] = useState(false);
  const valid = indianMobileSchema.safeParse(digits).success;
  const showError = touched && digits.length > 0 && !valid;

  return (
    <Screen
      footer={
        <Button
          label={t('auth.sendCode')}
          disabled={!valid}
          onPress={() => router.push({ pathname: '/(auth)/otp', params: { phone: digits } })}
        />
      }
    >
      <Header title={t('auth.phoneTitle')} back />
      <Text muted>{t('auth.phoneBody')}</Text>
      <TextField
        label={t('auth.phoneLabel')}
        prefix="+91"
        value={digits}
        onChangeText={(v) => setDigits(normaliseMobileInput(v))}
        onBlur={() => setTouched(true)}
        keyboardType="number-pad"
        autoComplete="tel"
        textContentType="telephoneNumber"
        autoFocus
        error={showError ? t('auth.phoneError') : null}
      />
      <Message tone="info" text={t('auth.notYet')} />
    </Screen>
  );
}
