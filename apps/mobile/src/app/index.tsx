import { StyleSheet, View } from 'react-native';
import { Link, Redirect } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { colors, spacing } from '@wtrdrop/design-tokens';
import { Button } from '../components/Button';
import { LogoMark } from '../components/Logo';
import { Screen } from '../components/Screen';
import { Text } from '../components/Text';
import { setLanguage } from '../i18n';
import { homeFor, useSession } from '../lib/session';

/** First screen: brand, one-tap language choice, then sign-in (Phase 3). */
export default function Welcome() {
  const { t, i18n } = useTranslation();
  const session = useSession();
  const home = session ? homeFor(session.role) : null;
  if (home) return <Redirect href={home} />;

  return (
    <Screen
      footer={
        <>
          <Button
            label={t('welcome.continue')}
            disabled
            accessibilityHint={t('welcome.signInLater')}
          />
          <Text variant="caption" muted style={styles.center}>
            {t('welcome.signInLater')}
          </Text>
        </>
      }
    >
      <View style={styles.hero}>
        <LogoMark size={112} />
        <Text variant="display" style={styles.center}>
          Wtr
          <Text variant="display" color={colors.primary}>
            Drop
          </Text>
        </Text>
        <Text variant="body" muted style={styles.center}>
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
        <View style={styles.dev}>
          <Text variant="label" muted>
            {t('welcome.devPreview')}
          </Text>
          <Link href="/(customer)/home" style={styles.link}>
            <Text variant="label" color={colors.primary}>
              Customer · Home
            </Text>
          </Link>
          <Link href="/(staff)/route" style={styles.link}>
            <Text variant="label" color={colors.primary}>
              Staff · Today's route
            </Text>
          </Link>
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
  dev: { gap: spacing.sm, marginTop: spacing.xl },
  link: { paddingVertical: spacing.md },
});
