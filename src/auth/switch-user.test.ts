import { describe, expect, it } from 'vitest';
import { FORCE_LOGIN_KEY, takeLoginPrompt } from './session';

// SPRINT_LORE_PROJECT_SCOPE/AL-SWITCH-USER. Владелица 06.11: «если выходим, я не
// могу зайти под другим пользователем … я зависла, не могу теперь под собой
// зайти — сделай кнопку не просто выйти, а перезайти под другим пользователем».
//
// Причина: вход шёл без prompt=login, и Keycloak при живой SSO-сессии молча
// впускал ТОГО ЖЕ человека; а «Выйти» при неудаче выхода в Keycloak гасил сессию
// только у себя. Теперь осознанный выход и «войти под другим» оставляют отметку,
// и следующий вход обязан спросить логин.

function memStorage(): Storage {
  const m = new Map<string, string>();
  return {
    get length() { return m.size; },
    clear: () => m.clear(),
    getItem: k => (m.has(k) ? m.get(k)! : null),
    key: i => [...m.keys()][i] ?? null,
    removeItem: k => { m.delete(k); },
    setItem: (k, v) => { m.set(k, String(v)); },
  };
}

describe('takeLoginPrompt', () => {
  it('после осознанного выхода вход спрашивает логин (prompt=login)', () => {
    const s = memStorage();
    s.setItem(FORCE_LOGIN_KEY, '1');
    expect(takeLoginPrompt(s)).toBe('login');
  });

  it('отметка одноразовая: следующий обычный вход — без принудительного логина', () => {
    const s = memStorage();
    s.setItem(FORCE_LOGIN_KEY, '1');
    takeLoginPrompt(s);
    expect(takeLoginPrompt(s)).toBeUndefined();
    expect(s.getItem(FORCE_LOGIN_KEY)).toBeNull();
  });

  it('без отметки — обычный вход, SSO-сессия работает как раньше', () => {
    expect(takeLoginPrompt(memStorage())).toBeUndefined();
  });
});
