import type { ReactNode } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, spacing } from '@wtrdrop/design-tokens';

interface Props {
  children: ReactNode;
  /** Pinned main action area, above the keyboard. */
  footer?: ReactNode;
  /** Pinned navigation (bottom tabs). */
  nav?: ReactNode;
}

/** Standard screen: safe area, page background, scrollable body, optional pinned footer and tabs. */
export function Screen({ children, footer, nav }: Props) {
  return (
    <SafeAreaView style={styles.safe} edges={nav ? ['top'] : ['top', 'bottom']}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
          {children}
        </ScrollView>
        {footer ? <View style={styles.footer}>{footer}</View> : null}
      </KeyboardAvoidingView>
      {nav}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  flex: { flex: 1 },
  body: { padding: spacing.xl, gap: spacing.lg },
  footer: {
    padding: spacing.xl,
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
});
