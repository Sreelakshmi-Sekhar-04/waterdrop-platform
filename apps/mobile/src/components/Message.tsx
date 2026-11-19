import { StyleSheet, View } from 'react-native';
import { colors, radii, spacing } from '@wtrdrop/design-tokens';
import { Icon, type IconName } from './Icon';
import { Text } from './Text';

type Tone = 'info' | 'success' | 'warning';
const TONES: Record<Tone, { bg: string; fg: string; icon: IconName }> = {
  info: { bg: colors.mist, fg: colors.primaryPressed, icon: 'note' },
  success: { bg: colors.successSoft, fg: colors.success, icon: 'check' },
  warning: { bg: colors.warningSoft, fg: colors.warning, icon: 'alert' },
};

/** Inline message that tells the user what happened and what to do next. */
export function Message({
  tone = 'info',
  text,
  icon,
}: {
  tone?: Tone;
  text: string;
  icon?: IconName;
}) {
  const t = TONES[tone];
  return (
    <View
      style={[styles.box, { backgroundColor: t.bg }]}
      accessibilityRole={tone === 'warning' ? 'alert' : 'text'}
    >
      <Icon name={icon ?? t.icon} color={t.fg} />
      <Text style={styles.text} color={tone === 'info' ? colors.ink : t.fg}>
        {text}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.lg,
    borderRadius: radii.lg,
  },
  text: { flex: 1 },
});
