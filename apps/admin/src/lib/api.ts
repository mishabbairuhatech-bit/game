import { ErrorCode, messageFor, type ApiResponse, type LoginResult } from '@empire/shared';

const BASE_URL = (import.meta.env.VITE_API_URL as string | undefined) ?? '/api';
const VERSION = 'v1';

export class ApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/**
 * Same in-memory-token design as the game client: the admin panel holds a
 * privileged credential, so keeping it out of localStorage matters even more
 * here. Continuity comes from the httpOnly refresh cookie.
 */
let accessToken: string | null = null;
let onUnauthenticated: (() => void) | null = null;

export function setAccessToken(token: string | null) {
  accessToken = token;
}
export function setUnauthenticatedHandler(handler: (() => void) | null) {
  onUnauthenticated = handler;
}

let refreshInFlight: Promise<boolean> | null = null;

export async function refreshSession(): Promise<boolean> {
  if (refreshInFlight) return refreshInFlight;
  refreshInFlight = (async () => {
    try {
      const res = await fetch(`${BASE_URL}/${VERSION}/auth/refresh`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      });
      if (!res.ok) return false;
      const body = (await res.json()) as ApiResponse<LoginResult>;
      if (!body.success) return false;
      accessToken = body.data.accessToken;
      return true;
    } catch {
      return false;
    } finally {
      refreshInFlight = null;
    }
  })();
  return refreshInFlight;
}

interface Options extends Omit<RequestInit, 'body'> {
  body?: unknown;
  query?: Record<string, string | number | boolean | undefined | null>;
  skipAuthRetry?: boolean;
}

async function request<T>(method: string, path: string, options: Options = {}): Promise<T> {
  const { body, query, skipAuthRetry, ...rest } = options;

  const url = new URL(`${BASE_URL}/${VERSION}${path}`, window.location.origin);
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v));
    }
  }

  const send = () =>
    fetch(url.toString(), {
      ...rest,
      method,
      credentials: 'include',
      headers: {
        Accept: 'application/json',
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
        ...((rest.headers as Record<string, string> | undefined) ?? {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });

  let response: Response;
  try {
    response = await send();
  } catch {
    throw new ApiError(ErrorCode.SERVICE_UNAVAILABLE, 'Could not reach the API.', 0);
  }

  if (response.status === 401 && !skipAuthRetry) {
    if (await refreshSession()) {
      response = await send();
    } else {
      accessToken = null;
      onUnauthenticated?.();
    }
  }

  if (response.status === 204) return undefined as T;

  let payload: ApiResponse<T>;
  try {
    payload = (await response.json()) as ApiResponse<T>;
  } catch {
    throw new ApiError(ErrorCode.INTERNAL_ERROR, 'Unreadable response.', response.status);
  }

  if (!response.ok || payload.success === false) {
    const error = 'error' in payload ? payload.error : undefined;
    const code = error?.code ?? ErrorCode.INTERNAL_ERROR;
    throw new ApiError(code, error?.message ?? messageFor(code), response.status, error?.details);
  }

  return payload.data;
}

export const api = {
  get: <T>(path: string, options?: Options) => request<T>('GET', path, options),
  post: <T>(path: string, body?: unknown, options?: Options) =>
    request<T>('POST', path, { ...options, body }),
  patch: <T>(path: string, body?: unknown, options?: Options) =>
    request<T>('PATCH', path, { ...options, body }),
  delete: <T>(path: string, options?: Options) => request<T>('DELETE', path, options),
};
