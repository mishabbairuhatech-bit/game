import { create } from 'zustand';
import { SESSION_HINT_COOKIE_NAME, type AuthUser, type LoginResult } from '@empire/shared';
import { api, ApiError, setAccessToken, setUnauthenticatedHandler } from '../lib/api';

interface AuthState {
  user: AuthUser | null;
  /** True until the initial silent refresh has settled. */
  initialising: boolean;
  busy: boolean;
  error: string | null;
  errorCode: string | null;

  bootstrap: () => Promise<void>;
  login: (email: string, password: string) => Promise<boolean>;
  register: (input: {
    email: string;
    username: string;
    password: string;
    empireName?: string;
  }) => Promise<boolean>;
  logout: () => Promise<void>;
  adoptOAuthToken: (accessToken: string) => Promise<boolean>;
  clearError: () => void;
}

/**
 * Reads the non-httpOnly session hint. It carries no secret: a forged flag
 * only causes one refresh attempt, which the server rejects on the real
 * cookie's merits.
 */
function hasSessionHint(): boolean {
  return document.cookie
    .split(';')
    .some((c) => c.trim().startsWith(`${SESSION_HINT_COOKIE_NAME}=`));
}

/** Removes the hint locally so a failed bootstrap does not retry every load. */
function clearSessionHint(): void {
  document.cookie = `${SESSION_HINT_COOKIE_NAME}=; Max-Age=0; path=/`;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  initialising: true,
  busy: false,
  error: null,
  errorCode: null,

  /**
   * Runs once at startup. The access token lives in memory only, so after a
   * page refresh the only thing that survives is the httpOnly refresh cookie -
   * trading it for a new access token here is what makes "stay signed in"
   * work without ever exposing a long-lived credential to JavaScript.
   *
   * The refresh cookie is invisible to JavaScript, so a readable companion
   * flag tells us whether the attempt is worth making. A first-time visitor
   * therefore goes straight to the login screen instead of eating a 401.
   */
  async bootstrap() {
    setUnauthenticatedHandler(() => set({ user: null }));

    if (!hasSessionHint()) {
      set({ user: null, initialising: false });
      return;
    }

    try {
      const refreshed = await api.refreshSession();
      if (!refreshed) {
        clearSessionHint();
        set({ user: null, initialising: false });
        return;
      }
      const user = await api.get<AuthUser>('/auth/me', { skipAuthRetry: true });
      set({ user, initialising: false });
    } catch {
      clearSessionHint();
      set({ user: null, initialising: false });
    }
  },

  async login(email, password) {
    set({ busy: true, error: null, errorCode: null });
    try {
      const result = await api.post<LoginResult>(
        '/auth/login',
        { email, password },
        { skipAuthRetry: true },
      );
      setAccessToken(result.accessToken);
      set({ user: result.user, busy: false });
      return true;
    } catch (error) {
      set({
        busy: false,
        error: error instanceof ApiError ? error.message : 'Could not sign in.',
        errorCode: error instanceof ApiError ? error.code : null,
      });
      return false;
    }
  },

  async register(input) {
    set({ busy: true, error: null, errorCode: null });
    try {
      const result = await api.post<LoginResult>('/auth/register', input, {
        skipAuthRetry: true,
      });
      setAccessToken(result.accessToken);
      set({ user: result.user, busy: false });
      return true;
    } catch (error) {
      set({
        busy: false,
        error: error instanceof ApiError ? error.message : 'Could not create the account.',
        errorCode: error instanceof ApiError ? error.code : null,
      });
      return false;
    }
  },

  async logout() {
    try {
      await api.post('/auth/logout', {}, { skipAuthRetry: true });
    } catch {
      // A failed logout call must still clear local state.
    }
    setAccessToken(null);
    clearSessionHint();
    set({ user: null, error: null, errorCode: null });
  },

  /** Completes the Google redirect: the token arrives in the URL fragment. */
  async adoptOAuthToken(accessToken) {
    setAccessToken(accessToken);
    try {
      const user = await api.get<AuthUser>('/auth/me', { skipAuthRetry: true });
      set({ user, initialising: false });
      return true;
    } catch {
      setAccessToken(null);
      set({ user: null, initialising: false, error: 'Google sign-in did not complete.' });
      return false;
    }
  },

  clearError() {
    if (get().error) set({ error: null, errorCode: null });
  },
}));
