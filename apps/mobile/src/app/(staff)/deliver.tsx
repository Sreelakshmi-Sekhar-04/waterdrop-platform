import { useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import * as Crypto from 'expo-crypto';
import { colors, spacing } from '@wtrdrop/design-tokens';
import { deliveryMoney, formatINR, type PaymentMethod } from '@wtrdrop/shared';
import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { ChoiceList } from '../../components/ChoiceList';
import { Header } from '../../components/Header';
import { LogoMark } from '../../components/Logo';
import { Message } from '../../components/Message';
import { Screen } from '../../components/Screen';
import { ErrorState } from '../../components/States';
import { Stepper } from '../../components/Stepper';
import { Text } from '../../components/Text';
import { TextField } from '../../components/TextField';
import { orderNo } from '../../lib/orders';
import { enqueue, useOutbox } from '../../lib/outbox';
import { backToRoute, isOpen, useStaffDay, withPending } from '../../lib/staff';

/**
 * The single "Delivered" screen: full cans, empties and payment, pre-filled. The amounts come from
 * the same shared rule the server uses, so what the delivery person sees is what gets recorded.
 */
export default function Deliver() {
  const { t } = useTranslation();
  const { order = '' } = useLocalSearchParams<{ order?: string }>();
  const q = useStaffDay();
  const box = useOutbox();
  const s = q.data
    ? withPending(q.data, box.queue).stops.find((x) => x.orderId === order)
    : undefined;
  const [full, setFull] = useState<number | null>(null);
  // D-09: empties default to the usual swap, one empty for each full can, as far as they hold cans.
  const [empty, setEmpty] = useState<number | null>(null);
  const [method, setMethod] = useState<PaymentMethod>('cash');
  const [collectAll, setCollectAll] = useState(false);
  const [reference, setReference] = useState('');

  const f = full ?? s?.qty ?? 1;
  const e = empty ?? (s ? Math.min(f, s.cansHeld) : 0);
  const m = useMemo(
    () =>
      s
        ? deliveryMoney({
            full: f,
            empties: e,
            held: s.cansHeld,
            cover: s.depositCoverCans,
            unitPricePaise: s.unitPricePaise,
            deliveryChargePaise: s.deliveryChargePaise,
            depositPerCanPaise: s.depositPerCanPaise,
          })
        : null,
    [s, f, e],
  );
  if (!s || !m || !q.data?.trip)
    return <ErrorState message={t('staff.routeEmpty')} onRetry={backToRoute} />;
  if (!isOpen(s)) {
    backToRoute();
    return null;
  }

  const oldDue = Math.max(0, s.balancePaise);
  const amount = method === 'later' ? 0 : m.totalPaise + (collectAll ? oldDue : 0);
  const name = s.customerName ?? orderNo(s.orderNo);

  const confirm = () => {
    const id = Crypto.randomUUID();
    void enqueue({
      id,
      kind: 'deliver',
      orderId: s.orderId,
      path: `/staff/orders/${s.orderId}/deliver`,
      body: {
        clientActionId: id,
        full: f,
        empties: e,
        payment: {
          method,
          amountPaise: amount,
          ...(method === 'upi' && reference.trim() ? { reference: reference.trim() } : {}),
        },
        at: new Date().toISOString(),
      },
    });
    backToRoute();
  };

  return (
    <Screen
      footer={
        <>
          <Button label={t('staff.confirm')} onPress={confirm} />
          <Text variant="caption" muted style={styles.center}>
            {t('staff.undoHint', { minutes: q.data.undoMinutes })}
          </Text>
        </>
      }
    >
      <Header title={name} subtitle={`${s.address.landmark}, ${s.address.areaName}`} back />

      <Card>
        <View style={styles.line}>
          <View style={styles.flex}>
            <Text variant="title">{t('staff.fullGiven')}</Text>
            <Text variant="caption" muted>
              {t('staff.ordered', { count: s.qty })}
            </Text>
          </View>
          <Stepper
            size="medium"
            value={f}
            onChange={setFull}
            min={1}
            max={s.qty}
            label={t('staff.fullGiven')}
          />
        </View>
        <View style={styles.rule} />
        <View style={styles.line}>
          <View style={styles.flex}>
            <Text variant="title">{t('staff.emptyTaken')}</Text>
            <Text variant="caption" muted>
              {t('staff.theyHad', { count: s.cansHeld })}
            </Text>
          </View>
          <Stepper
            size="medium"
            value={e}
            onChange={setEmpty}
            max={50}
            label={t('staff.emptyTaken')}
          />
        </View>
      </Card>
      {f < s.qty ? <Message tone="info" text={t('staff.short', { count: s.qty - f })} /> : null}

      <View style={styles.result} accessibilityLiveRegion="polite">
        <LogoMark size={28} />
        <Text style={styles.flex}>{t('staff.afterThis', { name, count: m.closing })}</Text>
      </View>
      {m.extraEmpties > 0 ? (
        <Message tone="warning" text={t('staff.extraEmpties', { count: m.extraEmpties })} />
      ) : null}

      <Card>
        <View style={styles.line}>
          <Text variant="title" style={styles.flex}>
            {t('staff.collect')}
          </Text>
          <Text variant="display">{formatINR(amount)}</Text>
        </View>
        <Text variant="caption" muted>
          {t('staff.thisStop', { count: f, goods: formatINR(m.goodsPaise) })}
          {m.deliveryChargePaise
            ? ` + ${t('staff.deliveryCharge', { amount: formatINR(m.deliveryChargePaise) })}`
            : ''}
          {m.depositPaise
            ? ` + ${t('staff.deposit', { count: m.depositCans, amount: formatINR(m.depositPaise) })}`
            : ''}
        </Text>
        {oldDue > 0 && method !== 'later' ? (
          <ChoiceList
            layout="row"
            label={t('staff.howMuch')}
            value={collectAll ? 'all' : 'stop'}
            onChange={(v) => setCollectAll(v === 'all')}
            choices={[
              {
                value: 'stop',
                label: t('staff.onlyThisStop', { amount: formatINR(m.totalPaise) }),
              },
              {
                value: 'all',
                label: t('staff.withOldDue', { amount: formatINR(m.totalPaise + oldDue) }),
              },
            ]}
          />
        ) : null}
        <ChoiceList
          layout="row"
          label={t('staff.howPaid')}
          value={method}
          onChange={setMethod}
          choices={[
            { value: 'cash', label: t('staff.cash') },
            { value: 'upi', label: t('staff.upi') },
            { value: 'later', label: t('staff.later') },
          ]}
        />
        {method === 'upi' ? (
          <TextField
            label={t('staff.upiRef')}
            value={reference}
            onChangeText={setReference}
            maxLength={40}
            autoCapitalize="characters"
          />
        ) : null}
        {method === 'later' ? (
          <Message
            tone="warning"
            text={t('staff.laterNote', { amount: formatINR(oldDue + m.totalPaise) })}
          />
        ) : null}
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  line: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  rule: { height: 1, backgroundColor: colors.border },
  result: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.mist,
    borderRadius: 18,
    padding: spacing.lg,
  },
  center: { textAlign: 'center' },
  flex: { flex: 1 },
});
