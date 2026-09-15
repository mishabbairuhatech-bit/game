import { useEffect } from 'react';
import { Navigate, Route, Routes, useNavigate } from 'react-router-dom';
import { Spinner } from '@empire/ui';
import { useAuthStore } from './store/auth.store';
import { AuthScreen } from './screens/AuthScreen';
import { GameScreen } from './screens/GameScreen';
import { VerifyEmailScreen } from './screens/VerifyEmailScreen';
import { ResetPasswordScreen } from './screens/ResetPasswordScreen';

function SplashScreen({ message }: { message: string }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 bg-frontier">
      <h1 className="font-display text-2xl tracking-widest text-brass-400">EMPIRE FRONTIER</h1>
      <div className="flex items-center gap-2 text-sm text-parchment-500">
        <Spinner className="h-4 w-4" />
        {message}
      </div>
    </div>
  );
}

/**
 * Completes the Google OAuth redirect.
 *
 * The API hands the access token back in the URL *fragment*, which browsers
 * never send to a server and which therefore never lands in an access log.
 * This screen reads it, moves it into memory, and immediately strips it from
 * the address bar so it does not sit in browser history.
 */
function OAuthCallbackScreen() {
  const adopt = useAuthStore((s) => s.adoptOAuthToken);
  const navigate = useNavigate();

  useEffect(() => {
    const params = new URLSearchParams(window.location.hash.replace(/^#/, ''));
    const token = params.get('access_token');
    window.history.replaceState(null, '', window.location.pathname);

    if (!token) {
      navigate('/login?error=oauth_failed', { replace: true });
      return;
    }
    void adopt(token).then((ok) => navigate(ok ? '/' : '/login?error=oauth_failed', { replace: true }));
  }, [adopt, navigate]);

  return <SplashScreen message="Completing Google sign-in…" />;
}

export function App() {
  const { user, initialising, bootstrap } = useAuthStore();

  useEffect(() => {
    void bootstrap();
  }, [bootstrap]);

  if (initialising) return <SplashScreen message="Restoring your session…" />;

  return (
    <Routes>
      {/* Reachable while signed out - these are the links sent by email. */}
      <Route path="/verify-email" element={<VerifyEmailScreen />} />
      <Route path="/reset-password" element={<ResetPasswordScreen />} />
      <Route path="/auth/callback" element={<OAuthCallbackScreen />} />

      {user ? (
        <>
          <Route path="/" element={<GameScreen />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </>
      ) : (
        <>
          <Route path="/login" element={<AuthScreen />} />
          <Route path="*" element={<Navigate to="/login" replace />} />
        </>
      )}
    </Routes>
  );
}
