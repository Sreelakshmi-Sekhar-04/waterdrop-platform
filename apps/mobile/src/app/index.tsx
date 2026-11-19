import { StyleSheet, View } from 'react-native';
import { Link, Redirect, router, type Href } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { colors, spacing } from '@wtrdrop/design-tokens';
import { Button } from '../components/Button';
import { LogoMark } from '../components/Logo';
import { Screen } from '../components/Screen';
import { Text } from '../components/Text';
import { setLanguage } from '../i18n';
import { homeFor, useSession } from '../lib/session';

const PREVIEW_LINKS: { href: Href; label: string }[] = [
  { href: '/(customer)/home', label: 'Customer · Home' },
  { href: '/(customer)/order', label: 'Customer · Order' },
  { href: '/(customer)/placed', label: 'Customer · Order placed' },
  { href: '/(customer)/orders', label: 'Customer · My orders' },
  { href: '/(customer)/help', label: 'Customer · Help' },
  { href: '/(staff)/route', label: "Staff · Today's route" },
  { href: { pathname: '/(staff)/deliver', params: { stop: '10' } }, label: 'Staff · Delivered' },
  {
    href: { pathname: '/(staff)/not-delivered', params: { stop: '10' } },
    label: "Staff · Couldn't deliver",
  },
  { href: '/states', label: 'Loading, empty and error states' },
];

/** First screen: brand, one-tap language choice, then sign-in. */
export default function Welcome() {
  const { t, i18n } = useTranslation();
  const session = useSession();
  const home = session ? homeFor(session.role) : null;
  if (home) return <Redirect href={home} />;

  return (
    <Screen
      footer={<Button label={t('welcome.continue')} onPress={() => router.push('/(auth)/phone')} />}
    >
      <View style={styles.hero}>
        <LogoMark size={112} />
        <Text variant="display" style={styles.center}>
          Wtr
          <Text variant="display" color={colors.primary}>
            Drop
          </Text>
        </Text>
        <Text muted style={styles.center}>
          {t('welcome.tagline')}
        </Text>
      </View>

      <Text variant="title">{t('welcome.chooseLanguage')}</Text>
      <View style={styles.row}>
        <View style={styles.flex}>
          <Button
            variant="secondary"
            label="English"
            selected={i18n.language === 'en'}
            onPress={() => void setLanguage('en')}
          />
        </View>
        <View style={styles.flex}>
          <Button
            variant="secondary"
            label="മലയാളം"
            selected={i18n.language === 'ml'}
            onPress={() => void setLanguage('ml')}
          />
        </View>
      </View>

      {__DEV__ ? (
        <View style={styles.dev} testID="dev-preview">
          <Text variant="label" muted>
            {t('welcome.devPreview')}
          </Text>
          {PREVIEW_LINKS.map((l) => (
            <Link key={l.label} href={l.href} style={styles.link}>
              <Text variant="label" color={colors.primary}>
                {l.label}
              </Text>
            </Link>
          ))}
        </View>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  hero: { alignItems: 'center', gap: spacing.md, paddingVertical: spacing.xxxl },
  center: { textAlign: 'center' },
  row: { flexDirection: 'row', gap: spacing.md },
  flex: { flex: 1 },
  dev: { gap: spacing.xs, marginTop: spacing.xl },
  link: { paddingVertical: spacing.sm },
});
