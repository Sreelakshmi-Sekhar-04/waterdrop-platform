import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { colors, radii, spacing } from '@wtrdrop/design-tokens';
import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { CustomerNav } from '../../components/CustomerNav';
import { Header } from '../../components/Header';
import { Icon } from '../../components/Icon';
import { Message } from '../../components/Message';
import { Screen } from '../../components/Screen';
import { Text } from '../../components/Text';

const PROBLEMS = ['problemCount', 'problemQuality', 'problemLate', 'problemPayment'] as const;

/** Help: reach a person in one tap, or pick a common problem. */
export default function Help() {
  const { t } = useTranslation();
  const [tapped, setTapped] = useState(false);
  return (
    <Screen nav={<CustomerNav />}>
      <Header title={t('customer.helpTitle')} />
      <Text muted>{t('customer.helpBody')}</Text>
      <View style={styles.stack}>
        <Button icon="phone" label={t('customer.callUs')} onPress={() => setTapped(true)} />
        <Button
          icon="chat"
          variant="secondary"
          label={t('customer.whatsappUs')}
          onPress={() => setTapped(true)}
        />
      </View>
      <Text variant="title">{t('customer.commonProblems')}</Text>
      <Card style={styles.list}>
        {PROBLEMS.map((p, i) => (
          <Pressable
            key={p}
            accessibilityRole="button"
            onPress={() => setTapped(true)}
            style={[styles.item, i > 0 && styles.divider]}
          >
            <Text variant="title" style={styles.flex}>
              {t(`customer.${p}`)}
            </Text>
            <View style={styles.chevron}>
              <Icon name="back" size={18} color={colors.inkMuted} />
            </View>
          </Pressable>
        ))}
      </Card>
      {tapped ? <Message tone="info" text={t('common.simulated')} /> : null}
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
});
