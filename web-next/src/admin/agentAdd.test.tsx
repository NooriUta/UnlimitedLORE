// @vitest-environment jsdom
// SPRINT_LORE_AGENT_OBSERVABILITY/AO-AGENT-ADD — новый агент «одной кнопкой».
//
// Ядро уже есть (S7A-12 A): POST /lore/kc/agent-client заводит клиент по шаблону профиля.
// Здесь — то, чего не хватало:
//   • после создания сервер сам берёт токен учётки и сверяет agent_scope с профилем
//     (token_check) — «завёлся» показан фактом: ok / другой профиль / клейма нет / не проверено;
//   • в «Агентах» есть вход «Новый агент» — ведёт в мастер «Дать человеку агента».
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import gameIcons from '@iconify-json/game-icons/icons.json';
import { KitLangProvider, registerGameIcons } from '@seidr/kit';
import { parseIssued } from './wizards';
import { TokenCheckNote } from './TokenCheckNote';
import { AgentsScreen } from './AgentsScreen';
import { AdminNavProvider } from './adminNav';

beforeAll(() => { registerGameIcons(gameIcons); });
beforeEach(() => { window.history.replaceState(null, '', '/'); });

describe('AO-AGENT-ADD · проверка токена новой учётки', () => {
  it('разбор: token_check приходит — state и профиль; нет поля — «не проверено»', () => {
    expect(parseIssued({ clientId: 'c', token_check: { state: 'ok', agent_scope: 'pm', expected: 'pm' } }).tokenCheck)
      .toEqual({ state: 'ok', agentScope: 'pm', expected: 'pm', reason: null });
    expect(parseIssued({ clientId: 'c' }).tokenCheck).toEqual({ state: 'unchecked', agentScope: null, expected: null, reason: null });
  });

  it.each([
    ['ok', /agent_scope = pm/, undefined],
    ['mismatch', /full.*вместо.*pm/, 'dng'],
    ['missing', /нет agent_scope/i, 'dng'],
    ['no_seer_roles', /нет seer_roles/i, 'dng'],
    ['error', /не проверено/i, 'wrn'],
  ])('%s — сказано словами, тон по исходу', (state, re, tone) => {
    render(<KitLangProvider lang="ru"><TokenCheckNote check={{
      state: state as 'ok', agentScope: state === 'mismatch' ? 'full' : state === 'ok' ? 'pm' : null,
      expected: 'pm', reason: state === 'error' ? 'KC 401' : null }} /></KitLangProvider>);
    const n = screen.getByTestId('adm-token-check');
    expect(n.textContent).toMatch(re);
    expect(n.getAttribute('data-tone') ?? undefined).toBe(tone);
  });
});

describe('AO-AGENT-ADD · вход «Новый агент» в «Агентах»', () => {
  it('кнопка ведёт в мастер agent', async () => {
    const go = vi.fn();
    const f = vi.fn(async () => new Response(JSON.stringify({ rows: [] }),
      { status: 200, headers: { 'Content-Type': 'application/json' } })) as unknown as typeof fetch;
    render(<KitLangProvider lang="ru"><AdminNavProvider value={{ go }}><AgentsScreen fetchImpl={f} /></AdminNavProvider></KitLangProvider>);
    fireEvent.click(await screen.findByTestId('adm-agents-new'));
    expect(go).toHaveBeenCalledWith('wiz', { 'adm-wiz': 'agent' });
  });
});
