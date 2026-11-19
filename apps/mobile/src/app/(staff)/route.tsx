import { useTranslation } from 'react-i18next';
import { EmptyState } from '../../components/EmptyState';
import { Screen } from '../../components/Screen';
import { Text } from '../../components/Text';

export default function StaffRoute() {
  const { t } = useTranslation();
  return (
    <Screen>
      <Text variant="heading">{t('staff.routeTitle')}</Text>
      <EmptyState message={t('staff.routeEmpty')} />
    </Screen>
  );
}
