// Шлюз входа kit (SPRINT_UXR_S3_V2_INFRA/S3-18). Приложение рендерится только
// при действующей сессии (или выключенном входе). Остальные исходы — честные
// состояния, а не пустой экран:
//   loading     — скелет;
//   signed_out  — сам уводит на вход (после осознанного выхода — только кнопка);
//   expired     — «Сессия истекла, войти снова»: если отвалилась посреди работы,
//                 экран остаётся под плашкой (несохранённое не пропадает);
//   error       — причина и «Войти снова».
import { useEffect, useSyncExternalStore, type ReactNode } from 'react';
import { kitT, useKitLang } from '../i18n';
import { LoadError, Skeleton } from '../states';
import { GameIcon } from '../elements/GameIcon';
import type { AuthSession } from './session';

export interface AuthGateProps {
  session: AuthSession;
  children: ReactNode;
}

export function AuthGate({ session, children }: AuthGateProps) {
  const lang = useKitLang();
  const st = useSyncExternalStore(session.subscribe, session.getState, session.getState);
  const autoLogin = st.status === 'signed_out' && !st.loggedOut;

  useEffect(() => {
    if (autoLogin) void session.login().catch(() => {});
  }, [autoLogin, session]);

  const loginBtn = (label: string, returnTo?: string) => (
    <button type="button" className="sk-btn" onClick={() => { void session.login(returnTo).catch(() => {}); }}>{label}</button>
  );

  if (st.status === 'disabled' || st.status === 'signed_in') return <>{children}</>;
  if (st.status === 'loading') return <Skeleton lines={4} label={kitT(lang, 'kit.auth.loading')} />;

  if (st.status === 'expired') {
    const bar = (
      <div className="sk-auth-expired" role="alert" data-auth="expired">
        <GameIcon slug="padlock" size={16} className="sk-auth-expired__icon" />
        <span className="sk-auth-expired__text">
          <b>{kitT(lang, 'kit.auth.expired.title')}</b> {kitT(lang, 'kit.auth.expired.hint')}
        </span>
        {loginBtn(kitT(lang, 'kit.auth.relogin'))}
      </div>
    );
    return st.interrupted ? <>{children}{bar}</> : <main className="sk-auth">{bar}</main>;
  }

  if (st.status === 'error') {
    return (
      <main className="sk-auth">
        <LoadError
          title={kitT(lang, 'kit.auth.error.title')}
          hint={kitT(lang, 'kit.auth.error.hint')}
          error={st.error}
          action={loginBtn(kitT(lang, 'kit.auth.relogin'), '/')}
        />
      </main>
    );
  }

  // signed_out
  return (
    <main className="sk-auth" data-auth="signed_out">
      <p className="sk-auth__note" role="status">
        {kitT(lang, st.loggedOut ? 'kit.auth.loggedOut' : 'kit.auth.redirecting')}
      </p>
      {loginBtn(kitT(lang, 'kit.auth.login'))}
    </main>
  );
}
