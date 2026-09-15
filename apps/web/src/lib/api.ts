import {
  ErrorCode,
  messageFor,
  type ApiResponse,
  type LoginResult,
} from '@empire/shared';

const BASE_URL = (import.meta.env.VITE_API_URL as string | undefined) ?? '/api';
const VERSION = 'v1';

/**
 * A failure the UI can render. Carries the machine code so screens can branch
 * (INSUFFICIENT_COINS -> open the shop) instead of matching on English text.
 */
export class ApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
    readonly details?: unknown,
    readonly requestId?: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }

  get isAuthError(): boolean {
    return (
      this.status === 401 ||
      this.code === ErrorCode.UNAUTHENTICATED ||
      this.code === ErrorCode.TOKEN_EXPIRED
    );
  }
}

/* -------------------------------------------------------------------------- */
/* Token storage                                                               */
/* -------------------------------------------------------------------------- */

/**
 * The access token is held in memory only - never localStorage.
 *
 * localStorage is readable by any script on the page, so an XSS bug there
 * hands an attacker a working credential. Session continuity across a refresh
 * comes from the httpOnly refresh cookie instead, which JavaScript cannot read.
 */
let accessToken: string | null = null;
let onUnauthenticated: (() => void) | null = null;

export function setAccessToken(token: string | null): void {
  accessToken = token;
}
export function getAccessToken(): string | null {
  return accessToken;
}
export function setUnauthenticatedHandler(handler: (() => void) | null): void {
  onUnauthenticated = handler;
}

/* -------------------------------------------------------------------------- */
/* Refresh coordination                                                        */
/* -------------------------------------------------------------------------- */

/**
 * When several requests 401 at once, they must not all fire a refresh - that
 * would rotate the token N times and trip the server's reuse detection. The
 * first one refreshes; the rest await the same promise.
 */
let refreshInFlight: Promise<boolean> | null = null;

async function refreshSession(): Promise<boolean> {
  if (refreshInFlight) return refreshInFlight;

  refreshInFlight = (async () => {
    try {
      const response = await fetch(`${BASE_URL}/${VERSION}/auth/refresh`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      });
      if (!response.ok) return false;

      const body = (await response.json()) as ApiResponse<LoginResult>;
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

/* -------------------------------------------------------------------------- */
/* Core request                                                                */
/* -------------------------------------------------------------------------- */

export interface RequestOptions extends Omit<RequestInit, 'body'> {
  body?: unknown;
  /** Query string parameters; undefined/null values are dropped. */
  query?: Record<string, string | number | boolean | undefined | null>;
  /** Skip the automatic refresh-and-retry. Used by the auth calls themselves. */
  skipAuthRetry?: boolean;
  /** Value for the Idempotency-Key header on money-moving requests. */
  idempotencyKey?: string;
  timeoutMs?: number;
}

async function request<T>(
  method: string,
  path: string,
  options: RequestOptions = {},
): Promise<T> {
  const { body, query, skipAuthRetry, idempotencyKey, timeoutMs = 20_000, ...rest } = options;

  const url = new URL(
    `${BASE_URL}/${VERSION}${path.startsWith('/') ? path : `/${path}`}`,
    window.location.origin,
  );
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== null && value !== '') {
        url.searchParams.set(key, String(value));
      }
    }
  }

  const send = async (): Promise<Response> => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), timeoutMs);

    const headers: Record<string, string> = {
      Accept: 'application/json',
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
      ...((rest.headers as Record<string, string> | undefined) ?? {}),
    };

    try {
      return await fetch(url.toString(), {
        ...rest,
        method,
        headers,
        credentials: 'include',
        signal: controller.signal,
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
    } finally {
      window.clearTimeout(timer);
    }
  };

  let response: Response;
  try {
    response = await send();
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new ApiError('TIMEOUT', 'The server took too long to respond.', 0);
    }
    throw new ApiError(
      ErrorCode.SERVICE_UNAVAILABLE,
      'Could not reach the game server. Check your connection.',
      0,
    );
  }

  // One transparent refresh-and-retry on a 401.
  if (response.status === 401 && !skipAuthRetry) {
    const refreshed = await refreshSession();
    if (refreshed) {
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
    throw new ApiError(
      ErrorCode.INTERNAL_ERROR,
      'The server returned an unreadable response.',
      response.status,
    );
  }

  if (!response.ok || payload.success === false) {
    const error = 'error' in payload ? payload.error : undefined;
    const code = error?.code ?? ErrorCode.INTERNAL_ERROR;
    throw new ApiError(
      code,
      error?.message ?? messageFor(code),
      response.status,
      error?.details,
      error?.requestId,
    );
  }

  return payload.data;
}

export const api = {
  get: <T>(path: string, options?: RequestOptions) => request<T>('GET', path, options),
  post: <T>(path: string, body?: unknown, options?: RequestOptions) =>
    request<T>('POST', path, { ...options, body }),
  patch: <T>(path: string, body?: unknown, options?: RequestOptions) =>
    request<T>('PATCH', path, { ...options, body }),
  put: <T>(path: string, body?: unknown, options?: RequestOptions) =>
    request<T>('PUT', path, { ...options, body }),
  delete: <T>(path: string, options?: RequestOptions) => request<T>('DELETE', path, options),
  refreshSession,
};
