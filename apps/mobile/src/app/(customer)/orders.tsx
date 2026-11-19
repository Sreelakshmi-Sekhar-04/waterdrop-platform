import { Pressable, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { colors, spacing } from '@wtrdrop/design-tokens';
import { formatINR } from '@wtrdrop/shared';
import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { CustomerNav } from '../../components/CustomerNav';
import { Header } from '../../components/Header';
import { Screen } from '../../components/Screen';
import { StatusChip } from '../../components/StatusChip';
import { Text } from '../../components/Text';
import { demoOrders } from '../../demo/fixtures';
import { STATUS_LOOK } from '../../lib/status';

/** Order history: status in words, one-tap reorder, and the place to report a problem. */
export default function MyOrders() {
  const { t } = useTranslation();
  return (
    <Screen nav={<CustomerNav />}>
      <Header title={t('customer.ordersTitle')} />
      {demoOrders.map((o) => {
        const look = STATUS_LOOK[o.status];
        return (
          <Card key={o.id}>
            <View style={styles.top}>
              <View style={styles.flex}>
                <Text variant="title">
                  {t('customer.cansAndPrice', { count: o.qty, price: formatINR(o.totalPaise) })}
                </Text>
                <Text muted>
                  {o.date} · {o.id}
                </Text>
              </View>
            </View>
            <StatusChip label={t(`status.${o.status}`)} tone={look.tone} icon={look.icon} />
            {o.status === 'DELIVERED' ? (
              <View style={styles.actions}>
                <Button
                  compact
                  label={t('customer.reorder')}
                  onPress={() => router.push('/(customer)/order')}
                />
                <Pressable
                  accessibilityRole="button"
                  onPress={() => router.push('/(customer)/help')}
                  style={styles.link}
                >
                  <Text variant="label" color={colors.primary}>
                    {t('customer.reportProblem')}
                  </Text>
                </Pressable>
              </View>
            ) : null}
          </Card>
        );
      })}
    </Screen>
  );
}

const styles = StyleSheet.create({
  top: { flexDirection: 'row', alignItems: 'center' },
  actions: { gap: spacing.xs },
  link: { alignSelf: 'center', minHeight: 44, justifyContent: 'center' },
  flex: { flex: 1 },
});
