import { StyleSheet, View } from 'react-native';
import { colors, radii, spacing } from '@wtrdrop/design-tokens';
import { Text } from './Text';

export function EmptyState({ message }: { message: string }) {
  return (
    <View style={styles.card} accessibilityRole="summary">
      <Text muted>{message}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: colors.surface, borderRadius: radii.lg, padding: spacing.xl },
});
