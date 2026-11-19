import { NavLink, Outlet } from 'react-router';
import { useTranslation } from 'react-i18next';
import { LogoMark, Wordmark } from './Logo';
import { ServerStatus } from './ServerStatus';

export const NAV_ITEMS = [
  { path: '/', key: 'today', phase: 'Phase 7' },
  { path: '/orders', key: 'orders', phase: 'Phase 4' },
  { path: '/deliveries', key: 'deliveries', phase: 'Phase 5' },
  { path: '/customers', key: 'customers', phase: 'Phase 3' },
  { path: '/stock', key: 'stock', phase: 'Phase 5' },
  { path: '/payments', key: 'payments', phase: 'Phase 6' },
  { path: '/reports', key: 'reports', phase: 'Phase 7' },
  { path: '/settings', key: 'settings', phase: 'Phase 7' },
] as const;

export function Layout() {
  const { t, i18n } = useTranslation();
  const toggle = () => void i18n.changeLanguage(i18n.language === 'ml' ? 'en' : 'ml');
  return (
    <div className="shell">
      <a className="skip-link" href="#main">
        {t('app.skipToContent')}
      </a>
      <nav className="sidebar" aria-label="Admin">
        <div className="brand">
          <LogoMark size={32} />
          <Wordmark />
        </div>
        <ul>
          {NAV_ITEMS.map((item) => (
            <li key={item.path}>
              <NavLink to={item.path} end={item.path === '/'}>
                {t(`nav.${item.key}`)}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>
      <div className="content">
        <header className="topbar">
          <ServerStatus />
          <button
            type="button"
            className="btn btn-secondary"
            onClick={toggle}
            aria-label={t('app.languageLabel')}
          >
            {t('app.language')}
          </button>
        </header>
        <p className="notice" role="note">
          {t('app.foundationNotice')}
        </p>
        <main id="main" tabIndex={-1}>
          <Outlet />
        </main>
      </div>
    </div>
  );
}
