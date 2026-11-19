import { StyleSheet, View } from 'react-native';
import { colors, radii, spacing } from '@wtrdrop/design-tokens';
import { Icon, type IconName } from './Icon';
import { Text } from './Text';

export type ChipTone = 'info' | 'success' | 'warning' | 'neutral' | 'solid';

const TONES: Record<ChipTone, { bg: string; fg: string }> = {
  info: { bg: colors.mist, fg: colors.primaryPressed },
  success: { bg: colors.successSoft, fg: colors.success },
  warning: { bg: colors.warningSoft, fg: colors.warning },
  neutral: { bg: colors.background, fg: colors.inkMuted },
  solid: { bg: colors.primary, fg: colors.onPrimary },
};

/** Status is always an icon plus a word, never colour alone. */
export function StatusChip({
  label,
  tone = 'info',
  icon,
}: {
  label: string;
  tone?: ChipTone;
  icon?: IconName;
}) {
  const t = TONES[tone];
  return (
    <View style={[styles.chip, { backgroundColor: t.bg }]}>
      {icon ? <Icon name={icon} size={15} color={t.fg} strokeWidth={2.8} /> : null}
      <Text variant="label" color={t.fg}>
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: spacing.xs + 2,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radii.pill,
  },
});
