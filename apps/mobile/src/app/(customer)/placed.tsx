import { useState } from 'react';
import { StyleSheet, View, Pressable } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import { colors, spacing } from '@wtrdrop/design-tokens';
import { formatINR } from '@wtrdrop/shared';
import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { Header } from '../../components/Header';
import { Icon } from '../../components/Icon';
import { Message } from '../../components/Message';
import { Screen } from '../../components/Screen';
import { ErrorState, Skeleton } from '../../components/States';
import { StatusChip } from '../../components/StatusChip';
import { Text } from '../../components/Text';
import { api } from '../../lib/api';
import { errorText } from '../../lib/errors';
import { orderNo, ordersKey, useOrder, windowLabel, type OrderDetail } from '../../lib/orders';
import { STATUS_LOOK } from '../../lib/status';

type StepState = 'done' | 'current' | 'todo';

function Step({ state, title, hint }: { state: StepState; title: string; hint?: string }) {
  return (
    <View style={styles.step}>
      <View
        style={[
          styles.dot,
          state === 'done' && styles.dotDone,
          state === 'current' && styles.dotCurrent,
        ]}
      >
        {state === 'done' ? (
          <Icon name="check" size={18} color={colors.onPrimary} strokeWidth={3.2} />
        ) : null}
      </View>
      <View style={styles.flex}>
        <Text variant="title" muted={state === 'todo'}>
          {title}
        </Text>
        {hint ? (
          <Text variant="caption" muted>
            {hint}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

const time = (iso: string, lang: string) =>
  new Date(iso).toLocaleTimeString(lang === 'ml' ? 'ml-IN' : 'en-IN', {
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'Asia/Kolkata',
  });

/** Confirmation and tracking in one place: what happens next, what to keep ready, and cancel. */
export default function OrderPlaced() {
  const { t, i18n } = useTranslation();
  const qc = useQueryClient();
  const { id } = useLocalSearchParams<{ id?: string }>();
  const order = useOrder(id);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const o = order.data;
  const lang = i18n.language;

  if (!id || order.isError) {
    return (
      <Screen>
        <Header title={t('customer.ordersTitle')} back />
        <ErrorState
          message={errorText(t, order.error)}
          onRetry={id ? () => void order.refetch() : undefined}
        />
      </Screen>
    );
  }
  if (!o) {
    return (
      <Screen>
        <Skeleton lines={5} />
      </Screen>
    );
  }

  const cancel = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ order: OrderDetail }>(`/customer/orders/${o.id}/cancel`, {
        method: 'POST',
        body: {},
      });
      qc.setQueryData(['customer', 'order', o.id], r.order);
      await qc.invalidateQueries({ queryKey: ordersKey });
      setConfirming(false);
    } catch (e) {
      setError(errorText(t, e));
    } finally {
      setBusy(false);
    }
  };

  const when = windowLabel(
    t,
    {
      date: o.deliveryDate,
      nameEn: o.windowNameEn,
      nameMl: o.windowNameMl,
      startTime: o.windowStart,
      endTime: o.windowEnd,
    },
    lang,
  );
  const delivered = o.status === 'DELIVERED';
  const placedAt = o.history[0]?.at;
  const ended = o.status === 'CANCELLED' || o.status === 'REJECTED';
  const look = STATUS_LOOK[o.status];

  return (
    <Screen
      footer={
        <>
          <Button label={t('customer.done')} onPress={() => router.replace('/(customer)/home')} />
          {o.canCancel && !confirming ? (
            <Pressable
              accessibilityRole="button"
              onPress={() => setConfirming(true)}
              style={styles.cancel}
            >
              <Text variant="label" muted>
                {t('customer.cancelOrder')}
              </Text>
            </Pressable>
          ) : null}
        </>
      }
    >
      <View style={styles.hero}>
        {ended ? null : (
          <View style={styles.bigCheck}>
            <Icon name="check" size={44} color={colors.success} strokeWidth={3} />
          </View>
        )}
        <Text variant="heading" accessibilityRole="header">
          {ended ? t(`status.${o.status}`) : t('customer.placedTitle')}
        </Text>
        <Text variant="bodyLarge" style={styles.centerText}>
          {t('customer.placedBody', { count: o.qty, when })}
        </Text>
        <Text muted>{t('order.number', { no: orderNo(o.orderNo) })}</Text>
        <StatusChip label={t(`status.${o.status}`)} tone={look.tone} icon={look.icon} />
      </View>

      {confirming ? (
        <Card tone="mist">
          <Text variant="title">{t('order.cancelConfirm')}</Text>
          <Button
            variant="warning"
            label={busy ? t('common.saving') : t('order.cancelYes')}
            onPress={() => void cancel()}
            disabled={busy}
          />
          <Button
            variant="secondary"
            label={t('order.keep')}
            onPress={() => setConfirming(false)}
            disabled={busy}
          />
        </Card>
      ) : null}
      {error ? <Message tone="warning" text={error} /> : null}

      {ended ? null : (
        <Card>
          <Step
            state="done"
            title={t('customer.stepReceived')}
            hint={placedAt ? time(placedAt, lang) : undefined}
          />
          <Step
            state={delivered ? 'done' : 'current'}
            title={t('customer.stepOnTheWay')}
            hint={t('customer.stepOnTheWayHint')}
          />
          <Step state={delivered ? 'done' : 'todo'} title={t('customer.stepDelivered')} />
        </Card>
      )}

      {ended ? null : (
        <Card tone="mist">
          <Text variant="title">{t('customer.whenVanArrives')}</Text>
          <View style={styles.line}>
            <Icon name="cash" color={colors.primaryPressed} />
            <Text style={styles.flex}>
              {t('customer.payAmount', { amount: formatINR(o.totalPaise) })}
            </Text>
          </View>
          {o.depositPaise > 0 ? (
            <Text variant="caption" muted>
              {t('order.depositIncluded', { amount: formatINR(o.depositPaise) })}
            </Text>
          ) : null}
          <View style={styles.line}>
            <Icon name="swap" color={colors.primaryPressed} />
            <Text style={styles.flex}>{t('order.keepEmptiesReady')}</Text>
          </View>
        </Card>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  hero: { alignItems: 'center', gap: spacing.md, paddingTop: spacing.xl },
  bigCheck: {
    width: 84,
    height: 84,
    borderRadius: 42,
    backgroundColor: colors.successSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  centerText: { textAlign: 'center' },
  step: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  dot: {
    width: 32,
    height: 32,
    borderRadius: 16,
    borderWidth: 3,
    borderColor: colors.borderStrong,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
  },
  dotDone: { backgroundColor: colors.success, borderColor: colors.success },
  dotCurrent: { borderColor: colors.primary },
  line: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  cancel: { alignSelf: 'center', minHeight: 44, justifyContent: 'center' },
  flex: { flex: 1 },
});
