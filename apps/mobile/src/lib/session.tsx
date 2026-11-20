import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import * as Crypto from 'expo-crypto';
import type { Role } from '@wtrdrop/shared';
import { api, API_URL, ApiError, setTokenSource } from './api';
import { unregisterPush } from './push';
import { KEYS, secure } from './storage';

/**
 * The signed-in user, from a real server session (Phase 3).
 * Access token: memory only. Refresh token: secure storage.
 */
export interface Session {
  userId: string;
  role: Role;
  name: string | null;
  phone: string;
}

export interface SignedIn {
  role: Role;
  accessToken: string;
  refreshToken: string;
}

interface SessionState {
  status: 'loading' | 'signedOut' | 'signedIn';
  session: Session | null;
  signIn: (r: SignedIn) => Promise<Session>;
  signOut: () => Promise<void>;
  reload: () => Promise<void>;
}

const Ctx = createContext<SessionState | null>(null);

interface MeResponse {
  id: string;
  name: string | null;
  phone: string;
  role: Role;
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<SessionState['status']>('loading');
  const [session, setSession] = useState<Session | null>(null);
  const access = useRef<string | null>(null);
  const refreshing = useRef<Promise<string | null> | null>(null);

  const clear = useCallback(async () => {
    access.current = null;
    await secure.remove(KEYS.refreshToken);
    await secure.remove(KEYS.role);
    setSession(null);
    setStatus('signedOut');
  }, []);

  // One refresh at a time: two parallel refreshes would look like token theft to the server.
  const refresh = useCallback(() => {
    refreshing.current ??= (async () => {
      try {
        const token = await secure.get(KEYS.refreshToken);
        if (!token) return null;
        const res = await fetch(`${API_URL}/api/v1/auth/refresh`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ refreshToken: token }),
        }).catch(() => null);
        if (!res) throw new ApiError(0, 'NETWORK', 'No internet connection');
        if (!res.ok) {
          await clear();
          return null;
        }
        const body = (await res.json()) as { accessToken: string; refreshToken: string };
        access.current = body.accessToken;
        await secure.set(KEYS.refreshToken, body.refreshToken);
        return body.accessToken;
      } finally {
        refreshing.current = null;
      }
    })();
    return refreshing.current;
  }, [clear]);

  useEffect(() => {
    setTokenSource({ getAccessToken: () => access.current, refresh });
  }, [refresh]);

  const loadMe = useCallback(async () => {
    const me = await api<MeResponse>('/me');
    const s = { userId: me.id, role: me.role, name: me.name, phone: me.phone };
    setSession(s);
    setStatus('signedIn');
    return s;
  }, []);

  useEffect(() => {
    void (async () => {
      try {
        if (!(await refresh())) return setStatus('signedOut');
        await loadMe();
      } catch {
        // Offline at start-up: stay signed out of the UI but keep the stored token for next time.
        setStatus('signedOut');
      }
    })();
  }, [refresh, loadMe]);

  const value = useMemo<SessionState>(
    () => ({
      status,
      session,
      signIn: async (r) => {
        access.current = r.accessToken;
        await secure.set(KEYS.refreshToken, r.refreshToken);
        await secure.set(KEYS.role, r.role);
        return loadMe();
      },
      signOut: async () => {
        // While the session is still open, so the server takes this phone's token away.
        await unregisterPush();
        try {
          await api('/auth/sign-out', { method: 'POST', body: {} });
        } catch {
          /* signing out locally is what matters */
        }
        await clear();
      },
      reload: async () => {
        await loadMe();
      },
    }),
    [status, session, loadMe, clear],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSessionState(): SessionState {
  const s = useContext(Ctx);
  if (!s) throw new Error('SessionProvider missing');
  return s;
}

export function useSession(): Session | null {
  return useSessionState().session;
}

/** A random id for this phone, kept in secure storage. Staff PINs are bound to it. */
export async function deviceId(): Promise<string> {
  const existing = await secure.get(KEYS.deviceId);
  if (existing) return existing;
  const id = Crypto.randomUUID();
  await secure.set(KEYS.deviceId, id);
  return id;
}

/** Where each role lands after sign-in. Admins use the web portal, not the app. */
export function homeFor(role: Role): '/(customer)/home' | '/(staff)/route' | null {
  if (role === 'customer') return '/(customer)/home';
  if (role === 'staff') return '/(staff)/route';
  return null;
}
