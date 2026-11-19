import { useState } from 'react';
import { StyleSheet, View, Pressable } from 'react-native';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { colors, spacing } from '@wtrdrop/design-tokens';
import { formatINR } from '@wtrdrop/shared';
import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { Icon } from '../../components/Icon';
import { Message } from '../../components/Message';
import { Screen } from '../../components/Screen';
import { Text } from '../../components/Text';
import { demoCustomer, demoSettings, demoSlots } from '../../demo/fixtures';

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

/** Confirmation and tracking in one place: what happens next and what to keep ready. */
export default function OrderPlaced() {
  const { t } = useTranslation();
  const [cancelTapped, setCancelTapped] = useState(false);
  const qty = demoCustomer.usualQty;
  const when = demoSlots[0].label;
  const amount = formatINR(qty * demoSettings.pricePerCanPaise);

  return (
    <Screen
      footer={
        <>
          <Button label={t('customer.done')} onPress={() => router.replace('/(customer)/home')} />
          <Pressable
            accessibilityRole="button"
            onPress={() => setCancelTapped(true)}
            style={styles.cancel}
          >
            <Text variant="label" muted>
              {t('customer.cancelOrder')}
            </Text>
          </Pressable>
        </>
      }
    >
      <View style={styles.hero}>
        <View style={styles.bigCheck}>
          <Icon name="check" size={44} color={colors.success} strokeWidth={3} />
        </View>
        <Text variant="heading" accessibilityRole="header">
          {t('customer.placedTitle')}
        </Text>
        <Text variant="bodyLarge" style={styles.centerText}>
          {t('customer.placedBody', { count: qty, when })}
        </Text>
      </View>

      <Card>
        <Step state="done" title={t('customer.stepReceived')} hint="10:52 am" />
        <Step
          state="current"
          title={t('customer.stepOnTheWay')}
          hint={t('customer.stepOnTheWayHint')}
        />
        <Step state="todo" title={t('customer.stepDelivered')} />
      </Card>

      <Card tone="mist">
        <Text variant="title">{t('customer.whenVanArrives')}</Text>
        <View style={styles.line}>
          <Icon name="cash" color={colors.primaryPressed} />
          <Text style={styles.flex}>{t('customer.payAmount', { amount })}</Text>
        </View>
        <View style={styles.line}>
          <Icon name="swap" color={colors.primaryPressed} />
          <Text style={styles.flex}>
            {t('customer.keepEmpties', { count: demoCustomer.cansHeld })}
          </Text>
        </View>
      </Card>
      {cancelTapped ? <Message tone="info" text={t('common.simulated')} /> : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  hero: { alignItems: 'center', gap: spacing.md, paddingTop: spacing.xxl },
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
