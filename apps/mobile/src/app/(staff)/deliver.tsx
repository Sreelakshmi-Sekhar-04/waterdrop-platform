import { useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { colors, spacing } from '@wtrdrop/design-tokens';
import { applyCanMovement, formatINR } from '@wtrdrop/shared';
import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { ChoiceList } from '../../components/ChoiceList';
import { Header } from '../../components/Header';
import { LogoMark } from '../../components/Logo';
import { Message } from '../../components/Message';
import { Screen } from '../../components/Screen';
import { Stepper } from '../../components/Stepper';
import { Text } from '../../components/Text';
import { ErrorState } from '../../components/States';
import { demoSettings, findStop } from '../../demo/fixtures';

type Method = 'cash' | 'upi' | 'later';

/**
 * The single "Delivered" screen: full cans, empties and payment, pre-filled.
 * The live can balance uses the real ledger rule from @wtrdrop/shared.
 */
export default function Deliver() {
  const { t } = useTranslation();
  const { stop = '' } = useLocalSearchParams<{ stop?: string }>();
  const s = findStop(Number(stop));
  const [full, setFull] = useState(s?.qty ?? 0);
  // Decision D-09: empties default to the usual one-for-one swap.
  const [empty, setEmpty] = useState(s ? Math.min(s.qty, s.cansHeld) : 0);
  const [method, setMethod] = useState<Method>('cash');

  const result = useMemo(
    () =>
      s
        ? applyCanMovement({
            opening: s.cansHeld,
            delivered: full,
            returned: empty,
            depositCoverCans: s.depositCoverCans,
          })
        : null,
    [s, full, empty],
  );
  if (!s || !result)
    return <ErrorState message={t('staff.routeEmpty')} onRetry={() => router.back()} />;

  const today = full * demoSettings.pricePerCanPaise;
  const collect = today + s.duePaise;

  return (
    <Screen
      footer={
        <>
          <Button label={t('staff.confirm')} onPress={() => router.replace('/(staff)/route')} />
          <Text variant="caption" muted style={styles.center}>
            {t('staff.undoHint', { minutes: demoSettings.staffUndoWindowMinutes })}
          </Text>
        </>
      }
    >
      <Header title={s.name} subtitle={t('staff.stopSubtitle', { n: s.n, area: s.area })} back />

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
            value={full}
            onChange={setFull}
            max={20}
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
            value={empty}
            onChange={setEmpty}
            max={20}
            label={t('staff.emptyTaken')}
          />
        </View>
      </Card>

      <View style={styles.result} accessibilityLiveRegion="polite">
        <LogoMark size={28} />
        <Text style={styles.flex}>
          {t('staff.afterThis', { name: s.name, count: result.closing })}
        </Text>
      </View>
      {result.extraReturned > 0 ? (
        <Message tone="warning" text={t('staff.extraEmpties', { count: result.extraReturned })} />
      ) : null}
      {result.beyondDepositCover > 0 ? (
        <Message
          tone="warning"
          text={t('staff.beyondDeposit', { count: result.beyondDepositCover })}
        />
      ) : null}

      <Card>
        <View style={styles.line}>
          <Text variant="title" style={styles.flex}>
            {t('staff.collect')}
          </Text>
          <Text variant="display">{formatINR(collect)}</Text>
        </View>
        <Text variant="caption" muted>
          {t('staff.collectBreakdown', {
            count: full,
            today: formatINR(today),
            due: formatINR(s.duePaise),
          })}
        </Text>
        <ChoiceList
          layout="row"
          label={t('staff.collect')}
          value={method}
          onChange={setMethod}
          choices={[
            { value: 'cash', label: t('staff.cash') },
            { value: 'upi', label: t('staff.upi') },
            { value: 'later', label: t('staff.later') },
          ]}
        />
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
