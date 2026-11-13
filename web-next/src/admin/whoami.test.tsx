// @vitest-environment jsdom
// SPRINT_LORE_AGENT_OBSERVABILITY/AO-WHOAMI — строка «Вы: …» в админке по GET /lore/whoami.
//
// Различаем то, что легко выдать друг за друга:
//   • опознан — имя, роль первой оси, человек/агент;
//   • не опознан (identity.state=unknown) — «LORE вас не знает», а не «нет прав»;
//   • граф не прочитан (state=error) или запрос упал — «не смогли проверить»;
//   • auth выключен — роль из заголовка, сказано, что она не проверена.
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import gameIcons from '@iconify-json/game-icons/icons.json';
import { KitLangProvider, registerGameIcons } from '@seidr/kit';
import { WhoamiBar } from './WhoamiBar';

beforeAll(() => { registerGameIcons(gameIcons); });

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}
const fake = (body: unknown, status = 200) =>
  vi.fn(async () => json(body, status)) as unknown as typeof fetch;
const mount = (f: typeof fetch) => render(<KitLangProvider lang="ru"><WhoamiBar fetchImpl={f} /></KitLangProvider>);

describe('AO-WHOAMI · «Вы: …»', () => {
  it('человек опознан — имя и роль', async () => {
    mount(fake({ auth_enabled: true, kind: 'human', seer_role: 'admin',
      identity: { state: 'known', display_name: 'omiloreadmin' } }));
    const bar = await screen.findByTestId('adm-whoami');
    expect(bar.getAttribute('data-state')).toBe('known');
    expect(bar.textContent).toContain('omiloreadmin');
    expect(bar.textContent).toContain('admin');
  });

  it('агент — профиль и клиент', async () => {
    mount(fake({ auth_enabled: true, kind: 'agent', profile: 'full', client_id: 'lore-mcp-full', seer_role: 'viewer',
      identity: { state: 'known', name: 'Claude Code (full)' } }));
    const bar = await screen.findByTestId('adm-whoami');
    expect(bar.textContent).toContain('Claude Code (full)');
    expect(bar.textContent).toContain('full');
  });

  it('не опознан — «LORE вас не знает», а не «нет прав»', async () => {
    mount(fake({ auth_enabled: true, kind: 'human', seer_role: 'viewer', sub: 's-1',
      identity: { state: 'unknown', reason: 'человека с kc_sub s-1 нет в графе' } }));
    const bar = await screen.findByTestId('adm-whoami');
    expect(bar.getAttribute('data-state')).toBe('unknown');
    expect(bar.textContent).toMatch(/не опознан/i);
    expect(bar.textContent).not.toMatch(/нет прав/i);
  });

  it('граф не прочитан / запрос упал — «не смогли проверить»', async () => {
    mount(fake({ error: 'BAD_GATEWAY', detail: 'down' }, 502));
    const bar = await screen.findByTestId('adm-whoami');
    expect(bar.getAttribute('data-state')).toBe('error');
    expect(bar.textContent).toMatch(/не смогли проверить/i);
  });

  it('auth выключен — роль не проверена, так и сказано', async () => {
    mount(fake({ auth_enabled: false, kind: 'unverified', seer_role: 'admin' }));
    const bar = await screen.findByTestId('adm-whoami');
    expect(bar.getAttribute('data-state')).toBe('unverified');
    expect(bar.textContent).toMatch(/не проверена/i);
  });
});
