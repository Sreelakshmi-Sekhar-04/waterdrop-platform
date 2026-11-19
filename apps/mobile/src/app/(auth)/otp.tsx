import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { colors, spacing } from '@wtrdrop/design-tokens';
import { Button } from '../../components/Button';
import { Header } from '../../components/Header';
import { Message } from '../../components/Message';
import { Screen } from '../../components/Screen';
import { Text } from '../../components/Text';
import { TextField } from '../../components/TextField';

const RESEND_SECONDS = 30;

/** Step 2 of sign-in. One field that accepts the SMS auto-fill; layout only in Phase 2. */
export default function OtpScreen() {
  const { t } = useTranslation();
  const { phone = '' } = useLocalSearchParams<{ phone?: string }>();
  const [code, setCode] = useState('');
  const [seconds, setSeconds] = useState(RESEND_SECONDS);
  const [tried, setTried] = useState(false);

  useEffect(() => {
    if (seconds <= 0) return;
    const id = setTimeout(() => setSeconds((s) => s - 1), 1000);
    return () => clearTimeout(id);
  }, [seconds]);

  const masked = phone.length === 10 ? `+91 ${phone.slice(0, 5)} ${phone.slice(5)}` : phone;

  return (
    <Screen
      footer={
        <Button
          label={t('auth.verify')}
          disabled={code.length !== 6}
          onPress={() => setTried(true)}
        />
      }
    >
      <Header title={t('auth.otpTitle')} back />
      <Text muted>{t('auth.otpBody', { phone: masked })}</Text>
      <TextField
        label={t('auth.otpLabel')}
        value={code}
        onChangeText={(v) => setCode(v.replace(/\D/g, '').slice(0, 6))}
        keyboardType="number-pad"
        autoComplete="sms-otp"
        textContentType="oneTimeCode"
        maxLength={6}
        autoFocus
        style={styles.code}
      />
      <View style={styles.row}>
        {seconds > 0 ? (
          <Text muted>{t('auth.resendIn', { seconds })}</Text>
        ) : (
          <Pressable
            accessibilityRole="button"
            onPress={() => setSeconds(RESEND_SECONDS)}
            style={styles.link}
          >
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
      {tried ? <Message tone="warning" text={t('auth.notYet')} /> : null}
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
