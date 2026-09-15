import { useState, type FormEvent } from 'react';
import { Alert, Button, Field, Panel } from '@empire/ui';
import { USERNAME_PATTERN, validatePassword } from '@empire/shared';
import { useAuthStore } from '../store/auth.store';
import { api, ApiError } from '../lib/api';

type Mode = 'login' | 'register' | 'forgot';

export function AuthScreen() {
  const [mode, setMode] = useState<Mode>('login');
  const { login, register, busy, error, errorCode, clearError } = useAuthStore();

  const [email, setEmail] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [empireName, setEmpireName] = useState('');
  const [notice, setNotice] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const switchMode = (next: Mode) => {
    setMode(next);
    setNotice(null);
    setFieldErrors({});
    clearError();
  };

  /**
   * Client-side validation is a courtesy that saves a round trip. It uses the
   * exact same rules the server enforces (imported from @empire/shared), and
   * the server remains the authority - passing here guarantees nothing.
   */
  const validate = (): boolean => {
    const errors: Record<string, string> = {};

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      errors.email = 'Enter a valid email address.';
    }

    if (mode === 'register') {
      if (!USERNAME_PATTERN.test(username)) {
        errors.username = '3-20 characters: letters, numbers and underscores.';
      }
      const check = validatePassword(password);
      if (!check.ok) errors.password = check.reasons[0] ?? 'Choose a stronger password.';
    }

    if (mode === 'login' && password.length === 0) {
      errors.password = 'Enter your password.';
    }

    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setNotice(null);
    if (!validate()) return;

    if (mode === 'forgot') {
      try {
        await api.post('/auth/password/forgot', { email }, { skipAuthRetry: true });
      } catch (e) {
        // The endpoint intentionally cannot fail in a way that reveals whether
        // the address exists; only surface transport problems.
        if (e instanceof ApiError && e.status === 0) {
          setNotice('Could not reach the server. Try again in a moment.');
          return;
        }
      }
      setNotice(
        'If that address has an account, a reset link is on its way. ' +
          'In development the link is printed to the API log.',
      );
      return;
    }

    if (mode === 'login') {
      await login(email, password);
      return;
    }

    await register({
      email,
      username,
      password,
      empireName: empireName.trim() || undefined,
    });
  };

  const resendVerification = async () => {
    try {
      await api.post('/auth/verify/resend', { email }, { skipAuthRetry: true });
      setNotice('A fresh verification link has been sent.');
    } catch {
      setNotice('Could not send the link right now.');
    }
  };

  return (
    <div className="flex min-h-full items-center justify-center bg-frontier px-4 py-10">
      <div className="w-full max-w-md">
        <header className="mb-8 text-center">
          <h1 className="font-display text-4xl font-bold tracking-tight text-brass-300 text-shadow-plate">
            EMPIRE FRONTIER
          </h1>
          <p className="mt-2 text-sm text-parchment-400">
            Claim ground. Raise walls. Hold the frontier.
          </p>
        </header>

        <Panel
          title={
            mode === 'login'
              ? 'Commander sign-in'
              : mode === 'register'
                ? 'Found your empire'
                : 'Recover access'
          }
          subtitle={
            mode === 'register'
              ? 'Your starting territory, buildings and garrison are granted on signup.'
              : undefined
          }
        >
          <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
            <Field
              label="Email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              error={fieldErrors.email}
              placeholder="commander@example.com"
              required
            />

            {mode === 'register' && (
              <Field
                label="Commander name"
                autoComplete="username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                error={fieldErrors.username}
                hint="Shown on leaderboards and battle reports."
                placeholder="IronGate_92"
                required
              />
            )}

            {mode !== 'forgot' && (
              <Field
                label="Password"
                type="password"
                autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                error={fieldErrors.password}
                hint={
                  mode === 'register'
                    ? 'At least 10 characters, with upper case, lower case and a number.'
                    : undefined
                }
                required
              />
            )}

            {mode === 'register' && (
              <Field
                label="Empire name (optional)"
                value={empireName}
                onChange={(e) => setEmpireName(e.target.value)}
                placeholder="The Iron Marches"
                maxLength={40}
              />
            )}

            {error && (
              <Alert tone="error">
                {error}
                {errorCode === 'EMAIL_NOT_VERIFIED' && (
                  <button
                    type="button"
                    onClick={resendVerification}
                    className="ml-1 underline hover:no-underline"
                  >
                    Resend the link.
                  </button>
                )}
              </Alert>
            )}

            {notice && <Alert tone="info">{notice}</Alert>}

            <Button type="submit" size="lg" variant="gold" loading={busy} fullWidth>
              {mode === 'login'
                ? 'Enter the frontier'
                : mode === 'register'
                  ? 'Claim my territory'
                  : 'Send reset link'}
            </Button>
          </form>

          <div className="mt-5 border-t border-ink-700/70 pt-4">
            <a
              href="/api/v1/auth/google"
              className="flex h-10 w-full items-center justify-center gap-2 rounded-md border border-ink-600 bg-ink-800/70 text-sm font-semibold text-parchment-200 transition-colors hover:bg-ink-700"
            >
              <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden="true">
                <path
                  fill="#4285F4"
                  d="M22.5 12.2c0-.8-.1-1.4-.2-2.1H12v4h6c-.1 1-.8 2.5-2.2 3.5l-.1.1 3.3 2.5c1.9-1.8 3.5-4.4 3.5-8z"
                />
                <path
                  fill="#34A853"
                  d="M12 23c2.9 0 5.3-1 7-2.6l-3.3-2.6c-.9.6-2.1 1-3.7 1-2.8 0-5.2-1.9-6.1-4.4l-.1.1-3.4 2.6C4.1 20.5 7.8 23 12 23z"
                />
                <path
                  fill="#FBBC05"
                  d="M5.9 14.4c-.2-.7-.4-1.4-.4-2.2s.1-1.5.4-2.2V9.9L2.4 7.3A11 11 0 0 0 1 12.2c0 1.8.4 3.5 1.2 4.9l3.7-2.7z"
                />
                <path
                  fill="#EA4335"
                  d="M12 5.5c2 0 3.3.9 4.1 1.6l3-2.9C17.3 2.6 14.9 1.5 12 1.5 7.8 1.5 4.1 4 2.4 7.3l3.5 2.7C6.8 7.4 9.2 5.5 12 5.5z"
                />
              </svg>
              Continue with Google
            </a>
            <p className="mt-2 text-center text-[11px] text-parchment-600">
              Available once the server is configured with Google credentials.
            </p>
          </div>
        </Panel>

        <nav className="mt-5 flex flex-col items-center gap-2 text-sm">
          {mode === 'login' && (
            <>
              <button
                type="button"
                className="text-brass-300 hover:text-brass-200"
                onClick={() => switchMode('register')}
              >
                No empire yet? Found one.
              </button>
              <button
                type="button"
                className="text-parchment-500 hover:text-parchment-300"
                onClick={() => switchMode('forgot')}
              >
                Forgot your password?
              </button>
            </>
          )}
          {mode !== 'login' && (
            <button
              type="button"
              className="text-brass-300 hover:text-brass-200"
              onClick={() => switchMode('login')}
            >
              Back to sign-in
            </button>
          )}
        </nav>

        <p className="mt-8 text-center text-[11px] leading-relaxed text-parchment-700">
          Plots, resources and currencies in Empire Frontier are virtual in-game items.
          They carry no real-world value, confer no real-world property rights, and are
          not an investment.
        </p>
      </div>
    </div>
  );
}
