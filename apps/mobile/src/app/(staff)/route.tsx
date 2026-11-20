import { useState } from 'react';
import { Linking, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import * as Crypto from 'expo-crypto';
import { colors, radii, spacing } from '@wtrdrop/design-tokens';
import { formatINR } from '@wtrdrop/shared';
import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { EmptyState } from '../../components/EmptyState';
import { Message } from '../../components/Message';
import { Screen } from '../../components/Screen';
import { ErrorState, Skeleton } from '../../components/States';
import { StatusChip } from '../../components/StatusChip';
import { Stepper } from '../../components/Stepper';
import { Text } from '../../components/Text';
import { api } from '../../lib/api';
import { errorText } from '../../lib/errors';
import { orderNo } from '../../lib/orders';
import { clearOutbox, dismissProblem, enqueue, useOutbox } from '../../lib/outbox';
import { useSessionState } from '../../lib/session';
import {
  clearStaffCache,
  isOpen,
  mapUrl,
  staffDayKey,
  useStaffDay,
  withPending,
  type Stop,
} from '../../lib/staff';

function Figure({
  value,
  label,
  tone,
}: {
  value: string;
  label: string;
  tone: 'mist' | 'plain' | 'warning';
}) {
  const bg =
    tone === 'mist' ? colors.mist : tone === 'warning' ? colors.warningSoft : colors.background;
  return (
    <View style={[styles.figure, { backgroundColor: bg }]}>
      <Text variant="heading" color={tone === 'warning' ? colors.warning : colors.ink}>
        {value}
      </Text>
      <Text variant="caption">{label}</Text>
    </View>
  );
}

const call = (phone: string) => void Linking.openURL(`tel:${phone}`).catch(() => undefined);

/** The staff home: load-out, then the next stop always at the top with its two big actions. */
export default function StaffRoute() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const { session, signOut } = useSessionState();
  const q = useStaffDay();
  const box = useOutbox();
  const [load, setLoad] = useState<number | null>(null);
  const [undoError, setUndoError] = useState<string | null>(null);

  if (q.isPending)
    return (
      <Screen>
        <Skeleton lines={6} />
      </Screen>
    );
  if (q.isError || !q.data)
    return (
      <Screen>
        <ErrorState message={errorText(t, q.error)} onRetry={() => void q.refetch()} />
      </Screen>
    );

  const day = withPending(q.data, box.queue);
  const trip = day.trip;
  const offline = 'offline' in q.data || !box.online;
  const open = day.stops.filter(isOpen);
  const [next, ...upcoming] = open;
  const done = day.stops.filter((s) => (!isOpen(s) && s.status !== 'CANCELLED') || !!s.pending);
  const cancelled = day.stops.filter((s) => s.status === 'CANCELLED' && !s.attempt);
  const total = day.stops.length - cancelled.length;
  const doneCount = total - open.length;

  const undo = async (s: Stop) => {
    setUndoError(null);
    try {
      await api(`/staff/attempts/${s.attempt!.id}/undo`, { method: 'POST', body: {} });
      await qc.invalidateQueries({ queryKey: staffDayKey });
    } catch (e) {
      setUndoError(errorText(t, e));
    }
  };

  const syncChip =
    box.queue.length > 0 ? (
      <StatusChip
        tone="warning"
        icon="cloud-off"
        label={t('staff.waitingToSync', { count: box.queue.length })}
      />
    ) : (
      <StatusChip tone="success" icon="check" label={t('staff.allSaved')} />
    );

  const signOutButton = session ? (
    <Button
      variant="secondary"
      compact
      label={t('staff.signOut', { name: session.name ?? '' })}
      disabled={box.queue.length > 0}
      onPress={() =>
        void Promise.all([clearOutbox(), clearStaffCache()])
          .then(() => signOut())
          .then(() => router.replace('/'))
      }
    />
  ) : null;

  return (
    <Screen>
      <View style={styles.headRow}>
        <Text variant="heading" accessibilityRole="header">
          {t('staff.routeTitle')}
        </Text>
        {syncChip}
      </View>
      {offline ? <Message tone="warning" text={t('staff.offline')} /> : null}
      {box.problems.map((p) => (
        <Card key={p.action.id} tone="mist">
          <Text variant="title">{t('staff.notSaved')}</Text>
          <Text>{t(`errors.${p.code}`, { defaultValue: t('errors.UNKNOWN') })}</Text>
          <Button
            compact
            variant="secondary"
            label={t('staff.understood')}
            onPress={() => void dismissProblem(p.action.id)}
          />
        </Card>
      ))}

      {!trip ? <EmptyState message={t('staff.routeEmpty')} /> : null}

      {trip?.status === 'planned' ? (
        <Card tone="highlight">
          <Text variant="title">{t('staff.loadTitle', { count: total })}</Text>
          <Text muted>{t('staff.loadBody')}</Text>
          <View style={styles.center}>
            <Stepper
              value={load ?? day.totals?.plannedLoad ?? 0}
              onChange={setLoad}
              max={500}
              label={t('staff.loadLabel')}
            />
            <Text muted>{t('staff.loadLabel')}</Text>
          </View>
          <Button
            label={t('staff.startRoute')}
            disabled={total === 0}
            onPress={() => {
              const id = Crypto.randomUUID();
              void enqueue({
                id,
                kind: 'start',
                path: `/staff/trips/${trip.id}/start`,
                body: { clientActionId: id, loadFull: load ?? day.totals?.plannedLoad ?? 0 },
              });
            }}
          />
        </Card>
      ) : null}

      {trip && trip.status !== 'planned' ? (
        <>
          <View style={styles.progressText}>
            <Text variant="title">
              {t('staff.progress', { done: doneCount, left: open.length })}
            </Text>
          </View>
          <View
            style={styles.track}
            accessibilityRole="progressbar"
            accessibilityLabel={t('staff.progress', { done: doneCount, left: open.length })}
            accessibilityValue={{ min: 0, max: total, now: doneCount }}
          >
            <View
              style={[
                styles.fill,
                { width: `${total ? Math.round((doneCount / total) * 100) : 0}%` },
              ]}
            />
          </View>
        </>
      ) : null}

      {trip?.status === 'on_route' && next ? (
        <Card tone="highlight">
          <StatusChip tone="solid" label={t('staff.next', { n: doneCount + 1 })} />
          <View>
            <Text variant="heading">{next.customerName ?? orderNo(next.orderNo)}</Text>
            <Text muted>
              {next.address.line}, {next.address.landmark}, {next.address.areaName}
            </Text>
          </View>
          <View style={styles.figures}>
            <Figure value={String(next.qty)} label={t('staff.toGive')} tone="mist" />
            <Figure value={String(next.cansHeld)} label={t('staff.theyHave')} tone="plain" />
            <Figure
              value={formatINR(Math.max(0, next.balancePaise))}
              label={t('staff.oldDue')}
              tone={next.balancePaise > 0 ? 'warning' : 'plain'}
            />
          </View>
          {next.address.deliveryNote || next.note ? (
            <View style={styles.note}>
              {next.address.deliveryNote ? <Text>{next.address.deliveryNote}</Text> : null}
              {next.note ? <Text>{next.note}</Text> : null}
            </View>
          ) : null}
          <View style={styles.pair}>
            <View style={styles.flex}>
              <Button
                compact
                variant="secondary"
                icon="phone"
                label={t('staff.call')}
                onPress={() => call(next.customerPhone)}
              />
            </View>
            <View style={styles.flex}>
              <Button
                compact
                variant="secondary"
                icon="map"
                label={t('staff.map')}
                onPress={() => void Linking.openURL(mapUrl(next)).catch(() => undefined)}
              />
            </View>
          </View>
          <Button
            label={t('staff.delivered')}
            onPress={() =>
              router.push({ pathname: '/(staff)/deliver', params: { order: next.orderId } })
            }
          />
          <Button
            compact
            variant="warning"
            label={t('staff.couldNotDeliver')}
            onPress={() =>
              router.push({ pathname: '/(staff)/not-delivered', params: { order: next.orderId } })
            }
          />
        </Card>
      ) : null}

      {trip?.status === 'on_route' && !next ? (
        <Card tone="mist">
          <Text variant="title">{t('staff.allStopsDone')}</Text>
          <Button label={t('staff.endDay')} onPress={() => router.push('/(staff)/day-end')} />
        </Card>
      ) : null}

      {trip && (trip.status === 'ended' || trip.status === 'reconciled') ? (
        <Card tone="mist">
          <Text variant="title">{t('staff.dayEnded')}</Text>
          <Text muted>
            {trip.status === 'reconciled' ? t('staff.dayChecked') : t('staff.dayEndedBody')}
          </Text>
        </Card>
      ) : null}

      {upcoming.length > 0 ? (
        <View style={styles.list}>
          <Text variant="label" muted>
            {t('staff.comingUp')}
          </Text>
          {upcoming.map((s, i) => (
            <View key={s.orderId} style={styles.row}>
              <View style={styles.flex}>
                <Text variant="title">
                  {doneCount + i + 2} · {s.customerName ?? orderNo(s.orderNo)}
                </Text>
                <Text variant="caption" muted>
                  {s.address.landmark}, {s.address.areaName}
                </Text>
              </View>
              <Text variant="title">{t('staff.cansCount', { count: s.qty })}</Text>
            </View>
          ))}
        </View>
      ) : null}

      {cancelled.length > 0 && trip?.status === 'on_route' ? (
        <Message
          tone="warning"
          text={t('staff.cancelledStops', {
            names: cancelled.map((s) => s.customerName ?? orderNo(s.orderNo)).join(', '),
          })}
        />
      ) : null}

      {done.length > 0 ? (
        <View style={styles.list}>
          <Text variant="label" muted>
            {t('staff.doneToday')}
          </Text>
          {undoError ? <Message tone="warning" text={undoError} /> : null}
          {done.map((s) => (
            <View key={s.orderId} style={styles.row}>
              <View style={styles.flex}>
                <Text variant="title">{s.customerName ?? orderNo(s.orderNo)}</Text>
                <Text variant="caption" muted>
                  {s.pending
                    ? t('staff.savedOnPhone')
                    : s.attempt?.outcome === 'delivered'
                      ? t('staff.doneDelivered', {
                          full: s.attempt.fullDelivered,
                          empty: s.attempt.emptyCollected + s.attempt.extraEmpties,
                        })
                      : t(`staff.reason.${s.attempt?.failureReason ?? 'OTHER'}`)}
                </Text>
              </View>
              {s.canUndo && !s.pending ? (
                <Button
                  compact
                  variant="secondary"
                  label={t('staff.undo')}
                  accessibilityLabel={t('staff.undoFor', {
                    name: s.customerName ?? orderNo(s.orderNo),
                  })}
                  onPress={() => void undo(s)}
                />
              ) : null}
            </View>
          ))}
        </View>
      ) : null}
      {signOutButton}
    </Screen>
  );
}

const styles = StyleSheet.create({
  headRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  progressText: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
  track: {
    height: 10,
    borderRadius: radii.pill,
    backgroundColor: colors.border,
    marginTop: -spacing.sm,
  },
  fill: { height: 10, borderRadius: radii.pill, backgroundColor: colors.primary },
  figures: { flexDirection: 'row', gap: spacing.sm },
  figure: { flex: 1, borderRadius: radii.sm, paddingVertical: spacing.sm, alignItems: 'center' },
  note: {
    backgroundColor: colors.background,
    borderRadius: radii.sm,
    padding: spacing.md,
    gap: spacing.xs,
  },
  pair: { flexDirection: 'row', gap: spacing.sm },
  center: { alignItems: 'center', gap: spacing.xs },
  list: { gap: spacing.sm },
  row: {
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    padding: spacing.lg,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  flex: { flex: 1 },
});
