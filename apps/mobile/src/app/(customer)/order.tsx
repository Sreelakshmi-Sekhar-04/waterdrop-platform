import { useState } from 'react';
import { StyleSheet, View, Pressable } from 'react-native';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { colors, spacing } from '@wtrdrop/design-tokens';
import { formatINR } from '@wtrdrop/shared';
import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { ChoiceList } from '../../components/ChoiceList';
import { Header } from '../../components/Header';
import { Icon } from '../../components/Icon';
import { Message } from '../../components/Message';
import { Screen } from '../../components/Screen';
import { Stepper } from '../../components/Stepper';
import { Text } from '../../components/Text';
import { demoCustomer, demoSettings, demoSlots } from '../../demo/fixtures';

type SlotId = (typeof demoSlots)[number]['value'];

/** One screen from quantity to "Place order". Everything is pre-filled from the last order. */
export default function OrderScreen() {
  const { t } = useTranslation();
  const [qty, setQty] = useState(demoCustomer.usualQty);
  const [slot, setSlot] = useState<SlotId>(demoSlots[0].value);
  const price = demoSettings.pricePerCanPaise;
  // The customer swaps empties for full cans, so afterwards they hold the larger of the two.
  // Cans beyond what their deposit already covers need a one-time deposit (decision D-04).
  // Preview estimate only: the server calculates the real amount in Phase 4.
  const expectedHeld = Math.max(qty, demoCustomer.cansHeld);
  const newCans = Math.max(0, expectedHeld - demoCustomer.depositCoverCans);
  const deposit = newCans * demoSettings.depositPerCanPaise;
  const total = qty * price + deposit;
  const max = demoSettings.maxCansPerOrder;

  return (
    <Screen
      footer={
        <>
          <View style={styles.summary}>
            <Text muted style={styles.flex}>
              {t('customer.summary', {
                count: qty,
                price: formatINR(price),
                delivery: t('customer.deliveryFree'),
              })}
            </Text>
            <Text variant="title">{formatINR(total)}</Text>
          </View>
          <Button
            label={t('customer.placeOrder', { total: formatINR(total) })}
            onPress={() => router.replace('/(customer)/placed')}
          />
        </>
      }
    >
      <Header title={t('customer.orderTitle')} back />

      <Card>
        <View>
          <Text variant="title">{t('customer.product')}</Text>
          <Text muted>{t('customer.perCan', { price: formatINR(price) })}</Text>
        </View>
        <View style={styles.center}>
          <Stepper value={qty} onChange={setQty} min={1} max={max} label={t('customer.cans')} />
          <Text muted>{t('customer.cans')}</Text>
        </View>
        {qty === max ? <Message tone="info" text={t('customer.maxReached', { max })} /> : null}
      </Card>

      <Card style={styles.addressRow}>
        <Icon name="pin" color={colors.primary} />
        <View style={styles.flex}>
          <Text variant="label" muted>
            {t('customer.deliverTo')}
          </Text>
          <Text variant="title">{demoCustomer.address.label}</Text>
          <Text muted>{demoCustomer.address.line}</Text>
        </View>
        <Pressable accessibilityRole="button" style={styles.change}>
          <Text variant="label" color={colors.primary}>
            {t('customer.change')}
          </Text>
        </Pressable>
      </Card>

      <Text variant="title">{t('customer.when')}</Text>
      <ChoiceList
        label={t('customer.when')}
        value={slot}
        onChange={setSlot}
        choices={demoSlots.map((s) => ({
          value: s.value,
          label: s.label,
          note:
            s.value === slot
              ? t('customer.selected')
              : s.earliest
                ? t('customer.earliest')
                : undefined,
        }))}
      />

      <Message tone="info" icon="cash" text={t('customer.payNote')} />
      {deposit > 0 ? (
        <Message
          tone="info"
          text={t('customer.depositNote', { amount: formatINR(deposit), count: newCans })}
        />
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  center: { alignItems: 'center', gap: spacing.xs },
  addressRow: { flexDirection: 'row', alignItems: 'center', padding: spacing.lg },
  change: { minHeight: 48, justifyContent: 'center', paddingHorizontal: spacing.sm },
  summary: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  flex: { flex: 1 },
});
