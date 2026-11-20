import { Platform } from 'react-native';
import * as Crypto from 'expo-crypto';
import { apiErrorSchema } from '@wtrdrop/shared';

/**
 * Where the API runs. Set EXPO_PUBLIC_API_URL for real builds.
 * Development default: this computer (Android emulators reach it as 10.0.2.2).
 */
export const API_URL =
  process.env.EXPO_PUBLIC_API_URL ??
  (Platform.OS === 'android' ? 'http://10.0.2.2:4000' : 'http://localhost:4000');

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

type TokenSource = {
  getAccessToken: () => string | null;
  /** Gets a new access token with the refresh token. Returns null when signed out. */
  refresh: () => Promise<string | null>;
};
let tokens: TokenSource = { getAccessToken: () => null, refresh: async () => null };
export function setTokenSource(t: TokenSource) {
  tokens = t;
}

async function send(path: string, init: RequestInit, accessToken: string | null) {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    accept: 'application/json',
  };
  if (accessToken) headers.authorization = `Bearer ${accessToken}`;
  // Every change carries a unique key, so a retry after a dropped connection is not applied twice.
  if (init.method && init.method !== 'GET' && init.method !== 'DELETE') {
    headers['idempotency-key'] = Crypto.randomUUID();
  }
  try {
    return await fetch(`${API_URL}/api/v1${path}`, {
      ...init,
      headers: { ...headers, ...(init.headers as object) },
    });
  } catch {
    throw new ApiError(0, 'NETWORK', 'No internet connection');
  }
}

async function parse<T>(res: Response): Promise<T> {
  const body = await res.json().catch(() => null);
  if (res.ok) return body as T;
  const err = apiErrorSchema.safeParse(body);
  if (err.success)
    throw new ApiError(
      res.status,
      err.data.error.code,
      err.data.error.message,
      err.data.error.details,
    );
  throw new ApiError(res.status, 'UNKNOWN', 'Something went wrong');
}

/** Calls the API. With auth, a 401 triggers one token refresh and one retry. */
export async function api<T>(
  path: string,
  opts: { method?: string; body?: unknown; auth?: boolean } = {},
) {
  const init: RequestInit = {
    method: opts.method ?? 'GET',
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  };
  if (opts.auth === false) return parse<T>(await send(path, init, null));
  let res = await send(path, init, tokens.getAccessToken());
  if (res.status === 401) {
    const fresh = await tokens.refresh();
    if (!fresh) throw new ApiError(401, 'UNAUTHENTICATED', 'Please sign in again.');
    res = await send(path, init, fresh);
  }
  return parse<T>(res);
}
