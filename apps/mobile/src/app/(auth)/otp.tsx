import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { colors, spacing } from '@wtrdrop/design-tokens';
import type { Role } from '@wtrdrop/shared';
import { Button } from '../../components/Button';
import { Header } from '../../components/Header';
import { Message } from '../../components/Message';
import { Screen } from '../../components/Screen';
import { Text } from '../../components/Text';
import { TextField } from '../../components/TextField';
import { api } from '../../lib/api';
import { errorText } from '../../lib/errors';
import { deviceId, useSessionState } from '../../lib/session';
import { KEYS, secure } from '../../lib/storage';

const RESEND_SECONDS = 30;

interface Verified {
  status: 'signed_in';
  role: Role;
  accessToken: string;
  refreshToken: string;
  next: { profileComplete?: boolean; hasAddress?: boolean; pinSet?: boolean };
}

/** Step 2: the 6-digit code. Android fills it in from the SMS; it submits by itself when complete. */
export default function OtpScreen() {
  const { t } = useTranslation();
  const { signIn } = useSessionState();
  const { phone = '', app = 'customer' } = useLocalSearchParams<{
    phone?: string;
    app?: 'customer' | 'staff';
  }>();
  const [code, setCode] = useState('');
  const [seconds, setSeconds] = useState(RESEND_SECONDS);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (seconds <= 0) return;
    const id = setTimeout(() => setSeconds((s) => s - 1), 1000);
    return () => clearTimeout(id);
  }, [seconds]);

  const verify = async (value: string) => {
    if (busy || value.length !== 6) return;
    setBusy(true);
    setError(null);
    try {
      const body: Record<string, string> = { app, phone, code: value };
      if (app === 'staff') body.deviceId = await deviceId();
      const r = await api<Verified>('/auth/otp/verify', { method: 'POST', body, auth: false });
      await signIn(r);
      if (r.role === 'staff') {
        await secure.set(KEYS.staffPhone, phone);
        await secure.set(KEYS.staffPinSet, r.next.pinSet ? '1' : '0');
        router.replace(r.next.pinSet ? '/(staff)/route' : '/(auth)/set-pin');
      } else if (!r.next.profileComplete) {
        router.replace('/(customer)/profile-setup');
      } else if (!r.next.hasAddress) {
        router.replace({ pathname: '/(customer)/address', params: { first: '1' } });
      } else {
        router.replace('/(customer)/home');
      }
    } catch (e) {
      setError(errorText(t, e));
      setCode('');
    } finally {
      setBusy(false);
    }
  };

  const resend = async () => {
    setError(null);
    try {
      await api('/auth/otp/request', { method: 'POST', body: { phone }, auth: false });
      setSeconds(RESEND_SECONDS);
      setNotice(t('auth.codeSentAgain'));
    } catch (e) {
      setError(errorText(t, e));
    }
  };

  const masked = phone.length === 10 ? `+91 ${phone.slice(0, 5)} ${phone.slice(5)}` : phone;

  return (
    <Screen
      footer={
        <Button
          label={busy ? t('auth.checking') : t('auth.verify')}
          disabled={code.length !== 6 || busy}
          onPress={() => void verify(code)}
        />
      }
    >
      <Header title={t('auth.otpTitle')} back />
      <Text muted>{t('auth.otpBody', { phone: masked })}</Text>
      <TextField
        label={t('auth.otpLabel')}
        value={code}
        onChangeText={(v) => {
          const next = v.replace(/\D/g, '').slice(0, 6);
          setCode(next);
          if (next.length === 6) void verify(next);
        }}
        keyboardType="number-pad"
        autoComplete="sms-otp"
        textContentType="oneTimeCode"
        autoFocus
        style={styles.code}
      />
      {error ? <Message tone="warning" text={error} /> : null}
      {notice && !error ? <Message tone="success" text={notice} /> : null}
      <View style={styles.row}>
        {seconds > 0 ? (
          <Text muted>{t('auth.resendIn', { seconds })}</Text>
        ) : (
          <Pressable accessibilityRole="button" onPress={() => void resend()} style={styles.link}>
            <Text variant="label" color={colors.primary}>
              {t('auth.resend')}
            </Text>
          </Pressable>
        )}
        <Pressable accessibilityRole="button" onPress={() => router.back()} style={styles.link}>
          <Text variant="label" color={colors.primary}>
            {t('auth.changeNumber')}
          </Text>
        </Pressable>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  code: { letterSpacing: 10, fontSize: 28 },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: spacing.md,
  },
  link: { minHeight: 48, justifyContent: 'center' },
});
