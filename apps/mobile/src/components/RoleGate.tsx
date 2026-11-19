import type { ReactNode } from 'react';
import { Redirect, usePathname } from 'expo-router';
import type { Role } from '@wtrdrop/shared';
import { homeFor, useSessionState } from '../lib/session';
import { PreviewBanner } from './PreviewBanner';
import { Skeleton } from './States';
import { Screen } from './Screen';

/** Screens already connected to the server. All others still show Phase 2 demo data. */
const LIVE_SCREENS = new Set(['/account', '/address', '/profile-setup']);

/**
 * Keeps each role inside its own screens. Real permission checks always happen
 * on the server; this only stops the app from showing the wrong navigation.
 * With EXPO_PUBLIC_PREVIEW=1 in a development build, the screens open without
 * signing in for design review, clearly marked as a preview.
 */
export function RoleGate({ role, children }: { role: Role; children: ReactNode }) {
  const { status, session } = useSessionState();
  const path = usePathname();
  const preview = __DEV__ && process.env.EXPO_PUBLIC_PREVIEW === '1';
  if (status === 'loading') {
    return (
      <Screen>
        <Skeleton lines={4} />
      </Screen>
    );
  }
  if (!session) {
    if (preview && !LIVE_SCREENS.has(path)) {
      return (
        <>
          <PreviewBanner />
          {children}
        </>
      );
    }
    return <Redirect href="/" />;
  }
  if (session.role !== role) {
    const home = homeFor(session.role);
    return <Redirect href={home ?? '/'} />;
  }
  return (
    <>
      {LIVE_SCREENS.has(path) ? null : <PreviewBanner />}
      {children}
    </>
  );
}
