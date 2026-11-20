import { NavLink, Outlet } from 'react-router';
import { useTranslation } from 'react-i18next';
import { LogoMark, Wordmark } from './Logo';
import { ServerStatus } from './ServerStatus';
import { useAuth } from '../lib/auth';

export const NAV_ITEMS = [
  { path: '/', key: 'today', phase: 'Phase 7' },
  { path: '/orders', key: 'orders', phase: 'Phase 4' },
  { path: '/deliveries', key: 'deliveries', phase: 'Phase 5' },
  { path: '/customers', key: 'customers', phase: 'Phase 3' },
  { path: '/staff', key: 'staff', phase: 'Phase 3' },
  { path: '/stock', key: 'stock', phase: 'Phase 5' },
  { path: '/payments', key: 'payments', phase: 'Phase 6' },
  { path: '/complaints', key: 'complaints', phase: 'Phase 7' },
  { path: '/reports', key: 'reports', phase: 'Phase 7' },
  { path: '/settings', key: 'settings', phase: 'Phase 7' },
] as const;

export function Layout() {
  const { t, i18n } = useTranslation();
  const { me, signOut } = useAuth();
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
          <div className="topbar-actions">
            <span className="who" data-testid="signed-in-as">
              {me?.name ?? ''} · {t(`roles.${me?.role ?? 'admin'}`)}
            </span>
            <button type="button" className="btn btn-secondary" onClick={() => void signOut()}>
              {t('app.signOut')}
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={toggle}
              aria-label={t('app.languageLabel')}
            >
              {t('app.language')}
            </button>
          </div>
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
