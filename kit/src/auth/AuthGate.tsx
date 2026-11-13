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
import { VOLVA_ILLUSTRATION_SVG } from './volvaIllustration';

/**
 * Слова бренда на экране входа (PU-21): знак, имя, подпись, слоган, строка платформы. Их называет
 * приложение (K-14) — kit даёт только композицию страницы входа Keycloak/Völva.
 */
export interface AuthBrand { mark: string; name: string; sub?: string; slogan?: string; platform?: string }

export interface AuthGateProps {
  session: AuthSession;
  children: ReactNode;
  brand?: AuthBrand;
}

/**
 * Страница входа (SPRINT_UXR_POLISH_UAT_1113/PU-21, владелица 13.11: «странице без логина возьми
 * дизайн как у страницы KC и Völva»): та же композиция, что тема Keycloak lore/login — фоном
 * иллюстрация Völva, над карточкой блок бренда, карточка с акцентной кромкой. Токены kit.
 */
function AuthPage({ brand, state, children }: { brand?: AuthBrand; state: string; children: ReactNode }) {
  return (
    <main className="sk-auth" data-auth={state}>
      <div className="sk-auth__art" aria-hidden="true" dangerouslySetInnerHTML={{ __html: VOLVA_ILLUSTRATION_SVG }} />
      {brand && (
        <div className="sk-auth__brand">
          <div className="sk-auth__mark" aria-hidden="true">{brand.mark}</div>
          <div className="sk-auth__word">
            <span className="sk-auth__dot" aria-hidden="true" />
            <span className="sk-auth__name">{brand.name}</span>
            {brand.sub && <span className="sk-auth__sub">{brand.sub}</span>}
          </div>
          {brand.slogan && <div className="sk-auth__slogan">{brand.slogan}</div>}
          {brand.platform && <div className="sk-auth__platform">{brand.platform}</div>}
        </div>
      )}
      <div className="sk-auth__card">{children}</div>
    </main>
  );
}

export function AuthGate({ session, children, brand }: AuthGateProps) {
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
    return st.interrupted ? <>{children}{bar}</> : <AuthPage brand={brand} state="expired">{bar}</AuthPage>;
  }

  if (st.status === 'error') {
    return (
      <AuthPage brand={brand} state="error">
        <LoadError
          title={kitT(lang, 'kit.auth.error.title')}
          hint={kitT(lang, 'kit.auth.error.hint')}
          error={st.error}
          action={loginBtn(kitT(lang, 'kit.auth.relogin'), '/')}
        />
      </AuthPage>
    );
  }

  // signed_out
  return (
    <AuthPage brand={brand} state="signed_out">
      <p className="sk-auth__note" role="status">
        {kitT(lang, st.loggedOut ? 'kit.auth.loggedOut' : 'kit.auth.redirecting')}
      </p>
      {loginBtn(kitT(lang, 'kit.auth.login'))}
    </AuthPage>
  );
}
