// @vitest-environment jsdom
// SPRINT_UXR_POLISH_UAT_1113/PU-13 — вход в смену секрета агента без простоя (S7B-19, UC-6).
//
// Приёмка 13.11: в «Агентах» слова «секрет» на экране нет, в «Мастерах» смены
// секрета нет. Сам механизм (RotatePanel → RotateDanger, OldSecretSwitch:
// «перешёл?», отзыв прежнего) был, но открывался только кнопкой «Проекты» в
// строке агента — найти его было нельзя. Здесь проверяется ВХОД, а не механизм
// (механизм — secretRotation.test.tsx):
//   • у агента с клиентом KC в строке есть кнопка «Секрет», она открывает смену;
//   • у агента без клиента кнопки нет — ротировать нечего;
//   • в «Мастерах» есть «Сменить секрет агента»: выбор агента → та же панель.
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import gameIcons from '@iconify-json/game-icons/icons.json';
import { KitLangProvider, registerGameIcons } from '@seidr/kit';
import { AgentsScreen } from './AgentsScreen';
import { WizardsScreen } from './WizardsScreen';

beforeAll(() => { registerGameIcons(gameIcons); });
beforeEach(() => { window.history.replaceState(null, '', '/'); });

const ROWS = [
  { actor_id: 'A1', name: 'Claude Code (full)', client_id: 'lore-mcp-full', agent_role: 'full', machine_id: 'lorcetus', session_id: null, harness: null, owner_kc_sub: 'u1', owner_display_name: 'Владелица' },
  { actor_id: 'A3', name: 'Без клиента', client_id: null, agent_role: 'reader', machine_id: null, session_id: null, harness: null, owner_kc_sub: null, owner_display_name: null },
];

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

const fake = () => vi.fn(async (url: string) => {
  if (url.startsWith('/lore/slice/agent_owners')) return json({ rows: ROWS });
  if (url.startsWith('/lore/slice/dictionary')) return json({ rows: [] });
  return json({ rows: [] });
}) as unknown as typeof fetch;

const env = { backend: 'https://lore.example', issuer: 'https://kc.example/realms/x' };

describe('PU-13 · вход в смену секрета', () => {
  it('«Агенты»: у агента с клиентом — кнопка «Секрет», открывает смену секрета', async () => {
    render(<KitLangProvider lang="ru"><AgentsScreen fetchImpl={fake()} /></KitLangProvider>);
    const btn = await screen.findByTestId('adm-agent-secret-btn-A1');
    expect(btn.textContent).toMatch(/Секрет/);
    expect(screen.queryByTestId('adm-agent-secret-btn-A3')).toBeNull();
    fireEvent.click(btn);
    const card = await screen.findByTestId('adm-agent-secret-A1');
    expect(card.textContent).toMatch(/секрет/i);
    expect(await screen.findByTestId('adm-rotate-open')).toBeTruthy();
    expect(screen.getByTestId('adm-oldsecret-open')).toBeTruthy();
  });

  it('«Мастера»: «Сменить секрет агента» — выбор агента ведёт к той же смене', async () => {
    render(<KitLangProvider lang="ru"><WizardsScreen fetchImpl={fake()} meSub="u1" env={env} /></KitLangProvider>);
    fireEvent.click(await screen.findByTestId('adm-wiz-pick-secret'));
    const sel = await screen.findByTestId('adm-wiz-secret-agent');
    // агент без клиента KC в выборе не предлагается — ротировать нечего
    expect([...(sel as HTMLSelectElement).options].map(o => o.value)).toEqual(['', 'lore-mcp-full']);
    expect(screen.queryByTestId('adm-rotate-open')).toBeNull();
    fireEvent.change(sel, { target: { value: 'lore-mcp-full' } });
    expect(await screen.findByTestId('adm-rotate-open')).toBeTruthy();
  });
});
