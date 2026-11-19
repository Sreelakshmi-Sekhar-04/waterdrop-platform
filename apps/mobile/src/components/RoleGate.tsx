import type { ReactNode } from 'react';
import { Redirect } from 'expo-router';
import type { Role } from '@wtrdrop/shared';
import { homeFor, useSession } from '../lib/session';
import { PreviewBanner } from './PreviewBanner';

/**
 * Keeps each role inside its own screens. Real permission checks always happen
 * on the server; this only stops the app from showing the wrong navigation.
 * Development builds may open the screens without signing in, clearly marked as a preview.
 */
export function RoleGate({ role, children }: { role: Role; children: ReactNode }) {
  const session = useSession();
  if (!session) {
    if (__DEV__) {
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
  return <>{children}</>;
}
