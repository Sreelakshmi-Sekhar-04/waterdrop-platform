import { Pressable, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { colors, radii, spacing } from '@wtrdrop/design-tokens';
import { Icon } from './Icon';
import { Text } from './Text';

/** Screen title with an optional back button (48×48 target). */
export function Header({
  title,
  subtitle,
  back,
}: {
  title: string;
  subtitle?: string;
  back?: boolean;
}) {
  const { t } = useTranslation();
  return (
    <View style={styles.row}>
      {back ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('common.back')}
          onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))}
          style={styles.back}
        >
          <Icon name="back" strokeWidth={2.6} />
        </Pressable>
      ) : null}
      <View style={styles.titles}>
        <Text variant="heading" accessibilityRole="header">
          {title}
        </Text>
        {subtitle ? <Text muted>{subtitle}</Text> : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  back: {
    width: 48,
    height: 48,
    borderRadius: radii.sm,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  titles: { flex: 1 },
});
