import { Pressable, StyleSheet, View } from 'react-native';
import { router, usePathname, type Href } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, spacing } from '@wtrdrop/design-tokens';
import { Icon, type IconName } from './Icon';
import { Text } from './Text';

export interface NavItem {
  href: Href;
  path: string;
  label: string;
  icon: IconName;
}

/** Three tabs at most, each with icon and word. */
export function BottomNav({ items }: { items: NavItem[] }) {
  const pathname = usePathname();
  const insets = useSafeAreaInsets();
  return (
    <View
      accessibilityRole="tablist"
      style={[styles.bar, { paddingBottom: Math.max(insets.bottom, spacing.md) }]}
    >
      {items.map((item) => {
        const on = pathname === item.path;
        const color = on ? colors.primary : colors.inkMuted;
        return (
          <Pressable
            key={item.path}
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}
            onPress={() => !on && router.replace(item.href)}
            style={styles.item}
          >
            <Icon name={item.icon} size={26} color={color} />
            <Text variant="label" color={color}>
              {item.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: spacing.sm,
  },
  item: { flex: 1, alignItems: 'center', gap: 2, minHeight: 52, justifyContent: 'center' },
});
