// Route target for redirect_uri (/auth/callback) — exchanges the auth code
// for tokens, then returns to wherever the user was headed before login().
import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { handleLoginCallback } from './session';

export default function AuthCallback() {
  const navigate = useNavigate();

  useEffect(() => {
    handleLoginCallback()
      .then(returnTo => navigate(returnTo && returnTo.startsWith('/') ? returnTo : '/', { replace: true }))
      .catch(err => {
        console.error('[auth] login callback failed', err);
        navigate('/', { replace: true });
      });
  }, [navigate]);

  return null;
}
