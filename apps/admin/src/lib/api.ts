import { apiErrorSchema, healthResponseSchema, type HealthResponse } from '@wtrdrop/shared';

const BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:4000';

export class ApiRequestError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

async function request<T>(path: string, parse: (v: unknown) => T, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${BASE}/api/v1${path}`, {
      ...init,
      headers: { 'Content-Type': 'application/json', ...init?.headers },
    });
  } catch {
    throw new ApiRequestError(0, 'NETWORK', 'Cannot reach the server');
  }
  const body: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const err = apiErrorSchema.safeParse(body);
    throw new ApiRequestError(
      res.status,
      err.success ? err.data.error.code : 'UNKNOWN',
      err.success ? err.data.error.message : `Request failed (${res.status})`,
    );
  }
  return parse(body);
}

export const api = {
  health: (): Promise<HealthResponse> => request('/health', (v) => healthResponseSchema.parse(v)),
};
