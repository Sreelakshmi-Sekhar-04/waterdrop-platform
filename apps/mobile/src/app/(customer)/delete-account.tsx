import { useState } from 'react';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { formatINR } from '@wtrdrop/shared';
import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { Header } from '../../components/Header';
import { Message } from '../../components/Message';
import { Screen } from '../../components/Screen';
import { ErrorState, Skeleton } from '../../components/States';
import { Text } from '../../components/Text';
import { api } from '../../lib/api';
import { errorText } from '../../lib/errors';
import { useSessionState } from '../../lib/session';

interface DeletionCheck {
  canDelete: boolean;
  blockers: {
    cansHeld: number;
    depositHeldPaise: number;
    balancePaise: number;
    openOrders: number;
    otherRoles: boolean;
  };
}

/**
 * Delete my account (ADR 0007). Shows what has to be settled first; when nothing is outstanding,
 * one button erases the account and signs out. Orders and payments stay with the supplier.
 */
export default function DeleteAccount() {
  const { t } = useTranslation();
  const { signOut } = useSessionState();
  const check = useQuery({
    queryKey: ['account-deletion'],
    queryFn: () => api<DeletionCheck>('/customer/account/deletion'),
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const remove = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await api('/customer/account/delete', { method: 'POST', body: { confirm: true } });
      await signOut();
      router.replace('/');
    } catch (e) {
      setError(errorText(t, e));
      void check.refetch();
    } finally {
      setBusy(false);
    }
  };

  const b = check.data?.blockers;
  const todo: string[] = [];
  if (b) {
    if (b.openOrders > 0) todo.push(t('deleteAccount.openOrders', { count: b.openOrders }));
    if (b.cansHeld > 0) todo.push(t('deleteAccount.cans', { count: b.cansHeld }));
    if (b.depositHeldPaise > 0)
      todo.push(t('deleteAccount.deposit', { amount: formatINR(b.depositHeldPaise) }));
    if (b.balancePaise > 0)
      todo.push(t('deleteAccount.due', { amount: formatINR(b.balancePaise) }));
    if (b.balancePaise < 0)
      todo.push(t('deleteAccount.advance', { amount: formatINR(-b.balancePaise) }));
    if (b.otherRoles) todo.push(t('deleteAccount.otherRoles'));
  }

  return (
    <Screen>
      <Header title={t('deleteAccount.title')} back />
      {check.isPending ? <Skeleton lines={3} /> : null}
      {check.isError ? (
        <ErrorState message={errorText(t, check.error)} onRetry={() => void check.refetch()} />
      ) : null}
      {check.data ? (
        <>
          <Card>
            <Text>{t('deleteAccount.what')}</Text>
            <Text muted>{t('deleteAccount.kept')}</Text>
          </Card>
          {todo.length ? (
            <Card>
              <Text variant="title">{t('deleteAccount.firstSettle')}</Text>
              {todo.map((line) => (
                <Text key={line}>{`• ${line}`}</Text>
              ))}
              <Text muted>{t('deleteAccount.callUs')}</Text>
            </Card>
          ) : null}
          {error ? <Message tone="warning" text={error} /> : null}
          {check.data.canDelete ? (
            <Button
              variant="warning"
              label={t('deleteAccount.confirm')}
              disabled={busy}
              onPress={() => void remove()}
            />
          ) : (
            <Button
              variant="secondary"
              label={t('deleteAccount.help')}
              onPress={() => router.push('/(customer)/help')}
            />
          )}
        </>
      ) : null}
    </Screen>
  );
}
