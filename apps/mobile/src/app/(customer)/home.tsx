import { useTranslation } from 'react-i18next';
import { EmptyState } from '../../components/EmptyState';
import { Screen } from '../../components/Screen';
import { Text } from '../../components/Text';

export default function CustomerHome() {
  const { t } = useTranslation();
  return (
    <Screen>
      <Text variant="heading">{t('customer.homeTitle')}</Text>
      <EmptyState message={t('customer.homeEmpty')} />
    </Screen>
  );
}
