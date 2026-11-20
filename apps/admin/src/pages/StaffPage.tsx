import { useTranslation } from 'react-i18next';
import { PageHeader } from '../components/ui';
import { TeamTable } from '../components/TeamTable';

export function StaffPage() {
  const { t } = useTranslation();
  return (
    <div className="page">
      <PageHeader title={t('nav.staff')} subtitle={t('team.staffIntro')} />
      <TeamTable kind="staff" />
    </div>
  );
}
