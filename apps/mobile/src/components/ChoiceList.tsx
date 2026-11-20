import { Pressable, StyleSheet, View } from 'react-native';
import { colors, radii, spacing } from '@wtrdrop/design-tokens';
import { Text } from './Text';

export interface Choice<T extends string> {
  value: T;
  label: string;
  note?: string;
}

interface Props<T extends string> {
  choices: Choice<T>[];
  value: T | null;
  onChange: (v: T) => void;
  label: string;
  layout?: 'column' | 'row';
}

/** One-tap selection: delivery windows, payment method, failure reason. */
export function ChoiceList<T extends string>({
  choices,
  value,
  onChange,
  label,
  layout = 'column',
}: Props<T>) {
  return (
    <View
      accessibilityRole="radiogroup"
      accessibilityLabel={label}
      style={layout === 'row' ? styles.row : styles.column}
    >
      {choices.map((c) => {
        const on = c.value === value;
        return (
          <Pressable
            key={c.value}
            accessibilityRole="radio"
            accessibilityState={{ checked: on }}
            aria-checked={on}
            onPress={() => onChange(c.value)}
            style={[
              styles.item,
              layout === 'row' && styles.rowItem,
              on ? styles.on : styles.offItem,
            ]}
          >
            <Text
              variant="title"
              color={on ? colors.primaryPressed : colors.ink}
              style={layout === 'row' && styles.center}
            >
              {c.label}
            </Text>
            {c.note ? (
              <Text variant="label" color={on ? colors.primaryPressed : colors.inkMuted}>
                {c.note}
              </Text>
            ) : null}
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  column: { gap: spacing.sm },
  row: { flexDirection: 'row', gap: spacing.sm },
  item: {
    minHeight: 54,
    paddingHorizontal: spacing.lg,
    borderRadius: radii.md,
    borderWidth: 2,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  rowItem: { flex: 1, justifyContent: 'center', paddingHorizontal: spacing.sm },
  on: { borderColor: colors.primary, backgroundColor: colors.mist },
  offItem: { borderColor: colors.border, backgroundColor: colors.surface },
  center: { textAlign: 'center' },
});
