import { StyleSheet, View, Pressable } from 'react-native';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { colors, spacing } from '@wtrdrop/design-tokens';
import { TERMINAL_STATUSES, formatINR } from '@wtrdrop/shared';
import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { CustomerNav } from '../../components/CustomerNav';
import { Icon } from '../../components/Icon';
import { Message } from '../../components/Message';
import { Screen } from '../../components/Screen';
import { ErrorState, Skeleton } from '../../components/States';
import { StatusChip } from '../../components/StatusChip';
import { Text } from '../../components/Text';
import { areaLabel, useAccount, useProfile } from '../../lib/customer';
import { errorText } from '../../lib/errors';
import { orderNo, quoteFor, useMyOrders, useOrderOptions, windowLabel } from '../../lib/orders';
import { STATUS_LOOK } from '../../lib/status';

/**
 * The 2-tap reorder home: the usual order is one big button, which opens the pre-filled order
 * screen. Below it: the cans the customer holds and the amount due, from the ledgers (Phase 5).
 */
export default function CustomerHome() {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const profile = useProfile();
  const options = useOrderOptions();
  const orders = useMyOrders();
  const account = useAccount();
  const acc = account.data;
  const o = options.data;
  const address = profile.data?.addresses.find((a) => a.id === o?.addressId);
  const open = orders.data?.filter((x) => !TERMINAL_STATUSES.includes(x.status)) ?? [];
  const next = o?.windows[0];

  return (
    <Screen nav={<CustomerNav />}>
      <View>
        <Text muted>{t('customer.greeting', { name: profile.data?.name ?? '' })}</Text>
        <Text variant="heading" accessibilityRole="header">
          {t('customer.homeTitle')}
        </Text>
      </View>

      {options.isPending ? <Skeleton lines={3} /> : null}
      {options.isError ? (
        <ErrorState message={errorText(t, options.error)} onRetry={() => void options.refetch()} />
      ) : null}

      {o && address ? (
        <Card tone="primary">
          <Text variant="label" color={colors.onPrimary}>
            {t('customer.usualOrder')}
          </Text>
          <Text variant="heading" color={colors.onPrimary}>
            {t('customer.cansAndPrice', {
              count: o.defaultQty,
              price: formatINR(quoteFor(o, o.defaultQty).totalPaise),
            })}
          </Text>
          <Text color={colors.onPrimary}>
            {next
              ? t('customer.arrives', { place: address.label, when: windowLabel(t, next, lang) })
              : `${address.label} · ${areaLabel(address, lang)}`}
          </Text>
          <Button
            variant="onPrimary"
            label={t('customer.orderAgain', { count: o.defaultQty })}
            onPress={() => router.push('/(customer)/order')}
            disabled={!next}
          />
          <Pressable
            accessibilityRole="button"
            onPress={() => router.push('/(customer)/order')}
            style={styles.link}
          >
            <Text variant="label" color={colors.onPrimary} style={styles.underline}>
              {t('customer.changeOrder')}
            </Text>
          </Pressable>
        </Card>
      ) : null}
      {o && !next ? <Message tone="warning" text={t('order.noWindows')} /> : null}
      {o && !address ? (
        <Button label={t('order.addAddress')} onPress={() => router.push('/(customer)/address')} />
      ) : null}

      {acc ? (
        <View style={styles.tiles}>
          <Card style={styles.tile}>
            <Text variant="label" muted>
              {t('customer.cansWithYou')}
            </Text>
            <Text variant="heading" testID="cans-held">
              {acc.cansHeld}
            </Text>
            {acc.cansHeld > 0 ? <Text muted>{t('customer.cansWithYouHint')}</Text> : null}
          </Card>
          <Card style={styles.tile}>
            <Text variant="label" muted>
              {t('customer.amountDue')}
            </Text>
            {acc.balancePaise > 0 ? (
              <>
                <Text variant="heading" testID="amount-due">
                  {formatINR(acc.balancePaise)}
                </Text>
                <Text muted>{t('customer.payOnDelivery')}</Text>
              </>
            ) : (
              <Text variant="title" testID="amount-due">
                {t('customer.allPaid')}
              </Text>
            )}
          </Card>
        </View>
      ) : null}
      {acc ? (
        <Button
          variant="secondary"
          compact
          label={t('statement.open')}
          onPress={() => router.push('/(customer)/statement')}
        />
      ) : null}

      {open.map((x) => {
        const look = STATUS_LOOK[x.status];
        return (
          <Card key={x.id} style={styles.orderRow}>
            <View style={styles.iconBox}>
              <Icon name="truck" color={colors.primary} />
            </View>
            <Pressable
              accessibilityRole="button"
              style={styles.flex}
              onPress={() => router.push({ pathname: '/(customer)/placed', params: { id: x.id } })}
            >
              <Text variant="title">
                {t('order.number', { no: orderNo(x.orderNo) })} ·{' '}
                {t('customer.cansAndPrice', { count: x.qty, price: formatINR(x.totalPaise) })}
              </Text>
              <Text muted>
                {windowLabel(
                  t,
                  {
                    date: x.deliveryDate,
                    nameEn: x.windowNameEn,
                    nameMl: x.windowNameMl,
                    startTime: x.windowStart,
                    endTime: x.windowEnd,
                  },
                  lang,
                )}
              </Text>
              <StatusChip label={t(`status.${x.status}`)} tone={look.tone} icon={look.icon} />
            </Pressable>
          </Card>
        );
      })}
    </Screen>
  );
}

const styles = StyleSheet.create({
  link: { alignSelf: 'center', minHeight: 44, justifyContent: 'center' },
  underline: { textDecorationLine: 'underline' },
  orderRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    padding: spacing.lg,
    gap: spacing.md,
  },
  iconBox: {
    width: 44,
    height: 44,
    borderRadius: 14,
    backgroundColor: colors.mist,
    alignItems: 'center',
    justifyContent: 'center',
  },
  flex: { flex: 1, gap: spacing.xs },
  tiles: { flexDirection: 'row', gap: spacing.md },
  tile: { flex: 1, gap: spacing.xs },
});
