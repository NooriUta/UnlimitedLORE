// @vitest-environment jsdom
// SPRINT_UXR_S3_V2_INFRA/S3-18 — шлюз входа kit: экран приложения только при
// действующей сессии; «сессия истекла» — честная плашка с «Войти снова»,
// а не пустой экран; нет сессии — уводит на вход.
import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { AuthGate } from './AuthGate';
import type { AuthSession, AuthState } from './session';

function fakeSession(initial: Partial<AuthState>) {
  let state: AuthState = { status: 'signed_in', user: null, interrupted: false, loggedOut: false, ...initial };
  const subs = new Set<() => void>();
  const s = {
    enabled: true,
    getState: () => state,
    subscribe: (fn: () => void) => { subs.add(fn); return () => { subs.delete(fn); }; },
    init: vi.fn(async () => {}),
    headers: () => ({}),
    wrapFetch: () => fetch,
    login: vi.fn(async () => {}),
    logout: vi.fn(async () => {}),
    expire: vi.fn(),
    put(next: Partial<AuthState>) { state = { ...state, ...next }; subs.forEach(f => f()); },
  };
  return s as typeof s & AuthSession;
}

describe('S3-18 · AuthGate', () => {
  it('вошли — показывает приложение', () => {
    render(<AuthGate session={fakeSession({})}><p>app</p></AuthGate>);
    expect(screen.getByText('app')).toBeTruthy();
  });

  it('вход выключен — приложение как раньше', () => {
    render(<AuthGate session={fakeSession({ status: 'disabled' })}><p>app</p></AuthGate>);
    expect(screen.getByText('app')).toBeTruthy();
  });

  it('загрузка — скелет, не приложение', () => {
    const { container } = render(<AuthGate session={fakeSession({ status: 'loading' })}><p>app</p></AuthGate>);
    expect(screen.queryByText('app')).toBeNull();
    expect(container.querySelector('[data-state="loading"]')).toBeTruthy();
  });

  it('нет сессии — сам уводит на вход', () => {
    const s = fakeSession({ status: 'signed_out' });
    render(<AuthGate session={s}><p>app</p></AuthGate>);
    expect(screen.queryByText('app')).toBeNull();
    expect(s.login).toHaveBeenCalledTimes(1);
  });

  it('вышли сами — на вход не уводит, кнопка «Войти»', () => {
    const s = fakeSession({ status: 'signed_out', loggedOut: true });
    render(<AuthGate session={s}><p>app</p></AuthGate>);
    expect(s.login).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Войти' }));
    expect(s.login).toHaveBeenCalledTimes(1);
  });

  it('401 посреди работы — приложение остаётся, поверх плашка «Сессия истекла» с «Войти снова»', () => {
    const s = fakeSession({});
    render(<AuthGate session={s}><p>app</p></AuthGate>);
    act(() => s.put({ status: 'expired', interrupted: true }));
    expect(screen.getByText('app')).toBeTruthy();
    const alert = screen.getByRole('alert');
    expect(alert.getAttribute('data-auth')).toBe('expired');
    expect(alert.textContent).toContain('Сессия истекла');
    fireEvent.click(screen.getByRole('button', { name: 'Войти снова' }));
    expect(s.login).toHaveBeenCalledTimes(1);
  });

  it('истекла ещё до входа на страницу — вместо приложения экран «Сессия истекла»', () => {
    const s = fakeSession({ status: 'expired', interrupted: false });
    render(<AuthGate session={s}><p>app</p></AuthGate>);
    expect(screen.queryByText('app')).toBeNull();
    expect(screen.getByRole('alert').textContent).toContain('Сессия истекла');
  });

  it('вход сорвался — ошибка с причиной и «Войти снова» (новый вход, а не повтор протухшего code)', () => {
    const s = fakeSession({ status: 'error', error: new Error('invalid_grant') });
    render(<AuthGate session={s}><p>app</p></AuthGate>);
    expect(screen.getByRole('alert').textContent).toContain('invalid_grant');
    fireEvent.click(screen.getByRole('button', { name: 'Войти снова' }));
    expect(s.login).toHaveBeenCalledWith('/');
  });
});
