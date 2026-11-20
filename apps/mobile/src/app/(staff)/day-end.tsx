import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import * as Crypto from 'expo-crypto';
import { colors, spacing } from '@wtrdrop/design-tokens';
import { formatINR } from '@wtrdrop/shared';
import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { Header } from '../../components/Header';
import { Message } from '../../components/Message';
import { Screen } from '../../components/Screen';
import { ErrorState } from '../../components/States';
import { Stepper } from '../../components/Stepper';
import { Text } from '../../components/Text';
import { TextField } from '../../components/TextField';
import { enqueue, useOutbox } from '../../lib/outbox';
import { backToRoute, useStaffDay } from '../../lib/staff';

/**
 * End of the day (M-03): what should be on the van and in hand is shown; the delivery person
 * counts and confirms. Any difference goes to the office to check.
 */
export default function DayEnd() {
  const { t } = useTranslation();
  const q = useStaffDay();
  const box = useOutbox();
  const tot = q.data?.totals;
  const [full, setFull] = useState<number | null>(null);
  const [empty, setEmpty] = useState<number | null>(null);
  const [damaged, setDamaged] = useState(0);
  const [cash, setCash] = useState<string | null>(null);
  if (!q.data?.trip || !tot)
    return <ErrorState message={t('staff.routeEmpty')} onRetry={backToRoute} />;

  const expFull = tot.fullOnVan ?? 0;
  const expEmpty = tot.emptiesCollected;
  const f = full ?? expFull;
  const e = empty ?? expEmpty;
  const cashText = cash ?? String(tot.cashPaise / 100);
  const cashPaise = /^\d{1,7}(\.\d{1,2})?$/.test(cashText.trim())
    ? Math.round(Number(cashText) * 100)
    : null;
  const differs = f !== expFull || e !== expEmpty || cashPaise !== tot.cashPaise;
  const waiting = box.queue.length > 0;
  const trip = q.data.trip;

  const confirm = () => {
    if (cashPaise === null) return;
    const id = Crypto.randomUUID();
    void enqueue({
      id,
      kind: 'end',
      path: `/staff/trips/${trip.id}/end`,
      body: {
        clientActionId: id,
        returnFull: f,
        returnEmpty: e,
        returnDamaged: Math.min(damaged, e),
        cashPaise,
      },
    });
    backToRoute();
  };

  return (
    <Screen
      footer={
        <Button
          label={t('staff.endDayConfirm')}
          disabled={waiting || cashPaise === null}
          onPress={confirm}
        />
      }
    >
      <Header title={t('staff.endDay')} subtitle={t('staff.endDayBody')} back />
      {waiting ? <Message tone="warning" text={t('staff.sendFirst')} /> : null}
      <Card>
        <View style={styles.line}>
          <View style={styles.flex}>
            <Text variant="title">{t('staff.fullBack')}</Text>
            <Text variant="caption" muted>
              {t('staff.expected', { count: expFull })}
            </Text>
          </View>
          <Stepper
            size="medium"
            value={f}
            onChange={setFull}
            max={500}
            label={t('staff.fullBack')}
          />
        </View>
        <View style={styles.rule} />
        <View style={styles.line}>
          <View style={styles.flex}>
            <Text variant="title">{t('staff.emptyBack')}</Text>
            <Text variant="caption" muted>
              {t('staff.expected', { count: expEmpty })}
            </Text>
          </View>
          <Stepper
            size="medium"
            value={e}
            onChange={setEmpty}
            max={500}
            label={t('staff.emptyBack')}
          />
        </View>
        <View style={styles.rule} />
        <View style={styles.line}>
          <View style={styles.flex}>
            <Text variant="title">{t('staff.damagedBack')}</Text>
            <Text variant="caption" muted>
              {t('staff.damagedHint')}
            </Text>
          </View>
          <Stepper
            size="medium"
            value={damaged}
            onChange={setDamaged}
            max={e}
            label={t('staff.damagedBack')}
          />
        </View>
      </Card>
      <Card>
        <TextField
          label={t('staff.cashInHand')}
          prefix="₹"
          keyboardType="decimal-pad"
          value={cashText}
          onChangeText={setCash}
          error={cashPaise === null ? t('staff.badAmount') : null}
          hint={t('staff.cashExpected', { amount: formatINR(tot.cashPaise) })}
        />
        {tot.upiPaise > 0 ? (
          <Text variant="caption" muted>
            {t('staff.upiToday', { amount: formatINR(tot.upiPaise) })}
          </Text>
        ) : null}
      </Card>
      {differs ? <Message tone="warning" text={t('staff.differenceNote')} /> : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  line: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  rule: { height: 1, backgroundColor: colors.border },
  flex: { flex: 1 },
});
