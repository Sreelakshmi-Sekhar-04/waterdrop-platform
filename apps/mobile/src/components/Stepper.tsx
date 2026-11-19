import { Platform, Pressable, StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { colors, radii, spacing, touchTarget } from '@wtrdrop/design-tokens';
import { Text } from './Text';

interface Props {
  value: number;
  onChange: (next: number) => void;
  min?: number;
  max?: number;
  /** Spoken label, e.g. "Full cans given". */
  label: string;
  size?: 'large' | 'medium';
}

const isWeb = Platform.OS === 'web';

/** Big − / + control for counting cans. No typing needed. */
export function Stepper({ value, onChange, min = 0, max = 99, label, size = 'large' }: Props) {
  const { t } = useTranslation();
  const box = size === 'large' ? 60 : Math.max(52, touchTarget.min);
  const canLess = value > min;
  const canMore = value < max;
  return (
    <View
      style={styles.row}
      // Native screen readers get one swipe-adjustable control. The web has no such role
      // with buttons inside, so there it is a labelled group of two buttons.
      accessible={!isWeb}
      accessibilityRole={isWeb ? undefined : 'adjustable'}
      role={isWeb ? 'group' : undefined}
      accessibilityLabel={label}
      accessibilityValue={isWeb ? undefined : { min, max, now: value }}
      accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
      onAccessibilityAction={(e) => {
        if (e.nativeEvent.actionName === 'increment' && canMore) onChange(value + 1);
        if (e.nativeEvent.actionName === 'decrement' && canLess) onChange(value - 1);
      }}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('a11y.less', { label })}
        disabled={!canLess}
        onPress={() => onChange(value - 1)}
        style={[styles.btn, styles.less, { width: box, height: box }, !canLess && styles.off]}
      >
        <Text variant="heading" style={styles.sign}>
          −
        </Text>
      </Pressable>
      <Text variant={size === 'large' ? 'display' : 'heading'} style={styles.value}>
        {value}
      </Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('a11y.more', { label })}
        disabled={!canMore}
        onPress={() => onChange(value + 1)}
        style={[styles.btn, styles.more, { width: box, height: box }, !canMore && styles.off]}
      >
        <Text variant="heading" color={colors.onPrimary} style={styles.sign}>
          +
        </Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  btn: { borderRadius: radii.md, alignItems: 'center', justifyContent: 'center' },
  less: { borderWidth: 2, borderColor: colors.borderStrong, backgroundColor: colors.surface },
  more: { backgroundColor: colors.primary },
  off: { opacity: 0.35 },
  sign: { lineHeight: 34 },
  value: { minWidth: 44, textAlign: 'center' },
});
