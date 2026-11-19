import { Pressable, StyleSheet, View } from 'react-native';
import { colors, radii, touchTarget } from '@wtrdrop/design-tokens';
import { Text } from './Text';

interface Props {
  label: string;
  onPress?: () => void;
  variant?: 'primary' | 'secondary';
  disabled?: boolean;
  selected?: boolean;
  accessibilityHint?: string;
}

/** Large, high-contrast button. One primary button per screen. */
export function Button({
  label,
  onPress,
  variant = 'primary',
  disabled,
  selected,
  accessibilityHint,
}: Props) {
  const primary = variant === 'primary';
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: !!disabled, selected: !!selected }}
      accessibilityHint={accessibilityHint}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.base,
        primary ? styles.primary : styles.secondary,
        selected && styles.selected,
        pressed && !disabled && (primary ? styles.primaryPressed : styles.secondaryPressed),
        disabled && styles.disabled,
      ]}
    >
      <View>
        <Text
          variant="title"
          color={primary ? colors.onPrimary : colors.primary}
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
    paddingHorizontal: 20,
  },
  primary: { backgroundColor: colors.primary },
  primaryPressed: { backgroundColor: colors.primaryPressed },
  secondary: { backgroundColor: colors.surface, borderWidth: 2, borderColor: colors.borderStrong },
  secondaryPressed: { backgroundColor: colors.mist },
  selected: { borderColor: colors.primary, backgroundColor: colors.mist },
  disabled: { opacity: 0.5 },
  label: { textAlign: 'center' },
});
