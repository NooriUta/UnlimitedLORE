// Gate the app behind login when AUTH_ENABLED. Off (default) → renders
// children immediately, unchanged from today. On → показывает экран входа,
// пока нет действительной сессии, и пускает дальше только когда она есть.
import { useEffect, useState, type ReactNode } from 'react';
import { AUTH_ENABLED, hasValidSession, initSession, subscribe } from './session';
import LoginScreen from './LoginScreen';

export default function AuthGate({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(!AUTH_ENABLED);
  const [authed, setAuthed] = useState(!AUTH_ENABLED || hasValidSession());

  useEffect(() => {
    if (!AUTH_ENABLED) return;
    // Сессия может отвалиться и ПОСЛЕ монтирования: истёк срок, молчаливое
    // продление не удалось, бэкенд ответил 401. Раньше подписка только гасила
    // экран (`setAuthed(false)`), и протухшая сессия оставляла пустую страницу
    // навсегда (AL-69). Теперь любой переход в «сессии нет» показывает вход.
    const unsubscribe = subscribe(() => setAuthed(hasValidSession()));
    initSession().then(() => {
      setReady(true);
      setAuthed(hasValidSession());
    });
    return unsubscribe;
  }, []);

  if (!ready) return null;
  // /auth/callback доигрывает обмен кода на токен: действительной сессии там
  // ещё нет по определению, и показать на нём экран входа значило бы
  // предложить начать вход заново поверх незавершённого — то есть зациклить
  // ровно того, кто всё сделал правильно.
  if (!authed && location.pathname !== '/auth/callback') return <LoginScreen />;
  return <>{children}</>;
}
