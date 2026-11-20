import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import { colors, radii, spacing } from '@wtrdrop/design-tokens';
import { personNameSchema, type Language } from '@wtrdrop/shared';
import { Button } from '../../components/Button';
import { Header } from '../../components/Header';
import { Icon } from '../../components/Icon';
import { Message } from '../../components/Message';
import { Screen } from '../../components/Screen';
import { Text } from '../../components/Text';
import { TextField } from '../../components/TextField';
import { setLanguage } from '../../i18n';
import { api } from '../../lib/api';
import { profileKey, useProfile, type CustomerProfile } from '../../lib/customer';
import { errorText } from '../../lib/errors';
import { useSessionState } from '../../lib/session';

/** First sign-in: name and the privacy notice. Two fields, one button. */
export default function ProfileSetup() {
  const { t, i18n } = useTranslation();
  const qc = useQueryClient();
  const { reload } = useSessionState();
  const profile = useProfile();
  const [name, setName] = useState<string | null>(null);
  const [accepted, setAccepted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const value = name ?? profile.data?.name ?? '';
  const nameOk = personNameSchema.safeParse(value).success;

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ customer: CustomerProfile }>('/customer/profile', {
        method: 'PUT',
        body: {
          name: value.trim(),
          preferredLanguage: i18n.language as Language,
          acceptPrivacy: true,
        },
      });
      qc.setQueryData(profileKey, r.customer);
      await reload();
      if (r.customer.addresses.length) router.replace('/(customer)/home');
      else router.replace({ pathname: '/(customer)/address', params: { first: '1' } });
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
          label={t('profile.continue')}
          disabled={!nameOk || !accepted || busy}
          onPress={() => void save()}
        />
      }
    >
      <Header title={t('profile.welcomeTitle')} />
      <Text muted>{t('profile.welcomeBody')}</Text>
      <TextField
        label={t('profile.nameLabel')}
        value={value}
        onChangeText={setName}
        autoComplete="name"
        textContentType="name"
        autoCapitalize="words"
        maxLength={80}
      />
      <View style={styles.langRow}>
        <View style={styles.flex}>
          <Button
            variant="secondary"
            label="English"
            selected={i18n.language === 'en'}
            onPress={() => void setLanguage('en')}
            compact
          />
        </View>
        <View style={styles.flex}>
          <Button
            variant="secondary"
            label="മലയാളം"
            selected={i18n.language === 'ml'}
            onPress={() => void setLanguage('ml')}
            compact
          />
        </View>
      </View>
      <View style={styles.notice}>
        <Text variant="label">{t('profile.privacyTitle')}</Text>
        <Text variant="caption">{t('profile.privacyBody')}</Text>
      </View>
      <Pressable
        accessibilityRole="checkbox"
        accessibilityState={{ checked: accepted }}
        aria-checked={accepted}
        onPress={() => setAccepted((a) => !a)}
        style={styles.check}
      >
        <View style={[styles.box, accepted && styles.boxOn]}>
          {accepted ? <Icon name="check" color={colors.onPrimary} size={18} /> : null}
        </View>
        <Text style={styles.flex}>{t('profile.privacyAccept')}</Text>
      </Pressable>
      {error ? <Message tone="warning" text={error} /> : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  langRow: { flexDirection: 'row', gap: spacing.md },
  flex: { flex: 1 },
  notice: {
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    padding: spacing.lg,
    gap: spacing.xs,
    borderWidth: 1,
    borderColor: colors.border,
  },
  check: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, minHeight: 48 },
  box: {
    width: 28,
    height: 28,
    borderRadius: 8,
    borderWidth: 2,
    borderColor: colors.borderStrong,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
  },
  boxOn: { backgroundColor: colors.primary, borderColor: colors.primary },
});
