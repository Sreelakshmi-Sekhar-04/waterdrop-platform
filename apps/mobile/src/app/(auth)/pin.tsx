import { useEffect, useState } from 'react';
import { Pressable, StyleSheet } from 'react-native';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { colors } from '@wtrdrop/design-tokens';
import type { Role } from '@wtrdrop/shared';
import { Header } from '../../components/Header';
import { Message } from '../../components/Message';
import { PinPad } from '../../components/PinPad';
import { Screen } from '../../components/Screen';
import { Text } from '../../components/Text';
import { api, ApiError } from '../../lib/api';
import { errorText } from '../../lib/errors';
import { deviceId, useSessionState } from '../../lib/session';
import { KEYS, secure } from '../../lib/storage';

/** Staff, every working day: 4-digit PIN. No SMS needed on their own phone. */
export default function PinSignIn() {
  const { t } = useTranslation();
  const { signIn } = useSessionState();
  const [phone, setPhone] = useState<string | null>(null);
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void secure
      .get(KEYS.staffPhone)
      .then((p) =>
        p ? setPhone(p) : router.replace({ pathname: '/(auth)/phone', params: { app: 'staff' } }),
      );
  }, []);

  const useCode = () => router.replace({ pathname: '/(auth)/phone', params: { app: 'staff' } });

  useEffect(() => {
    if (pin.length !== 4 || !phone) return;
    setBusy(true);
    void (async () => {
      try {
        const r = await api<{ role: Role; accessToken: string; refreshToken: string }>(
          '/auth/staff/pin/sign-in',
          {
            method: 'POST',
            body: { phone, deviceId: await deviceId(), pin },
            auth: false,
          },
        );
        await signIn(r);
        router.replace('/(staff)/route');
      } catch (e) {
        if (e instanceof ApiError && (e.code === 'PIN_NOT_SET' || e.code === 'PIN_LOCKED')) {
          await secure.set(KEYS.staffPinSet, '0');
        }
        setError(errorText(t, e));
        setPin('');
      } finally {
        setBusy(false);
      }
    })();
  }, [pin, phone, signIn, t]);

  const masked = phone ? `+91 ••••• ${phone.slice(-5)}` : '';
  return (
    <Screen>
      <Header title={t('pin.signInTitle')} subtitle={masked} />
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
      <Pressable accessibilityRole="button" onPress={useCode} style={styles.link}>
        <Text variant="label" color={colors.primary} style={styles.center}>
          {t('pin.useCode')}
        </Text>
      </Pressable>
    </Screen>
  );
}

const styles = StyleSheet.create({
  link: { minHeight: 48, justifyContent: 'center' },
  center: { textAlign: 'center' },
});
