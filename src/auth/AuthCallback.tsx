// Route target for redirect_uri (/auth/callback) — exchanges the auth code
// for tokens, then returns to wherever the user was headed before login().
import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { handleLoginCallback } from './session';

export default function AuthCallback() {
  const navigate = useNavigate();
  // Keycloak's authorization code is single-use — a second exchange attempt
  // fails with "invalid_grant: Code not valid" (400), which then cascades
  // into every API call coming back 401 since currentUser never gets set.
  // Without this guard the effect can fire twice for the same code: React
  // StrictMode double-invokes effects in dev, and in prod a slow network
  // plus an impatient reload/back-navigation re-mounts this component while
  // the code is still sitting in the URL and the first exchange hasn't
  // resolved yet (navigate(..., {replace:true}) only clears it afterwards).
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    handleLoginCallback()
      .then(returnTo => navigate(returnTo && returnTo.startsWith('/') ? returnTo : '/', { replace: true }))
      .catch(err => {
        console.error('[auth] login callback failed', err);
        navigate('/', { replace: true });
      });
  }, [navigate]);

  return null;
}
