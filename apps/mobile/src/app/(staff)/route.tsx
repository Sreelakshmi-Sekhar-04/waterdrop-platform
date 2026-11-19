import { Linking, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { colors, radii, spacing } from '@wtrdrop/design-tokens';
import { formatINR } from '@wtrdrop/shared';
import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { Screen } from '../../components/Screen';
import { StatusChip } from '../../components/StatusChip';
import { Text } from '../../components/Text';
import { EmptyState } from '../../components/EmptyState';
import { demoRoute } from '../../demo/fixtures';
import { useSessionState } from '../../lib/session';

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

/** The staff home: the next stop is always at the top with its two big actions. */
export default function StaffRoute() {
  const { t } = useTranslation();
  const { session, signOut } = useSessionState();
  const r = demoRoute;
  const [next, ...upcoming] = r.stops;
  const pct = Math.round((r.done / r.total) * 100);

  return (
    <Screen>
      <View style={styles.headRow}>
        <Text variant="heading" accessibilityRole="header">
          {t('staff.routeTitle')}
        </Text>
        {r.pendingSync > 0 ? (
          <StatusChip
            tone="warning"
            icon="cloud-off"
            label={t('staff.waitingToSync', { count: r.pendingSync })}
          />
        ) : (
          <StatusChip tone="success" icon="check" label={t('staff.allSaved')} />
        )}
      </View>
      <View style={styles.progressText}>
        <Text variant="title">{t('staff.progress', { done: r.done, left: r.total - r.done })}</Text>
        <Text muted>{t('staff.onVan', { count: r.cansOnVan })}</Text>
      </View>
      <View
        style={styles.track}
        accessibilityRole="progressbar"
        accessibilityLabel={t('staff.progress', { done: r.done, left: r.total - r.done })}
        accessibilityValue={{ min: 0, max: r.total, now: r.done }}
      >
        <View style={[styles.fill, { width: `${pct}%` }]} />
      </View>

      {next ? (
        <Card tone="highlight">
          <StatusChip tone="solid" label={t('staff.next', { n: next.n })} />
          <View>
            <Text variant="heading">{next.name}</Text>
            <Text muted>
              {next.landmark}, {next.area}
            </Text>
          </View>
          <View style={styles.figures}>
            <Figure value={String(next.qty)} label={t('staff.toGive')} tone="mist" />
            <Figure value={String(next.cansHeld)} label={t('staff.theyHave')} tone="plain" />
            <Figure
              value={formatINR(next.duePaise)}
              label={t('staff.oldDue')}
              tone={next.duePaise > 0 ? 'warning' : 'plain'}
            />
          </View>
          {next.note ? (
            <View style={styles.note}>
              <Text>{next.note}</Text>
            </View>
          ) : null}
          <View style={styles.pair}>
            <View style={styles.flex}>
              <Button
                compact
                variant="secondary"
                icon="phone"
                label={t('staff.call')}
                onPress={() => void Linking.openURL('tel:+910000000000').catch(() => undefined)}
              />
            </View>
            <View style={styles.flex}>
              <Button compact variant="secondary" icon="map" label={t('staff.map')} />
            </View>
          </View>
          <Button
            label={t('staff.delivered')}
            onPress={() =>
              router.push({ pathname: '/(staff)/deliver', params: { stop: String(next.n) } })
            }
          />
          <Button
            compact
            variant="warning"
            label={t('staff.couldNotDeliver')}
            onPress={() =>
              router.push({ pathname: '/(staff)/not-delivered', params: { stop: String(next.n) } })
            }
          />
        </Card>
      ) : (
        <EmptyState message={t('staff.routeEmpty')} />
      )}

      {upcoming.length > 0 ? (
        <View style={styles.upcoming}>
          <Text variant="label" muted>
            {t('staff.comingUp')}
          </Text>
          {upcoming.map((s) => (
            <View key={s.n} style={styles.upRow}>
              <View style={styles.flex}>
                <Text variant="title">
                  {s.n} · {s.name}
                </Text>
                <Text variant="caption" muted>
                  {s.landmark}
                </Text>
              </View>
              <Text variant="title">{t('staff.cansCount', { count: s.qty })}</Text>
            </View>
          ))}
        </View>
      ) : null}
      {session ? (
        <Button
          variant="secondary"
          compact
          label={t('staff.signOut', { name: session.name ?? '' })}
          onPress={() => void signOut().then(() => router.replace('/'))}
        />
      ) : null}
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
  note: { backgroundColor: colors.background, borderRadius: radii.sm, padding: spacing.md },
  pair: { flexDirection: 'row', gap: spacing.sm },
  upcoming: { gap: spacing.sm },
  upRow: {
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    padding: spacing.lg,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  flex: { flex: 1 },
});
