import { useState } from 'react';
import * as Crypto from 'expo-crypto';
import { StyleSheet, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import { spacing } from '@wtrdrop/design-tokens';
import { COMPLAINT_CATEGORIES, type ComplaintCategory } from '@wtrdrop/shared';
import { Button } from '../../components/Button';
import { ChoiceList } from '../../components/ChoiceList';
import { Header } from '../../components/Header';
import { Message } from '../../components/Message';
import { Screen } from '../../components/Screen';
import { Text } from '../../components/Text';
import { TextField } from '../../components/TextField';
import { api } from '../../lib/api';
import { errorText } from '../../lib/errors';
import { complaintsKey } from '../../lib/help';
import { orderNo, useMyOrders } from '../../lib/orders';

const NO_ORDER = 'none';

/**
 * Report a problem: the problem is already picked on Help, so one tap on Send is enough. The
 * customer can name the order it was about and add a few words ("Something else" needs them).
 */
export default function ReportProblem() {
  const { t, i18n } = useTranslation();
  const qc = useQueryClient();
  const params = useLocalSearchParams<{ category?: string }>();
  const [category, setCategory] = useState<ComplaintCategory>(
    (COMPLAINT_CATEGORIES as readonly string[]).includes(params.category ?? '')
      ? (params.category as ComplaintCategory)
      : 'OTHER',
  );
  const orders = useMyOrders();
  const recent = (orders.data ?? []).slice(0, 3);
  const [order, setOrder] = useState<string>(NO_ORDER);
  const [note, setNote] = useState('');
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // One id per report: a double tap or a retry after a lost reply saves it once.
  const [requestId] = useState(() => Crypto.randomUUID());
  const needsNote = category === 'OTHER' && note.trim().length < 3;
  const day = (d: string) =>
    new Date(`${d}T00:00:00Z`).toLocaleDateString(i18n.language === 'ml' ? 'ml-IN' : 'en-IN', {
      day: 'numeric',
      month: 'short',
      timeZone: 'UTC',
    });

  const send = async () => {
    setTried(true);
    if (needsNote || busy) return;
    setBusy(true);
    setError(null);
    try {
      await api('/customer/complaints', {
        method: 'POST',
        body: {
          clientRequestId: requestId,
          category,
          orderId: order === NO_ORDER ? undefined : order,
          note: note.trim() || undefined,
        },
      });
      await qc.invalidateQueries({ queryKey: complaintsKey });
      // Back to the Help screen it came from (not a second copy of it), now showing "Sent".
      router.dismissTo({ pathname: '/(customer)/help', params: { sent: '1' } });
    } catch (e) {
      setError(errorText(t, e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen>
      <Header title={t('customer.reportProblem')} back />
      <ChoiceList
        label={t('help.whatProblem')}
        value={category}
        onChange={setCategory}
        choices={COMPLAINT_CATEGORIES.map((c) => ({ value: c, label: t(`help.category.${c}`) }))}
      />
      {recent.length > 0 ? (
        <View style={styles.stack}>
          <Text variant="title" accessibilityRole="header">
            {t('help.whichOrder')}
          </Text>
          <ChoiceList
            label={t('help.whichOrder')}
            value={order}
            onChange={setOrder}
            choices={[
              ...recent.map((o) => ({
                value: o.id,
                label: t('order.number', { no: orderNo(o.orderNo) }),
                note: `${day(o.deliveryDate)} · ${t(`status.${o.status}`)}`,
              })),
              { value: NO_ORDER, label: t('help.noOrder') },
            ]}
          />
        </View>
      ) : null}
      <TextField
        label={category === 'OTHER' ? t('help.tellUs') : t('help.tellUsOptional')}
        value={note}
        onChangeText={setNote}
        multiline
        maxLength={500}
        error={tried && needsNote ? t('help.writeMore') : null}
      />
      {error ? <Message tone="warning" text={error} /> : null}
      <Button
        label={busy ? t('common.saving') : t('help.send')}
        onPress={() => void send()}
        disabled={busy}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  stack: { gap: spacing.sm },
});
