import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Alert, Button, Field, Panel } from '@empire/ui';
import { validatePassword } from '@empire/shared';
import { api, ApiError } from '../lib/api';

export function ResetPasswordScreen() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const token = params.get('token');

  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    setFieldError(null);

    const check = validatePassword(password);
    if (!check.ok) {
      setFieldError(check.reasons[0] ?? 'Choose a stronger password.');
      return;
    }
    if (password !== confirm) {
      setFieldError('The two passwords do not match.');
      return;
    }
    if (!token) {
      setError('This link is missing its reset token.');
      return;
    }

    setBusy(true);
    try {
      await api.post('/auth/password/reset', { token, password }, { skipAuthRetry: true });
      setDone(true);
      // Every session was revoked server side, so the only next step is a
      // fresh sign-in.
      window.setTimeout(() => navigate('/login', { replace: true }), 2500);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not reset the password.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-full items-center justify-center bg-frontier px-4 py-10">
      <div className="w-full max-w-md">
        <h1 className="mb-6 text-center font-display text-3xl text-brass-300">EMPIRE FRONTIER</h1>
        <Panel title="Choose a new password">
          {done ? (
            <>
              <Alert tone="success" title="Password updated">
                Every other session has been signed out. Redirecting you to sign-in…
              </Alert>
              <Link to="/login" className="mt-4 block">
                <Button variant="gold" fullWidth>
                  Sign in now
                </Button>
              </Link>
            </>
          ) : (
            <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
              <Field
                label="New password"
                type="password"
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                hint="At least 10 characters, with upper case, lower case and a number."
                required
              />
              <Field
                label="Confirm password"
                type="password"
                autoComplete="new-password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                error={fieldError}
                required
              />
              {error && <Alert tone="error">{error}</Alert>}
              <Button type="submit" variant="gold" loading={busy} fullWidth>
                Update password
              </Button>
            </form>
          )}
        </Panel>
      </div>
    </div>
  );
}
