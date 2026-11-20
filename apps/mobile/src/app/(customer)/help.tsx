import { Linking, Pressable, StyleSheet, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { colors, radii, spacing } from '@wtrdrop/design-tokens';
import type { ComplaintCategory } from '@wtrdrop/shared';
import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { CustomerNav } from '../../components/CustomerNav';
import { Header } from '../../components/Header';
import { Icon } from '../../components/Icon';
import { Message } from '../../components/Message';
import { Screen } from '../../components/Screen';
import { StatusChip } from '../../components/StatusChip';
import { Text } from '../../components/Text';
import { telLink, useMyComplaints, whatsappLink } from '../../lib/help';
import { orderNo, useOrderOptions } from '../../lib/orders';

/** The common problems, in the order customers meet them. "Something else" is last. */
const PROBLEMS: ComplaintCategory[] = ['CAN_COUNT', 'WATER_QUALITY', 'LATE', 'PAYMENT', 'OTHER'];

/**
 * Help: reach a person in one tap (the business's own phone, from Settings), or report a common
 * problem. The customer's complaints and the office's answers are listed below.
 */
export default function Help() {
  const { t, i18n } = useTranslation();
  const { sent } = useLocalSearchParams<{ sent?: string }>();
  const options = useOrderOptions();
  const complaints = useMyComplaints();
  const phone = options.data?.supportPhone ?? null;
  const day = (iso: string) =>
    new Date(iso).toLocaleDateString(i18n.language === 'ml' ? 'ml-IN' : 'en-IN', {
      day: 'numeric',
      month: 'short',
      timeZone: 'Asia/Kolkata',
    });
  return (
    <Screen nav={<CustomerNav />}>
      <Header title={t('customer.helpTitle')} />
      {sent ? <Message tone="success" text={t('help.sent')} /> : null}
      <Text muted>{t('customer.helpBody')}</Text>
      {phone ? (
        <View style={styles.stack}>
          <Button
            icon="phone"
            label={t('customer.callUs')}
            onPress={() => void Linking.openURL(telLink(phone))}
          />
          <Button
            icon="chat"
            variant="secondary"
            label={t('customer.whatsappUs')}
            onPress={() => void Linking.openURL(whatsappLink(phone))}
          />
        </View>
      ) : options.isSuccess ? (
        <Message tone="info" text={t('help.noPhone')} />
      ) : null}

      <Text variant="title" accessibilityRole="header">
        {t('customer.reportProblem')}
      </Text>
      <Card style={styles.list}>
        {PROBLEMS.map((p, i) => (
          <Pressable
            key={p}
            accessibilityRole="button"
            onPress={() => router.push({ pathname: '/(customer)/report', params: { category: p } })}
            style={[styles.item, i > 0 && styles.divider]}
          >
            <Text variant="title" style={styles.flex}>
              {t(`help.category.${p}`)}
            </Text>
            <View style={styles.chevron}>
              <Icon name="back" size={18} color={colors.inkMuted} />
            </View>
          </Pressable>
        ))}
      </Card>

      {complaints.data && complaints.data.length > 0 ? (
        <>
          <Text variant="title" accessibilityRole="header">
            {t('help.mine')}
          </Text>
          {complaints.data.map((c) => (
            <Card key={c.id} style={styles.complaint}>
              <Text variant="title">{t(`help.category.${c.category}`)}</Text>
              <Text muted>
                {day(c.createdAt)}
                {c.orderNo ? ` · ${t('order.number', { no: orderNo(c.orderNo) })}` : ''}
              </Text>
              {c.note ? <Text>“{c.note}”</Text> : null}
              <StatusChip
                label={c.status === 'open' ? t('help.open') : t('help.resolved')}
                tone={c.status === 'open' ? 'warning' : 'success'}
                icon={c.status === 'open' ? 'clock' : 'check'}
              />
              {c.resolution ? <Text>{t('help.answer', { text: c.resolution })}</Text> : null}
            </Card>
          ))}
        </>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  stack: { gap: spacing.sm },
  list: { padding: 0, gap: 0, overflow: 'hidden', borderRadius: radii.xl },
  item: {
    minHeight: 60,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.xl,
  },
  divider: { borderTopWidth: 1, borderTopColor: colors.border },
  chevron: { transform: [{ rotate: '180deg' }] },
  flex: { flex: 1 },
  complaint: { gap: spacing.xs },
});
