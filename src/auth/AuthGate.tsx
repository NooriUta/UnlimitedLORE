// Gate the app behind login when AUTH_ENABLED. Off (default) → renders
// children immediately, unchanged from today. On → redirects to Keycloak if
// there's no valid session, and only renders children once one exists.
import { useEffect, useState, type ReactNode } from 'react';
import { AUTH_ENABLED, getCurrentUser, initSession, login, subscribe } from './session';

export default function AuthGate({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(!AUTH_ENABLED);
  const [authed, setAuthed] = useState(!AUTH_ENABLED || getCurrentUser() != null);

  useEffect(() => {
    if (!AUTH_ENABLED) return;
    const unsubscribe = subscribe(() => setAuthed(getCurrentUser() != null));
    initSession().then(() => {
      setReady(true);
      const user = getCurrentUser();
      setAuthed(user != null);
      // /auth/callback handles its own redirect flow — never bounce it back
      // into another signinRedirect while the code exchange is in flight.
      if (!user && location.pathname !== '/auth/callback') login();
    });
    return unsubscribe;
  }, []);

  if (!ready) return null;
  if (!authed && location.pathname !== '/auth/callback') return null;
  return <>{children}</>;
}
