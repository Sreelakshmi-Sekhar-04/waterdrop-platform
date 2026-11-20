import { StyleSheet, TextInput, View, type TextInputProps } from 'react-native';
import { useTranslation } from 'react-i18next';
import { colors, fontSizes, radii, spacing } from '@wtrdrop/design-tokens';
import { fontFor } from '../lib/fonts';
import { Text } from './Text';

interface Props extends TextInputProps {
  label: string;
  error?: string | null;
  hint?: string;
  prefix?: string;
}

/** Labelled input with a clear error message under it. */
export function TextField({ label, error, hint, prefix, style, ...rest }: Props) {
  const { i18n } = useTranslation();
  return (
    <View style={styles.wrap}>
      <Text variant="label">{label}</Text>
      <View style={[styles.box, error ? styles.boxError : null]}>
        {prefix ? (
          <Text variant="title" muted>
            {prefix}
          </Text>
        ) : null}
        <TextInput
          accessibilityLabel={label}
          placeholderTextColor={colors.inkMuted}
          style={[styles.input, { fontFamily: fontFor('bold', i18n.language) }, style]}
          {...rest}
        />
      </View>
      {error ? (
        <Text variant="label" color={colors.warning} accessibilityLiveRegion="polite">
          {error}
        </Text>
      ) : hint ? (
        <Text variant="caption" muted>
          {hint}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.sm },
  box: {
    minHeight: 58,
    borderRadius: radii.md,
    borderWidth: 2,
    borderColor: colors.borderStrong,
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.lg,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  boxError: { borderColor: colors.warning },
  input: { flex: 1, fontSize: fontSizes.title, color: colors.ink, paddingVertical: spacing.md },
});
