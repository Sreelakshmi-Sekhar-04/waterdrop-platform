import { useState } from 'react';
import { Redirect } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { EmptyState } from '../components/EmptyState';
import { Header } from '../components/Header';
import { Message } from '../components/Message';
import { PreviewBanner } from '../components/PreviewBanner';
import { Screen } from '../components/Screen';
import { ErrorState, Skeleton } from '../components/States';
import { StatusChip } from '../components/StatusChip';
import { Text } from '../components/Text';

/** Development-only gallery of the shared loading, empty, error and message states. */
export default function States() {
  const { t } = useTranslation();
  const [retries, setRetries] = useState(0);
  if (!__DEV__) return <Redirect href="/" />;
  return (
    <>
      <PreviewBanner />
      <Screen>
        <Header title={t('states.previewTitle')} back />
        <Text variant="label" muted>
          Loading
        </Text>
        <Skeleton />
        <Text variant="label" muted>
          Empty
        </Text>
        <EmptyState message={t('staff.routeEmpty')} />
        <Text variant="label" muted>
          Error ({retries})
        </Text>
        <ErrorState onRetry={() => setRetries((r) => r + 1)} />
        <ErrorState offline />
        <Text variant="label" muted>
          Messages
        </Text>
        <Message tone="info" text={t('customer.payNote')} icon="cash" />
        <Message tone="success" text={t('customer.allPaid')} />
        <Message tone="warning" text={t('staff.extraEmpties', { count: 1 })} />
        <StatusChip tone="success" icon="check" label={t('status.DELIVERED')} />
        <StatusChip tone="warning" icon="alert" label={t('status.RESCHEDULE_PENDING')} />
      </Screen>
    </>
  );
}
