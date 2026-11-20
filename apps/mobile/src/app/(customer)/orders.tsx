import { Pressable, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { colors, spacing } from '@wtrdrop/design-tokens';
import { TERMINAL_STATUSES, formatINR } from '@wtrdrop/shared';
import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { CustomerNav } from '../../components/CustomerNav';
import { Header } from '../../components/Header';
import { Screen } from '../../components/Screen';
import { ErrorState, Skeleton } from '../../components/States';
import { StatusChip } from '../../components/StatusChip';
import { Text } from '../../components/Text';
import { errorText } from '../../lib/errors';
import { orderNo, useMyOrders, windowLabel } from '../../lib/orders';
import { STATUS_LOOK } from '../../lib/status';

/** Order history: status in words, one-tap reorder, and open orders can be checked or cancelled. */
export default function MyOrders() {
  const { t, i18n } = useTranslation();
  const orders = useMyOrders();
  return (
    <Screen nav={<CustomerNav />}>
      <Header title={t('customer.ordersTitle')} />
      {orders.isPending ? <Skeleton lines={4} /> : null}
      {orders.isError ? (
        <ErrorState message={errorText(t, orders.error)} onRetry={() => void orders.refetch()} />
      ) : null}
      {orders.data?.length === 0 ? (
        <Card>
          <Text variant="title">{t('order.noneYet')}</Text>
          <Button label={t('order.first')} onPress={() => router.push('/(customer)/order')} />
        </Card>
      ) : null}
      {orders.data?.map((o) => {
        const look = STATUS_LOOK[o.status];
        const open = !TERMINAL_STATUSES.includes(o.status);
        const when = windowLabel(
          t,
          {
            date: o.deliveryDate,
            nameEn: o.windowNameEn,
            nameMl: o.windowNameMl,
            startTime: o.windowStart,
            endTime: o.windowEnd,
          },
          i18n.language,
        );
        return (
          <Card key={o.id}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`${orderNo(o.orderNo)}, ${t(`status.${o.status}`)}`}
              onPress={() => router.push({ pathname: '/(customer)/placed', params: { id: o.id } })}
            >
              <Text variant="title">
                {t('customer.cansAndPrice', { count: o.qty, price: formatINR(o.totalPaise) })}
              </Text>
              <Text muted>
                {when} · {orderNo(o.orderNo)}
              </Text>
            </Pressable>
            <StatusChip label={t(`status.${o.status}`)} tone={look.tone} icon={look.icon} />
            <View style={styles.actions}>
              {open ? (
                <Pressable
                  accessibilityRole="button"
                  onPress={() =>
                    router.push({ pathname: '/(customer)/placed', params: { id: o.id } })
                  }
                  style={styles.link}
                >
                  <Text variant="label" color={colors.primary}>
                    {o.canCancel ? t('order.detailsOrCancel') : t('order.details')}
                  </Text>
                </Pressable>
              ) : (
                <Button
                  compact
                  label={t('customer.reorder')}
                  onPress={() =>
                    router.push({ pathname: '/(customer)/order', params: { qty: String(o.qty) } })
                  }
                />
              )}
            </View>
          </Card>
        );
      })}
    </Screen>
  );
}

const styles = StyleSheet.create({
  actions: { gap: spacing.xs },
  link: { alignSelf: 'flex-start', minHeight: 44, justifyContent: 'center' },
});
