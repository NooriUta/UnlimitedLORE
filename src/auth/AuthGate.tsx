// Gate the app behind login when AUTH_ENABLED. Off (default) → renders
// children immediately, unchanged from today. On → redirects to Keycloak if
// there's no valid session, and only renders children once one exists.
import { useEffect, useState, type ReactNode } from 'react';
import { AUTH_ENABLED, hasValidSession, initSession, login, subscribe } from './session';

// Одна попытка входа на загрузку страницы.
//
// `signinRedirect()` уводит со страницы не мгновенно, а экран тянет слайсы
// пачкой — и каждый ответ 401 дёргает `sessionExpired()`. Без защёлки это дало
// бы залп параллельных редиректов (гонка за state в хранилище) вместо одного
// перехода. Флаг живёт до перезагрузки — после возврата из Keycloak страница
// грузится заново, и он сбрасывается сам.
let loginStarted = false;

function goLogin(): void {
  if (loginStarted) return;
  // /auth/callback доигрывает обмен кода на токен — нельзя выбрасывать его в
  // новый signinRedirect, пока обмен в полёте.
  if (location.pathname === '/auth/callback') return;
  loginStarted = true;
  void login();
}

export default function AuthGate({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(!AUTH_ENABLED);
  const [authed, setAuthed] = useState(!AUTH_ENABLED || hasValidSession());

  useEffect(() => {
    if (!AUTH_ENABLED) return;
    // Сессия может отвалиться и ПОСЛЕ монтирования: истёк срок, молчаливое
    // продление не удалось, бэкенд ответил 401. Раньше подписка только гасила
    // экран (`setAuthed(false)`), а `login()` вызывался единственный раз — при
    // старте. В итоге протухшая сессия оставляла пустую страницу навсегда
    // (AL-69). Теперь любой переход в «сессии нет» ведёт на вход.
    const unsubscribe = subscribe(() => {
      const ok = hasValidSession();
      setAuthed(ok);
      if (!ok) goLogin();
    });
    initSession().then(() => {
      setReady(true);
      const ok = hasValidSession();
      setAuthed(ok);
      if (!ok) goLogin();
    });
    return unsubscribe;
  }, []);

  if (!ready) return null;
  if (!authed && location.pathname !== '/auth/callback') {
    // Не пустота: пока идёт переход в Keycloak, пользователь должен понимать,
    // что происходит. Немой белый экран — это ровно тот симптом, из-за которого
    // сессионную проблему принимали за поломку приложения.
    return (
      <div style={{
        minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
        color: 'var(--t2)', fontFamily: 'var(--mono)', fontSize: 13,
      }}>
        Сессия не активна — выполняется вход…
      </div>
    );
  }
  return <>{children}</>;
}
