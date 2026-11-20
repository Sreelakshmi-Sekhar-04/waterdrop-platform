import { apiErrorSchema, healthResponseSchema, type HealthResponse } from '@wtrdrop/shared';

/** Same origin by default (see vite.config.ts). Set VITE_API_URL only if the API is hosted elsewhere. */
const BASE = import.meta.env.VITE_API_URL ?? '';
/** Tells the API this is the admin portal: refresh token in an httpOnly cookie, never in page memory. */
const CLIENT_HEADER = { 'X-WtrDrop-Client': 'admin' };

export class ApiRequestError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

let accessToken: string | null = null;
let onSignedOut: () => void = () => undefined;
let refreshing: Promise<boolean> | null = null;

export function setAccessToken(t: string | null) {
  accessToken = t;
}
export function setSignedOutHandler(fn: () => void) {
  onSignedOut = fn;
}

async function raw(path: string, init: RequestInit = {}, withToken = true): Promise<Response> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json', ...CLIENT_HEADER };
  if (withToken && accessToken) headers.Authorization = `Bearer ${accessToken}`;
  if (init.method && !['GET', 'DELETE'].includes(init.method))
    headers['Idempotency-Key'] = crypto.randomUUID();
  try {
    return await fetch(`${BASE}/api/v1${path}`, {
      ...init,
      credentials: 'same-origin',
      headers: { ...headers, ...(init.headers as Record<string, string>) },
    });
  } catch {
    throw new ApiRequestError(0, 'NETWORK', 'Cannot reach the server');
  }
}

async function read<T>(res: Response): Promise<T> {
  const body: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const err = apiErrorSchema.safeParse(body);
    throw new ApiRequestError(
      res.status,
      err.success ? err.data.error.code : 'UNKNOWN',
      err.success ? err.data.error.message : `Request failed (${res.status})`,
      err.success ? err.data.error.details : undefined,
    );
  }
  return body as T;
}

/** Uses the httpOnly cookie to get a new access token. One refresh at a time. */
export function refreshAccess(): Promise<boolean> {
  refreshing ??= (async () => {
    try {
      const res = await raw('/auth/refresh', { method: 'POST', body: '{}' }, false);
      if (!res.ok) {
        accessToken = null;
        return false;
      }
      accessToken = ((await res.json()) as { accessToken: string }).accessToken;
      return true;
    } finally {
      refreshing = null;
    }
  })();
  return refreshing;
}

/** Signed-in call. A 401 refreshes once and retries; if that fails, the portal shows sign-in. */
export async function call<T>(
  path: string,
  init: { method?: string; body?: unknown } = {},
): Promise<T> {
  const req: RequestInit = {
    method: init.method ?? 'GET',
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  };
  let res = await raw(path, req);
  if (res.status === 401) {
    if (!(await refreshAccess())) {
      onSignedOut();
      throw new ApiRequestError(401, 'UNAUTHENTICATED', 'Please sign in again.');
    }
    res = await raw(path, req);
  }
  return read<T>(res);
}

/** Downloads a file (a CSV report) with the session, and hands it to the browser to save. */
export async function download(path: string, fallbackName: string): Promise<void> {
  let res = await raw(path);
  if (res.status === 401 && (await refreshAccess())) res = await raw(path);
  if (!res.ok) await read(res);
  const name =
    /filename="([^"]+)"/.exec(res.headers.get('content-disposition') ?? '')?.[1] ?? fallbackName;
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Calls that need no session (sign-in steps). */
export async function publicCall<T>(path: string, body: unknown): Promise<T> {
  return read<T>(await raw(path, { method: 'POST', body: JSON.stringify(body) }, false));
}

export const api = {
  health: async (): Promise<HealthResponse> =>
    healthResponseSchema.parse(await read(await raw('/health', {}, false))),
};
