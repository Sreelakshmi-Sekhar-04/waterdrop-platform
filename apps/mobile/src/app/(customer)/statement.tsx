import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { colors, spacing } from '@wtrdrop/design-tokens';
import { addMonths, formatINR, istDate } from '@wtrdrop/shared';
import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { CustomerNav } from '../../components/CustomerNav';
import { Header } from '../../components/Header';
import { Screen } from '../../components/Screen';
import { ErrorState, Skeleton } from '../../components/States';
import { Text } from '../../components/Text';
import { api } from '../../lib/api';
import { errorText } from '../../lib/errors';
import { orderNo } from '../../lib/orders';

interface Statement {
  month: string;
  money: { openingPaise: number; chargedPaise: number; paidPaise: number; closingPaise: number };
  cans: { opening: number; delivered: number; returned: number; closing: number };
  deposit: { heldPaise: number; coverCans: number };
  entries: {
    id: number;
    at: string;
    entryType: string;
    deltaPaise: number;
    balanceAfterPaise: number;
    orderNo: number | null;
    cans: number | null;
    method: 'cash' | 'upi' | null;
  }[];
}

/**
 * D-11: the customer's own monthly statement, from the same ledgers the office sees. The office's
 * notes are left out by the server. Only this month and the 24 before it can be opened.
 */
export default function CustomerStatement() {
  const { t, i18n } = useTranslation();
  const thisMonth = istDate(new Date()).slice(0, 7);
  const oldest = addMonths(thisMonth, -24);
  const [month, setMonth] = useState(thisMonth);
  const q = useQuery({
    queryKey: ['customer', 'statement', month],
    queryFn: async () =>
      (await api<{ statement: Statement | null }>(`/customer/statement?month=${month}`)).statement,
  });
  const locale = i18n.language === 'ml' ? 'ml-IN' : 'en-IN';
  const monthName = new Date(`${month}-01T00:00:00Z`).toLocaleDateString(locale, {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
  const day = (iso: string) =>
    new Date(iso).toLocaleDateString(locale, {
      day: 'numeric',
      month: 'short',
      timeZone: 'Asia/Kolkata',
    });
  const balance = (p: number) =>
    p > 0
      ? t('statement.due', { amount: formatINR(p) })
      : p < 0
        ? t('statement.advance', { amount: formatINR(-p) })
        : t('statement.nothingDue');
  const s = q.data;

  const label = (e: Statement['entries'][number]) =>
    e.entryType === 'reversal' && e.method
      ? t('statement.entry.notReceived')
      : t(`statement.entry.${e.entryType}`, { defaultValue: t('statement.entry.adjustment') });
  const detail = (e: Statement['entries'][number]) =>
    [
      e.orderNo ? t('order.number', { no: orderNo(e.orderNo) }) : null,
      e.entryType === 'delivery_charge' && e.cans ? t('statement.cans', { count: e.cans }) : null,
      e.method ? t(`statement.method.${e.method}`) : null,
    ]
      .filter(Boolean)
      .join(' · ');

  return (
    <Screen nav={<CustomerNav />}>
      <Header title={t('statement.title')} subtitle={monthName} back />
      <View style={styles.row}>
        <View style={styles.flex}>
          <Button
            variant="secondary"
            compact
            label={t('statement.previousShort')}
            accessibilityLabel={t('statement.previous')}
            disabled={month <= oldest}
            onPress={() => setMonth(addMonths(month, -1))}
          />
        </View>
        <View style={styles.flex}>
          <Button
            variant="secondary"
            compact
            label={t('statement.nextShort')}
            accessibilityLabel={t('statement.next')}
            disabled={month >= thisMonth}
            onPress={() => setMonth(addMonths(month, 1))}
          />
        </View>
      </View>
      {q.isPending ? <Skeleton lines={4} /> : null}
      {q.isError ? (
        <ErrorState message={errorText(t, q.error)} onRetry={() => void q.refetch()} />
      ) : null}
      {s ? (
        <>
          <Card tone="mist">
            <View style={styles.between}>
              <Text muted>{t('statement.opening')}</Text>
              <Text variant="label">{balance(s.money.openingPaise)}</Text>
            </View>
            <View style={styles.between}>
              <Text muted>{t('statement.charged')}</Text>
              <Text variant="label">{formatINR(s.money.chargedPaise)}</Text>
            </View>
            <View style={styles.between}>
              <Text muted>{t('statement.paid')}</Text>
              <Text variant="label">{formatINR(s.money.paidPaise)}</Text>
            </View>
            <View style={[styles.between, styles.total]}>
              <Text variant="title">{t('statement.closing')}</Text>
              <Text variant="title" testID="statement-closing">
                {balance(s.money.closingPaise)}
              </Text>
            </View>
          </Card>
          <Text muted>
            {t('statement.cansLine', {
              delivered: s.cans.delivered,
              returned: s.cans.returned,
              closing: s.cans.closing,
            })}
          </Text>
          {s.entries.length === 0 ? (
            <Card>
              <Text muted>{t('statement.noEntries')}</Text>
            </Card>
          ) : (
            s.entries.map((e) => (
              <Card key={e.id} style={styles.entry}>
                <View style={styles.between}>
                  <Text variant="label">{label(e)}</Text>
                  <Text variant="label" color={e.deltaPaise < 0 ? colors.success : colors.ink}>
                    {e.deltaPaise > 0
                      ? `+${formatINR(e.deltaPaise)}`
                      : `−${formatINR(-e.deltaPaise)}`}
                  </Text>
                </View>
                <View style={styles.between}>
                  <Text muted variant="caption">
                    {[day(e.at), detail(e)].filter(Boolean).join(' · ')}
                  </Text>
                  <Text muted variant="caption">
                    {balance(e.balanceAfterPaise)}
                  </Text>
                </View>
              </Card>
            ))
          )}
        </>
      ) : null}
      {q.isSuccess && !s ? (
        <Card>
          <Text muted>{t('statement.noEntries')}</Text>
        </Card>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: spacing.md },
  flex: { flex: 1 },
  between: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: spacing.md,
    flexWrap: 'wrap',
  },
  total: { borderTopWidth: 1, borderTopColor: colors.border, paddingTop: spacing.md },
  entry: { padding: spacing.lg, gap: spacing.xs },
});
