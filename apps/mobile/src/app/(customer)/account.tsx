import { Alert, Platform, Pressable, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import { colors, spacing } from '@wtrdrop/design-tokens';
import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { CustomerNav } from '../../components/CustomerNav';
import { Header } from '../../components/Header';
import { Message } from '../../components/Message';
import { Screen } from '../../components/Screen';
import { ErrorState, Skeleton } from '../../components/States';
import { StatusChip } from '../../components/StatusChip';
import { Text } from '../../components/Text';
import { setLanguage } from '../../i18n';
import { api } from '../../lib/api';
import { areaLabel, profileKey, useProfile, type Address } from '../../lib/customer';
import { errorText } from '../../lib/errors';
import { useSessionState } from '../../lib/session';
import { useState } from 'react';

/** Name, phone, language, addresses and sign-out, all on one screen. */
export default function Account() {
  const { t, i18n } = useTranslation();
  const qc = useQueryClient();
  const { signOut } = useSessionState();
  const profile = useProfile();
  const [error, setError] = useState<string | null>(null);

  const changeLanguage = async (lng: 'en' | 'ml') => {
    await setLanguage(lng);
    void api('/me', { method: 'PATCH', body: { preferredLanguage: lng } }).catch(() => undefined);
  };

  const remove = (a: Address) => {
    const go = async () => {
      try {
        await api(`/customer/addresses/${a.id}`, { method: 'DELETE' });
        await qc.invalidateQueries({ queryKey: profileKey });
      } catch (e) {
        setError(errorText(t, e));
      }
    };
    if (Platform.OS === 'web') return void go();
    Alert.alert(t('account.removeTitle'), t('account.removeBody', { label: a.label }), [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('account.remove'), style: 'destructive', onPress: () => void go() },
    ]);
  };

  const p = profile.data;
  return (
    <Screen nav={<CustomerNav />}>
      <Header title={t('account.title')} />
      {profile.isPending ? <Skeleton lines={4} /> : null}
      {profile.isError ? (
        <ErrorState message={errorText(t, profile.error)} onRetry={() => void profile.refetch()} />
      ) : null}
      {p ? (
        <>
          <Card>
            <Text variant="title">{p.name}</Text>
            <Text muted>{`+91 ${p.phone.slice(3, 8)} ${p.phone.slice(8)}`}</Text>
          </Card>
          <Text variant="title">{t('account.language')}</Text>
          <View style={styles.row}>
            <View style={styles.flex}>
              <Button
                variant="secondary"
                compact
                label="English"
                selected={i18n.language === 'en'}
                onPress={() => void changeLanguage('en')}
              />
            </View>
            <View style={styles.flex}>
              <Button
                variant="secondary"
                compact
                label="മലയാളം"
                selected={i18n.language === 'ml'}
                onPress={() => void changeLanguage('ml')}
              />
            </View>
          </View>
          <Text variant="title">{t('account.addresses')}</Text>
          {p.addresses.map((a) => (
            <Card key={a.id}>
              <View style={styles.between}>
                <Text variant="title">{a.label}</Text>
                {a.isDefault ? <StatusChip tone="info" label={t('account.default')} /> : null}
              </View>
              <Text>{a.line}</Text>
              <Text muted>{`${a.landmark} · ${areaLabel(a, i18n.language)} ${a.pincode}`}</Text>
              <View style={styles.actions}>
                <Pressable
                  accessibilityRole="button"
                  style={styles.link}
                  onPress={() =>
                    router.push({ pathname: '/(customer)/address', params: { id: a.id } })
                  }
                >
                  <Text variant="label" color={colors.primary}>
                    {t('account.edit')}
                  </Text>
                </Pressable>
                {!a.isDefault ? (
                  <Pressable
                    accessibilityRole="button"
                    style={styles.link}
                    onPress={() =>
                      void api(`/customer/addresses/${a.id}`, {
                        method: 'PATCH',
                        body: { isDefault: true },
                      }).then(() => qc.invalidateQueries({ queryKey: profileKey }))
                    }
                  >
                    <Text variant="label" color={colors.primary}>
                      {t('account.makeDefault')}
                    </Text>
                  </Pressable>
                ) : null}
                {p.addresses.length > 1 ? (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={t('account.removeLabel', { label: a.label })}
                    style={styles.link}
                    onPress={() => remove(a)}
                  >
                    <Text variant="label" color={colors.warning}>
                      {t('account.remove')}
                    </Text>
                  </Pressable>
                ) : null}
              </View>
            </Card>
          ))}
          <Button
            variant="secondary"
            icon="pin"
            label={t('account.addAddress')}
            onPress={() => router.push('/(customer)/address')}
          />
          {error ? <Message tone="warning" text={error} /> : null}
          <Button
            variant="warning"
            label={t('account.signOut')}
            onPress={() => void signOut().then(() => router.replace('/'))}
          />
        </>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: spacing.md },
  flex: { flex: 1 },
  between: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  actions: { flexDirection: 'row', gap: spacing.xl, flexWrap: 'wrap' },
  link: { minHeight: 48, justifyContent: 'center' },
});
