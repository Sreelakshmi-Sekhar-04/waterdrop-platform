import { Pressable, StyleSheet, View } from 'react-native';
import { colors, radii, spacing, touchTarget } from '@wtrdrop/design-tokens';
import { Icon, type IconName } from './Icon';
import { Text } from './Text';

type Variant = 'primary' | 'secondary' | 'warning' | 'onPrimary';

interface Props {
  label: string;
  onPress?: () => void;
  variant?: Variant;
  disabled?: boolean;
  selected?: boolean;
  icon?: IconName;
  accessibilityHint?: string;
  compact?: boolean;
}

const LOOK: Record<Variant, { bg: string; fg: string; border?: string; pressed: string }> = {
  primary: { bg: colors.primary, fg: colors.onPrimary, pressed: colors.primaryPressed },
  secondary: {
    bg: colors.surface,
    fg: colors.ink,
    border: colors.borderStrong,
    pressed: colors.mist,
  },
  warning: {
    bg: colors.surface,
    fg: colors.warning,
    border: colors.warning,
    pressed: colors.warningSoft,
  },
  onPrimary: { bg: colors.surface, fg: colors.primary, pressed: colors.mist },
};

/** Large, high-contrast button. One primary button per screen. */
export function Button({
  label,
  onPress,
  variant = 'primary',
  disabled,
  selected,
  icon,
  accessibilityHint,
  compact,
}: Props) {
  const look = LOOK[variant];
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: !!disabled, selected: !!selected }}
      accessibilityHint={accessibilityHint}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.base,
        compact && styles.compact,
        { backgroundColor: pressed && !disabled ? look.pressed : look.bg },
        look.border ? { borderWidth: 2, borderColor: look.border } : null,
        selected && styles.selected,
        disabled && styles.disabled,
      ]}
    >
      <View style={styles.inner}>
        {icon ? <Icon name={icon} color={selected ? colors.primaryPressed : look.fg} /> : null}
        <Text
          variant="title"
          color={selected ? colors.primaryPressed : look.fg}
          style={styles.label}
        >
          {label}
        </Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    minHeight: touchTarget.primaryButtonHeight,
    borderRadius: radii.md,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xl,
  },
  compact: { minHeight: 50 },
  inner: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  selected: { borderColor: colors.primary, backgroundColor: colors.mist },
  disabled: { opacity: 0.5 },
  label: { textAlign: 'center' },
});
