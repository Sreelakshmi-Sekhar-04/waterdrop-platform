import { useTranslation } from 'react-i18next';
import { BottomNav } from './BottomNav';

export function CustomerNav() {
  const { t } = useTranslation();
  return (
    <BottomNav
      items={[
        { href: '/(customer)/home', path: '/home', label: t('nav.home'), icon: 'home' },
        { href: '/(customer)/orders', path: '/orders', label: t('nav.orders'), icon: 'orders' },
        { href: '/(customer)/help', path: '/help', label: t('nav.help'), icon: 'help' },
      ]}
    />
  );
}
