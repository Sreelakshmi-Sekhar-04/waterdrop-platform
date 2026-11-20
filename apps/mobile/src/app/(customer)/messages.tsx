import { useEffect } from 'react';
import { StyleSheet } from 'react-native';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import { spacing } from '@wtrdrop/design-tokens';
import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { CustomerNav } from '../../components/CustomerNav';
import { EmptyState } from '../../components/EmptyState';
import { Header } from '../../components/Header';
import { Screen } from '../../components/Screen';
import { ErrorState, Skeleton } from '../../components/States';
import { StatusChip } from '../../components/StatusChip';
import { Text } from '../../components/Text';
import { api } from '../../lib/api';
import { errorText } from '../../lib/errors';
import { messagesKey, useMessages } from '../../lib/help';

/**
 * Messages from the business: out for delivery, delivered, not delivered, cancelled, dues and
 * complaint answers. The same texts go out as phone notifications once the app is published
 * (Phase 8). Opening this screen marks them read.
 */
export default function Messages() {
  const { t, i18n } = useTranslation();
  const qc = useQueryClient();
  const q = useMessages();
  const newest = q.data?.messages[0]?.id;
  const unread = q.data?.unread ?? 0;
  useEffect(() => {
    if (!newest || unread === 0) return;
    void api('/customer/messages/read', { method: 'POST', body: { upToId: newest } })
      .then(() => qc.invalidateQueries({ queryKey: messagesKey }))
      .catch(() => undefined);
  }, [newest, unread, qc]);
  const when = (iso: string) =>
    new Date(iso).toLocaleString(i18n.language === 'ml' ? 'ml-IN' : 'en-IN', {
      day: 'numeric',
      month: 'short',
      hour: 'numeric',
      minute: '2-digit',
      timeZone: 'Asia/Kolkata',
    });

  return (
    <Screen nav={<CustomerNav />}>
      <Header title={t('messages.title')} back />
      {q.isPending ? <Skeleton lines={3} /> : null}
      {q.isError ? (
        <ErrorState message={errorText(t, q.error)} onRetry={() => void q.refetch()} />
      ) : null}
      {q.data && q.data.messages.length === 0 ? <EmptyState message={t('messages.none')} /> : null}
      {q.data?.messages.map((m) => (
        <Card key={m.id} tone={m.read ? 'plain' : 'highlight'} style={styles.card}>
          {!m.read ? <StatusChip label={t('messages.new')} tone="info" /> : null}
          <Text variant="title">{m.title}</Text>
          <Text>{m.body}</Text>
          <Text muted variant="label">
            {when(m.createdAt)}
          </Text>
          {m.orderId ? (
            <Button
              compact
              variant="secondary"
              label={t('messages.openOrder')}
              onPress={() =>
                router.push({ pathname: '/(customer)/placed', params: { id: m.orderId! } })
              }
            />
          ) : null}
        </Card>
      ))}
    </Screen>
  );
}

const styles = StyleSheet.create({
  card: { gap: spacing.xs },
});
