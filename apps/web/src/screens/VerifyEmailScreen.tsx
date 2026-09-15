import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Alert, Button, Panel, Spinner } from '@empire/ui';
import type { AuthUser } from '@empire/shared';
import { api, ApiError } from '../lib/api';

type State = { kind: 'working' } | { kind: 'done'; user: AuthUser } | { kind: 'failed'; message: string };

export function VerifyEmailScreen() {
  const [params] = useSearchParams();
  const token = params.get('token');
  const [state, setState] = useState<State>({ kind: 'working' });

  useEffect(() => {
    if (!token) {
      setState({ kind: 'failed', message: 'This link is missing its verification token.' });
      return;
    }

    let cancelled = false;
    (async () => {
      try {
        const user = await api.post<AuthUser>('/auth/verify', { token }, { skipAuthRetry: true });
        if (!cancelled) setState({ kind: 'done', user });
      } catch (error) {
        if (cancelled) return;
        setState({
          kind: 'failed',
          message:
            error instanceof ApiError
              ? error.message
              : 'Could not verify this address. Request a new link.',
        });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [token]);

  return (
    <div className="flex min-h-full items-center justify-center bg-frontier px-4 py-10">
      <div className="w-full max-w-md">
        <h1 className="mb-6 text-center font-display text-3xl text-brass-300">EMPIRE FRONTIER</h1>
        <Panel title="Email verification">
          {state.kind === 'working' && (
            <div className="flex items-center gap-2 text-sm text-parchment-400">
              <Spinner className="h-4 w-4" />
              Verifying your address…
            </div>
          )}

          {state.kind === 'done' && (
            <>
              <Alert tone="success" title="Address confirmed">
                Welcome, {state.user.username}. Your account is active.
              </Alert>
              <Link to="/login" className="mt-4 block">
                <Button variant="gold" fullWidth>
                  Continue to sign-in
                </Button>
              </Link>
            </>
          )}

          {state.kind === 'failed' && (
            <>
              <Alert tone="error">{state.message}</Alert>
              <Link to="/login" className="mt-4 block">
                <Button variant="secondary" fullWidth>
                  Back to sign-in
                </Button>
              </Link>
            </>
          )}
        </Panel>
      </div>
    </div>
  );
}
