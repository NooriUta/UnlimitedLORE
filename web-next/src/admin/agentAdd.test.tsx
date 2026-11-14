// @vitest-environment jsdom
// SPRINT_LORE_AGENT_OBSERVABILITY/AO-AGENT-ADD — новый агент «одной кнопкой».
//
// Ядро уже есть (S7A-12 A): POST /lore/kc/agent-client заводит клиент по шаблону профиля.
// Здесь — то, чего не хватало:
//   • после создания сервер сам берёт токен учётки и сверяет agent_scope с профилем
//     (token_check) — «завёлся» показан фактом: ok / другой профиль / клейма нет / не проверено;
//   • в «Агентах» есть вход «Новый агент» — ведёт в мастер «Дать человеку агента».
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import gameIcons from '@iconify-json/game-icons/icons.json';
import { KitLangProvider, registerGameIcons } from '@seidr/kit';
import { parseIssued } from './wizards';
import { TokenCheckNote } from './TokenCheckNote';
import { AgentsScreen } from './AgentsScreen';
import { AdminNavProvider } from './adminNav';
import { WizardsScreen } from './WizardsScreen';

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

// SPRINT_LORE_ADMIN_POLISH/AP-03 (прогон админки 14.11): владелец test-user-1 с ролью pm в
// AIDA/GLADSHEIM, мастер выдал lore-mcp-full_TestU1 и писал «вопросов о ролях нет», хотя pm
// не делегирует full — агент вышел только читающим. Теперь до «Выдать» мастер называет, где
// агент будет только читать, по ответу СЕРВЕРА (GET /lore/admin/access/agents?kc_sub=&agent_scope=
// → delegation[{project, role, delegates, profiles}]), а не по копии матрицы в UI. Не запрещает.
describe('AP-03 · мастер «Дать человеку агента» предупреждает о неделегируемом профиле', () => {
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  const MATRIX = { rows: [{ kc_sub: 'u-pm', display_name: 'test-user-1', state: 'checked', cells: [] }], sources_asked: ['graph'] };
  const CLIENTS = [{ clientId: 'lore-mcp-full', id: 'c1' }, { clientId: 'lore-mcp-pm', id: 'c2' }];
  const DELEG = [
    { project: 'AIDA/GLADSHEIM', role: 'pm', profiles: ['analyst', 'pm', 'product-analyst', 'tester'] },
    { project: 'AIDA/miniLORE', role: 'owner', profiles: ['analyst', 'architect', 'developer', 'full', 'marketer', 'pm', 'product-analyst', 'tester'] },
  ];
  function fake(o: { delegStatus?: number } = {}) {
    const seen: string[] = [];
    const f = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      seen.push(url);
      if (url.startsWith('/lore/slice/role_matrix')) return json(MATRIX);
      if (url.startsWith('/lore/kc/agents')) return json(CLIENTS);
      if (url.startsWith('/lore/slice/agent_owners')) return json({ rows: [] });
      if (url.startsWith('/lore/slice/dictionary')) return json({ rows: [] });
      if (url.startsWith('/lore/admin/access/agents')) {
        if (o.delegStatus) return json({ error: 'DOWN' }, o.delegStatus);
        const scope = new URL(url, 'http://x').searchParams.get('agent_scope');
        return json({ kc_sub: 'u-pm', agents: [], count: 0, visible_projects: 2, agent_scope: scope,
          delegation: DELEG.map(d => ({ ...d, delegates: scope !== null && d.profiles.includes(scope) })) });
      }
      return json({ rows: [] });
    }) as unknown as typeof fetch;
    return { f, seen };
  }
  const toProfile = async (f: typeof fetch) => {
    window.history.replaceState(null, '', '/?adm-wiz=agent');
    render(<KitLangProvider lang="ru"><WizardsScreen fetchImpl={f} meSub="u-me"
      env={{ backend: 'https://lore.example/_backend', issuer: 'https://kc.example/realms/omilore' }} /></KitLangProvider>);
    fireEvent.change(await screen.findByTestId('adm-wiz-owner'), { target: { value: 'u-pm' } });
    fireEvent.click(screen.getByTestId('kit-steps-next'));
    await screen.findByTestId('adm-wiz-profiles');
  };

  it('full у владельца-pm — до выдачи сказано: в AIDA/GLADSHEIM агент будет только читать, роль pm не делегирует full', async () => {
    const { f, seen } = fake();
    await toProfile(f);
    fireEvent.click(screen.getByTestId('adm-wiz-profile-full'));
    await waitFor(() => expect(screen.getByTestId('adm-wiz-delegation').getAttribute('data-state')).toBe('partial'));
    const note = screen.getByTestId('adm-wiz-delegation');
    expect(note.textContent).toContain('AIDA/GLADSHEIM');
    expect(note.textContent).toMatch(/только читать/);
    expect(note.textContent).toMatch(/pm.*full/);
    expect(note.textContent).not.toContain('AIDA/miniLORE');
    // Ответ — от сервера, с профилем и владельцем в запросе.
    expect(seen.some(u => u.startsWith('/lore/admin/access/agents') && u.includes('kc_sub=u-pm') && u.includes('agent_scope=full'))).toBe(true);
    // Счётчик у профиля: пишет в 1 из 2 проектов владельца.
    expect(screen.getByTestId('adm-wiz-profile-count-full').textContent).toMatch(/1.*2/);
    expect(screen.getByTestId('adm-wiz-profile-count-pm').textContent).toMatch(/2.*2/);
  });

  it('pm у владельца-pm/owner — пишет везде, предупреждения нет', async () => {
    await toProfile(fake().f);
    fireEvent.click(screen.getByTestId('adm-wiz-profile-pm'));
    await waitFor(() => expect(screen.getByTestId('adm-wiz-delegation').getAttribute('data-state')).toBe('all'));
  });

  it('сервер не ответил — «не смогли проверить», а не «вопросов о ролях нет»', async () => {
    await toProfile(fake({ delegStatus: 502 }).f);
    fireEvent.click(screen.getByTestId('adm-wiz-profile-full'));
    await waitFor(() => expect(screen.getByTestId('adm-wiz-delegation').getAttribute('data-state')).toBe('error'));
    expect(screen.getByTestId('adm-wiz-delegation').textContent).toMatch(/не смогли/i);
  });

  it('предупреждение повторено на шаге выдачи — рядом с кнопкой «Выдать»', async () => {
    await toProfile(fake().f);
    fireEvent.click(screen.getByTestId('adm-wiz-profile-full'));
    fireEvent.change(screen.getByTestId('adm-wiz-machine'), { target: { value: 'nb' } });
    fireEvent.click(screen.getByTestId('kit-steps-next'));
    await screen.findByTestId('adm-wiz-issue');
    await waitFor(() => expect(screen.getByTestId('adm-wiz-delegation-issue').getAttribute('data-state')).toBe('partial'));
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
