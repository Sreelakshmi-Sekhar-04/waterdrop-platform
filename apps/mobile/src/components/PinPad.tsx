import { Pressable, StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { colors, radii, spacing } from '@wtrdrop/design-tokens';
import { Icon } from './Icon';
import { Text } from './Text';

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', 'del'] as const;

/** Big number keys for a 4-digit PIN: no keyboard, no typing mistakes from small keys. */
export function PinPad({
  value,
  onChange,
  label,
  disabled,
}: {
  value: string;
  onChange: (v: string) => void;
  label: string;
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  return (
    <View style={styles.wrap}>
      <View
        style={styles.dots}
        accessible
        // A label needs a role on the web; "image" reads the count as one item. Announced as it changes.
        accessibilityRole="image"
        accessibilityLiveRegion="polite"
        accessibilityLabel={t('pin.entered', { count: value.length, label })}
      >
        {[0, 1, 2, 3].map((i) => (
          <View key={i} style={[styles.dot, i < value.length && styles.dotOn]} />
        ))}
      </View>
      <View style={styles.grid}>
        {KEYS.map((k, i) =>
          k === '' ? (
            <View key={i} style={styles.key} />
          ) : (
            <Pressable
              key={i}
              accessibilityRole="button"
              accessibilityLabel={k === 'del' ? t('pin.delete') : k}
              disabled={disabled || (k !== 'del' && value.length >= 4) || (k === 'del' && !value)}
              onPress={() => onChange(k === 'del' ? value.slice(0, -1) : value + k)}
              style={({ pressed }) => [styles.key, styles.keyBox, pressed && styles.pressed]}
            >
              {k === 'del' ? (
                <Icon name="back" />
              ) : (
                <Text variant="heading" style={styles.digit}>
                  {k}
                </Text>
              )}
            </Pressable>
          ),
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', gap: spacing.xl },
  dots: { flexDirection: 'row', gap: spacing.lg, paddingVertical: spacing.sm },
  dot: { width: 18, height: 18, borderRadius: 9, borderWidth: 2, borderColor: colors.borderStrong },
  dotOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  grid: { flexDirection: 'row', flexWrap: 'wrap', width: 264, gap: 12 },
  key: { width: 80, height: 64 },
  keyBox: {
    borderRadius: radii.md,
    backgroundColor: colors.surface,
    borderWidth: 2,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pressed: { backgroundColor: colors.mist },
  digit: { lineHeight: 34 },
});
