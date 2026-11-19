import { StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, spacing } from '@wtrdrop/design-tokens';
import { Text } from './Text';

export function PreviewBanner() {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.banner, { paddingTop: insets.top + spacing.sm }]}>
      <Text variant="label" color={colors.warning}>
        {t('common.previewBanner')}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    backgroundColor: colors.warningSoft,
    paddingHorizontal: spacing.xl,
    paddingBottom: spacing.sm,
  },
});
