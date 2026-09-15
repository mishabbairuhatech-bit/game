import { useCallback, useEffect, useState } from 'react';
import { Navigate, NavLink, Route, Routes } from 'react-router-dom';
import { Alert, Badge, Button, Field, Panel, Spinner } from '@empire/ui';
import {
  ROLE_RANK,
  SESSION_HINT_COOKIE_NAME,
  type AuthUser,
  type UserRole,
} from '@empire/shared';
import { api, ApiError, refreshSession, setAccessToken, setUnauthenticatedHandler } from './lib/api';
import { DashboardPage } from './pages/DashboardPage';
import { GameConfigPage } from './pages/GameConfigPage';
import { SystemPage } from './pages/SystemPage';

/** Minimum role allowed into the panel at all. */
const MIN_ROLE: UserRole = 'MODERATOR';

/**
 * The refresh cookie is httpOnly, so the client cannot see whether a session
 * exists. This readable companion flag - set by the API next to it, and
 * carrying no secret - avoids a speculative 401 on every cold load.
 */
const hasSessionHint = () =>
  document.cookie.split(';').some((c) => c.trim().startsWith(`${SESSION_HINT_COOKIE_NAME}=`));

const clearSessionHint = () => {
  document.cookie = `${SESSION_HINT_COOKIE_NAME}=; Max-Age=0; path=/`;
};

export function App() {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [initialising, setInitialising] = useState(true);

  const bootstrap = useCallback(async () => {
    setUnauthenticatedHandler(() => setUser(null));

    if (!hasSessionHint()) {
      setInitialising(false);
      return;
    }

    try {
      if (await refreshSession()) {
        const me = await api.get<AuthUser>('/auth/me', { skipAuthRetry: true });
        setUser(me);
      } else {
        clearSessionHint();
      }
    } catch {
      clearSessionHint();
      setUser(null);
    } finally {
      setInitialising(false);
    }
  }, []);

  useEffect(() => {
    void bootstrap();
  }, [bootstrap]);

  const signOut = async () => {
    try {
      await api.post('/auth/logout', {}, { skipAuthRetry: true });
    } catch {
      /* clear local state regardless */
    }
    setAccessToken(null);
    clearSessionHint();
    setUser(null);
  };

  if (initialising) {
    return (
      <div className="flex h-full items-center justify-center gap-2 text-sm text-parchment-500">
        <Spinner className="h-4 w-4" /> Restoring session…
      </div>
    );
  }

  if (!user) return <SignInPage onSignedIn={setUser} />;

  // The API enforces this on every admin endpoint; the check here only avoids
  // showing a shell full of calls that would all 403.
  if (ROLE_RANK[user.role] < ROLE_RANK[MIN_ROLE]) {
    return (
      <div className="flex h-full items-center justify-center p-6">
        <div className="w-full max-w-md">
          <Panel title="Not authorised">
            <Alert tone="error" title="This account cannot use the operations panel">
              Signed in as <strong>{user.username}</strong> with the role{' '}
              <strong>{user.role}</strong>. The panel requires {MIN_ROLE} or higher.
            </Alert>
            <Button className="mt-4" variant="secondary" onClick={signOut} fullWidth>
              Sign out
            </Button>
          </Panel>
        </div>
      </div>
    );
  }

  return <Shell user={user} onSignOut={signOut} />;
}

/* -------------------------------------------------------------------------- */
/* Shell                                                                       */
/* -------------------------------------------------------------------------- */

interface NavEntry {
  to: string;
  label: string;
  availableIn: number;
}

const NAV: NavEntry[] = [
  { to: '/', label: 'Dashboard', availableIn: 1 },
  { to: '/config', label: 'Game configuration', availableIn: 1 },
  { to: '/system', label: 'System health', availableIn: 1 },
  { to: '/users', label: 'Users', availableIn: 9 },
  { to: '/land', label: 'Land & plots', availableIn: 9 },
  { to: '/buildings', label: 'Buildings & units', availableIn: 9 },
  { to: '/battles', label: 'Battles', availableIn: 9 },
  { to: '/marketplace', label: 'Marketplace', availableIn: 9 },
  { to: '/payments', label: 'Payments', availableIn: 9 },
  { to: '/currencies', label: 'Currency ledger', availableIn: 9 },
  { to: '/reports', label: 'Reports & moderation', availableIn: 9 },
  { to: '/audit', label: 'Audit log', availableIn: 9 },
  { to: '/anticheat', label: 'Anti-cheat', availableIn: 9 },
];

const CURRENT_PHASE = 1;

function Shell({ user, onSignOut }: { user: AuthUser; onSignOut: () => void }) {
  return (
    <div className="flex h-full">
      <aside className="flex w-60 shrink-0 flex-col border-r border-ink-700/80 bg-ink-900">
        <div className="border-b border-ink-700/80 px-4 py-4">
          <p className="font-display text-sm tracking-[0.18em] text-brass-300">
            EMPIRE FRONTIER
          </p>
          <p className="mt-0.5 text-[11px] uppercase tracking-wider text-parchment-600">
            Operations
          </p>
        </div>

        <nav className="flex-1 overflow-y-auto p-2">
          {NAV.map((entry) => {
            const enabled = entry.availableIn <= CURRENT_PHASE;
            return enabled ? (
              <NavLink
                key={entry.to}
                to={entry.to}
                end={entry.to === '/'}
                className={({ isActive }) =>
                  `flex items-center justify-between rounded-md px-3 py-2 text-[13px] font-medium transition-colors ${
                    isActive
                      ? 'bg-brass-500 text-ink-950'
                      : 'text-parchment-300 hover:bg-ink-800 hover:text-parchment-100'
                  }`
                }
              >
                {entry.label}
              </NavLink>
            ) : (
              <div
                key={entry.to}
                title={`Arrives in phase ${entry.availableIn}`}
                className="flex cursor-not-allowed items-center justify-between rounded-md px-3 py-2 text-[13px] text-parchment-700"
              >
                {entry.label}
                <span className="text-[9px] uppercase tracking-wider">
                  P{entry.availableIn}
                </span>
              </div>
            );
          })}
        </nav>

        <div className="border-t border-ink-700/80 p-3">
          <div className="mb-2 flex items-center gap-2">
            <div className="min-w-0">
              <p className="truncate text-xs font-semibold text-parchment-200">
                {user.username}
              </p>
              <p className="truncate text-[10px] text-parchment-600">{user.email}</p>
            </div>
            <Badge tone={user.role === 'SUPER_ADMIN' ? 'gold' : 'info'} className="ml-auto">
              {user.role.replace('_', ' ')}
            </Badge>
          </div>
          <Button size="sm" variant="secondary" fullWidth onClick={onSignOut}>
            Sign out
          </Button>
        </div>
      </aside>

      <main className="flex-1 overflow-y-auto bg-ink-950">
        <Routes>
          <Route path="/" element={<DashboardPage />} />
          <Route path="/config" element={<GameConfigPage role={user.role} />} />
          <Route path="/system" element={<SystemPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Sign-in                                                                     */
/* -------------------------------------------------------------------------- */

function SignInPage({ onSignedIn }: { onSignedIn: (user: AuthUser) => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const result = await api.post<{ accessToken: string; user: AuthUser }>(
        '/auth/login',
        { email, password },
        { skipAuthRetry: true },
      );
      setAccessToken(result.accessToken);
      onSignedIn(result.user);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not sign in.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex h-full items-center justify-center bg-frontier px-4">
      <div className="w-full max-w-sm">
        <header className="mb-6 text-center">
          <p className="font-display text-xl tracking-[0.18em] text-brass-300">
            EMPIRE FRONTIER
          </p>
          <p className="mt-1 text-xs uppercase tracking-[0.2em] text-parchment-600">
            Operations panel
          </p>
        </header>

        <Panel title="Staff sign-in">
          <form onSubmit={submit} className="flex flex-col gap-4">
            <Field
              label="Email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
            <Field
              label="Password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
            {error && <Alert tone="error">{error}</Alert>}
            <Button type="submit" variant="gold" loading={busy} fullWidth>
              Sign in
            </Button>
          </form>
          <p className="mt-4 text-[11px] leading-relaxed text-parchment-600">
            The bootstrap administrator is created by the database seed. Its one-time
            password is printed to the API log on first run — find it with{' '}
            <code className="text-parchment-400">docker compose logs backend</code>.
          </p>
        </Panel>
      </div>
    </div>
  );
}
