import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import type { Role } from '@wtrdrop/shared';
import { call, refreshAccess, setAccessToken, setSignedOutHandler } from './api';

export interface Me {
  id: string;
  name: string | null;
  phone: string;
  role: Role;
  supplier: { id: string; name: string };
}

interface AuthState {
  status: 'loading' | 'signedOut' | 'signedIn';
  me: Me | null;
  /** Called with the access token from a finished sign-in. */
  completeSignIn: (accessToken: string) => Promise<void>;
  signOut: () => Promise<void>;
}

const Ctx = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthState['status']>('loading');
  const [me, setMe] = useState<Me | null>(null);

  const signedOut = useCallback(() => {
    setAccessToken(null);
    setMe(null);
    setStatus('signedOut');
  }, []);

  const loadMe = useCallback(async () => {
    const m = await call<Me>('/me');
    if (m.role !== 'admin' && m.role !== 'owner') throw new Error('not an office account');
    setMe(m);
    setStatus('signedIn');
  }, []);

  useEffect(() => {
    setSignedOutHandler(signedOut);
    // A browser that signed in earlier still has the cookie: pick the session up again.
    void refreshAccess()
      .then((ok) => (ok ? loadMe() : signedOut()))
      .catch(signedOut);
  }, [loadMe, signedOut]);

  const value = useMemo<AuthState>(
    () => ({
      status,
      me,
      completeSignIn: async (token) => {
        setAccessToken(token);
        await loadMe();
      },
      signOut: async () => {
        await call('/auth/sign-out', { method: 'POST', body: {} }).catch(() => undefined);
        signedOut();
      },
    }),
    [status, me, loadMe, signedOut],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthState {
  const v = useContext(Ctx);
  if (!v) throw new Error('AuthProvider missing');
  return v;
}

export const isOwner = (me: Me | null) => me?.role === 'owner';
