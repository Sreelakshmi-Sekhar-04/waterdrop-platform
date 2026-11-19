import { StyleSheet, View, Pressable } from 'react-native';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { colors, spacing } from '@wtrdrop/design-tokens';
import { formatINR } from '@wtrdrop/shared';
import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { CustomerNav } from '../../components/CustomerNav';
import { Icon } from '../../components/Icon';
import { Screen } from '../../components/Screen';
import { Text } from '../../components/Text';
import { demoCustomer, demoSettings, demoSlots } from '../../demo/fixtures';
import { useProfile } from '../../lib/customer';
import { useSession } from '../../lib/session';

/** The 2-tap reorder home. The usual order is one big button. */
export default function CustomerHome() {
  const { t } = useTranslation();
  const session = useSession();
  // Real name and address from the account; the order numbers stay demo until Phase 4.
  const profile = useProfile(!!session);
  const defaultAddress = profile.data?.addresses.find((a) => a.isDefault);
  const c = {
    ...demoCustomer,
    name: profile.data?.name ?? demoCustomer.name,
    address: defaultAddress
      ? { label: defaultAddress.label, line: defaultAddress.line }
      : demoCustomer.address,
  };
  const total = c.usualQty * demoSettings.pricePerCanPaise;
  const when = demoSlots[0].label;

  return (
    <Screen nav={<CustomerNav />}>
      <View>
        <Text muted>{t('customer.greeting', { name: c.name })}</Text>
        <Text variant="heading" accessibilityRole="header">
          {t('customer.homeTitle')}
        </Text>
      </View>

      <Card tone="primary">
        <Text variant="label" color={colors.onPrimary}>
          {t('customer.usualOrder')}
        </Text>
        <Text variant="heading" color={colors.onPrimary}>
          {t('customer.cansAndPrice', { count: c.usualQty, price: formatINR(total) })}
        </Text>
        <Text color={colors.onPrimary}>
          {t('customer.arrives', { place: c.address.label, when })}
        </Text>
        <Button
          variant="onPrimary"
          label={t('customer.orderAgain', { count: c.usualQty })}
          onPress={() => router.push('/(customer)/placed')}
        />
        <Pressable
          accessibilityRole="button"
          onPress={() => router.push('/(customer)/order')}
          style={styles.link}
        >
          <Text variant="label" color={colors.onPrimary} style={styles.underline}>
            {t('customer.changeOrder')}
          </Text>
        </Pressable>
      </Card>

      <View style={styles.row}>
        <Card style={styles.half}>
          <Text variant="label" muted>
            {t('customer.cansWithYou')}
          </Text>
          <Text variant="display">{c.cansHeld}</Text>
          <Text variant="caption" muted>
            {t('customer.cansWithYouHint')}
          </Text>
        </Card>
        <Card style={styles.half}>
          <Text variant="label" muted>
            {t('customer.amountDue')}
          </Text>
          <Text variant="display" color={c.duePaise > 0 ? colors.warning : colors.success}>
            {formatINR(c.duePaise)}
          </Text>
          <Text variant="caption" muted>
            {c.duePaise > 0 ? t('customer.payOnDelivery') : t('customer.allPaid')}
          </Text>
        </Card>
      </View>

      <Card style={styles.lastRow}>
        <View style={styles.iconBox}>
          <Icon name="check" color={colors.success} strokeWidth={3} />
        </View>
        <View style={styles.flex}>
          <Text variant="title">{t('customer.lastDelivered')}</Text>
          <Text muted>
            Mon, 16 Nov · {t('customer.cansAndPrice', { count: 2, price: formatINR(8000) })}
          </Text>
        </View>
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: spacing.md },
  half: { flex: 1, padding: spacing.lg, gap: spacing.xs },
  link: { alignSelf: 'center', minHeight: 44, justifyContent: 'center' },
  underline: { textDecorationLine: 'underline' },
  lastRow: { flexDirection: 'row', alignItems: 'center', padding: spacing.lg },
  iconBox: {
    width: 44,
    height: 44,
    borderRadius: 14,
    backgroundColor: colors.successSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  flex: { flex: 1 },
});
