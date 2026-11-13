// @vitest-environment jsdom
// PU-21 (SPRINT_UXR_POLISH_UAT_1113/PU-21, владелица 13.11: «странице без логина возьми дизайн как у
// страницы KC и Völva»). Экран входа kit — та же композиция, что тема Keycloak lore/login: фоном
// иллюстрация Völva, над карточкой — блок бренда, карточка с акцентной кромкой. Слова бренда даёт
// приложение (K-14); тексты и кнопки состояний — прежние. Иллюстрация — тот же файл, что у KC
// (сторож ниже: копии не расходятся).
import { readFileSync } from 'node:fs';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { AuthGate } from './AuthGate';
import { VOLVA_ILLUSTRATION_SVG } from './volvaIllustration';
import type { AuthSession, AuthState } from './session';

function session(initial: Partial<AuthState>): AuthSession {
  const state: AuthState = { status: 'signed_out', user: null, interrupted: false, loggedOut: true, ...initial };
  return {
    enabled: true, getState: () => state, subscribe: () => () => {}, init: vi.fn(async () => {}),
    headers: () => ({}), wrapFetch: () => fetch, login: vi.fn(async () => {}), logout: vi.fn(async () => {}), expire: vi.fn(),
  } as unknown as AuthSession;
}
const brand = { mark: 'L', name: 'LORE', sub: 'Graph', slogan: 'Не документация — память.', platform: 'AIDA · PLATFORM · KNOWLEDGE' };

describe('PU-21 · экран входа как у KC и Völva', () => {
  for (const st of [{ status: 'signed_out', loggedOut: true }, { status: 'error', error: new Error('x') }, { status: 'expired', interrupted: false }] as Partial<AuthState>[]) {
    it(`${st.status}: иллюстрация фоном, блок бренда, карточка`, () => {
      const { container } = render(<AuthGate session={session(st)} brand={brand}><p>app</p></AuthGate>);
      expect(container.querySelector('.sk-auth__art svg')).toBeTruthy();
      expect(container.querySelector('.sk-auth__mark')?.textContent).toBe('L');
      expect(container.querySelector('.sk-auth__name')?.textContent).toBe('LORE');
      expect(screen.getByText('Не документация — память.')).toBeTruthy();
      expect(container.querySelector('.sk-auth__card')).toBeTruthy();
    });
  }
  it('тексты и кнопка состояния прежние', () => {
    render(<AuthGate session={session({ status: 'signed_out', loggedOut: true })} brand={brand}><p>app</p></AuthGate>);
    expect(screen.getByRole('button', { name: /Войти/ })).toBeTruthy();
  });
  it('без бренда — блока бренда нет, иллюстрация и карточка на месте', () => {
    const { container } = render(<AuthGate session={session({ status: 'signed_out', loggedOut: true })}><p>app</p></AuthGate>);
    expect(container.querySelector('.sk-auth__brand')).toBeNull();
    expect(container.querySelector('.sk-auth__card')).toBeTruthy();
  });
  it('иллюстрация — тот же рисунок, что у темы Keycloak (копии не расходятся)', () => {
    const ftl = readFileSync(`${process.cwd()}/../backend/keycloak/themes/lore/login/volva-illustration.ftl`, 'utf8');
    expect(VOLVA_ILLUSTRATION_SVG.trim()).toBe(ftl.trim());
  });
});
