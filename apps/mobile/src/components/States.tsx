import { useEffect, useRef } from 'react';
import { Animated, StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { colors, radii, spacing } from '@wtrdrop/design-tokens';
import { Button } from './Button';
import { Icon } from './Icon';
import { Text } from './Text';

/** Placeholder blocks shown while data loads, so the layout does not jump. */
export function Skeleton({ lines = 3 }: { lines?: number }) {
  const { t } = useTranslation();
  const pulse = useRef(new Animated.Value(0.5)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 700, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0.5, duration: 700, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [pulse]);
  return (
    <View
      accessible
      accessibilityLabel={t('states.loading')}
      accessibilityRole="progressbar"
      style={styles.skeleton}
    >
      {Array.from({ length: lines }, (_, i) => (
        <Animated.View
          key={i}
          style={[styles.bar, { opacity: pulse, width: i === 0 ? '60%' : i % 2 ? '100%' : '80%' }]}
        />
      ))}
    </View>
  );
}

/** Something failed: say what, and offer the one action that fixes it. */
export function ErrorState({
  message,
  onRetry,
  offline,
}: {
  message?: string;
  onRetry?: () => void;
  offline?: boolean;
}) {
  const { t } = useTranslation();
  return (
    <View style={styles.error} accessibilityRole="alert">
      <Icon name={offline ? 'cloud-off' : 'alert'} size={36} color={colors.warning} />
      <Text variant="title" style={styles.center}>
        {offline ? t('states.offlineTitle') : t('states.errorTitle')}
      </Text>
      <Text muted style={styles.center}>
        {message ?? (offline ? t('states.offlineBody') : t('states.errorBody'))}
      </Text>
      {onRetry ? <Button variant="secondary" label={t('states.retry')} onPress={onRetry} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  skeleton: {
    backgroundColor: colors.surface,
    borderRadius: radii.xl,
    padding: spacing.xl,
    gap: spacing.md,
  },
  bar: { height: 18, borderRadius: radii.sm, backgroundColor: colors.border },
  error: {
    backgroundColor: colors.surface,
    borderRadius: radii.xl,
    padding: spacing.xxl,
    gap: spacing.md,
    alignItems: 'center',
  },
  center: { textAlign: 'center' },
});
