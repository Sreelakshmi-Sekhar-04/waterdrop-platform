import type { ReactNode } from 'react';
import { StyleSheet, View, type ViewStyle } from 'react-native';
import { colors, radii, spacing } from '@wtrdrop/design-tokens';

type Tone = 'plain' | 'mist' | 'primary' | 'highlight';

/** Rounded card. `highlight` is the "next action" card (blue border). */
export function Card({
  children,
  tone = 'plain',
  style,
}: {
  children: ReactNode;
  tone?: Tone;
  style?: ViewStyle;
}) {
  return <View style={[styles.base, styles[tone], style]}>{children}</View>;
}

const shadow = {
  shadowColor: colors.ink,
  shadowOpacity: 0.08,
  shadowRadius: 3,
  shadowOffset: { width: 0, height: 1 },
  elevation: 1,
};

const styles = StyleSheet.create({
  base: { borderRadius: radii.xl, padding: spacing.xl, gap: spacing.md },
  plain: { backgroundColor: colors.surface, ...shadow },
  mist: { backgroundColor: colors.mist, padding: spacing.lg },
  primary: { backgroundColor: colors.primary },
  highlight: {
    backgroundColor: colors.surface,
    borderWidth: 2,
    borderColor: colors.primary,
    ...shadow,
    elevation: 3,
  },
});
