import { createContext, useContext, type ReactNode } from 'react';
import type { Role } from '@wtrdrop/shared';

/**
 * The signed-in user. Always null in Phase 1: real OTP sign-in and secure token
 * storage are built in Phase 3. There is deliberately no fake login.
 */
export interface Session {
  userId: string;
  role: Role;
}

const SessionContext = createContext<Session | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  return <SessionContext.Provider value={null}>{children}</SessionContext.Provider>;
}

export function useSession(): Session | null {
  return useContext(SessionContext);
}

/** Where each role lands after sign-in. Admins use the web portal, not the app. */
export function homeFor(role: Role): '/(customer)/home' | '/(staff)/route' | null {
  if (role === 'customer') return '/(customer)/home';
  if (role === 'staff') return '/(staff)/route';
  return null;
}
