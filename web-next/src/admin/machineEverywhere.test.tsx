// @vitest-environment jsdom
// D-2026-LORE-AGENT-MACHINE-EVERYWHERE — машина у всего, что связано с агентом; где
// неприменимо — явно «не применимо». Сервер отдаёт отметку: имя машины | "(unknown)" |
// "(n/a)". Экран переводит отметки словами и не путает «неизвестно» с «не применимо».
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import gameIcons from '@iconify-json/game-icons/icons.json';
import { KitLangProvider, registerGameIcons } from '@seidr/kit';
import { parseDenials } from './denials';
import { KcDenials } from './KcDenials';
import { WhoamiBar } from './WhoamiBar';
import { machineMark } from './machineMark';

beforeAll(() => { registerGameIcons(gameIcons); });

const json = (b: unknown) => new Response(JSON.stringify(b), { status: 200, headers: { 'Content-Type': 'application/json' } });

describe('машина вызова — отметка словами', () => {
  it('имя | неизвестно | не применимо | старый сервер без поля', () => {
    expect(machineMark('lorcetus')).toEqual({ kind: 'name', text: 'lorcetus' });
    expect(machineMark('(unknown)').kind).toBe('unknown');
    expect(machineMark('(n/a)').kind).toBe('na');
    expect(machineMark(undefined).kind).toBe('absent');
  });

  it('отказы: машина разобрана и видна колонкой', async () => {
    const body = { denials: [
      { ts: '2026-11-14T00:00:00Z', method: 'POST', path: '/lore/x', status: 403, error: 'E', role: 'admin', machine: 'lorcetus' },
      { ts: '2026-11-14T00:00:01Z', method: 'POST', path: '/lore/y', status: 403, error: 'E', role: 'admin', machine: '(n/a)' },
    ], total: 2 };
    expect(parseDenials(body).rows[0].machine).toBe('lorcetus');
    render(<KitLangProvider lang="ru"><KcDenials fetchImpl={vi.fn(async () => json(body)) as unknown as typeof fetch} /></KitLangProvider>);
    expect((await screen.findAllByTestId('adm-denial-machine'))[0].textContent).toBe('lorcetus');
    expect(screen.getAllByTestId('adm-denial-machine')[1].textContent).toMatch(/не применимо/i);
  });

  it('«Вы: …» у агента — с машиной вызова', async () => {
    render(<KitLangProvider lang="ru"><WhoamiBar fetchImpl={vi.fn(async () => json({
      auth_enabled: true, kind: 'agent', profile: 'full', client_id: 'lore-mcp-full', seer_role: 'viewer',
      machine: 'lorcetus', identity: { state: 'known', name: 'Claude Code (full)' } })) as unknown as typeof fetch} /></KitLangProvider>);
    expect((await screen.findByTestId('adm-whoami')).textContent).toContain('lorcetus');
  });
});

// D-2026-LORE-AGENT-MACHINE-EVERYWHERE п.4 (V86): журнал действий несёт клиента и машину.
import { parseActions } from './actions';
import { parseFailureRows } from './mcp';
import { ActionsScreen } from './ActionsScreen';
import { McpScreen } from './McpScreen';

const ACT = { rows: [
  { ts: '2026-11-14T00:00:00Z', family: 'task', entity_id: 'S/T1', caller: 'full', axis: 'agent', status: 200, client: 'lore-mcp-full', machine: 'lorcetus' },
  { ts: '2026-11-14T00:00:01Z', family: 'dict', entity_id: 'D/x', caller: 'alexa', axis: 'human', status: 200, client: '(n/a)', machine: '(n/a)' },
  { ts: '2026-11-13T00:00:01Z', family: 'task', entity_id: 'S/T0', caller: 'full', axis: 'agent', status: 200, client: '(unknown)', machine: '(unknown)' },
], shown: 3, total: 3, total_state: 'exact', truncated: false, limit: 200, filters: {} };

describe('журнал действий: клиент и машина (V86)', () => {
  it('разбор строки журнала и строки отказа MCP', () => {
    const r = parseActions(ACT).rows;
    expect(r[0].client).toBe('lore-mcp-full');
    expect(r[0].machine).toBe('lorcetus');
    expect(r[2].machine).toBe('(unknown)');
    expect(parseActions({ rows: [{ ts: 1 }] }).rows[0].machine).toBeNull();
    const f = parseFailureRows([{ ts: 1, caller: 'full', status: 403, client: 'lore-mcp-full', machine: 'lorcetus' }]);
    expect(f[0].machine).toBe('lorcetus');
    expect(f[0].client).toBe('lore-mcp-full');
  });

  it('экран «Журнал»: колонки клиента и машины, отметки словами', async () => {
    const f = vi.fn(async (url: string) => url.includes('/lore/admin/actions') ? json(ACT) : json({ rows: [] }));
    render(<KitLangProvider lang="ru"><ActionsScreen fetchImpl={f as unknown as typeof fetch} /></KitLangProvider>);
    const m = await screen.findAllByTestId('adm-log-machine');
    expect(m[0].textContent).toBe('lorcetus');
    expect(m[1].textContent).toMatch(/не применимо/i);
    expect(m[2].textContent).toMatch(/неизвестно/i);
    expect(screen.getAllByTestId('adm-log-client')[0].textContent).toBe('lore-mcp-full');
  });

  it('экран MCP: у отказа видна машина', async () => {
    const f = vi.fn(async (url: string) => url.startsWith('/lore/slice/mcp_failure_rows')
      ? json({ rows: [{ ts: Date.UTC(2026, 10, 14), caller: 'full', family: 'task', entity_id: 'S/T1', status: 403, client: 'lore-mcp-full', machine: 'lorcetus' }] })
      : json({ rows: [] }));
    render(<KitLangProvider lang="ru"><McpScreen fetchImpl={f as unknown as typeof fetch} now={Date.UTC(2026, 10, 14, 1)} /></KitLangProvider>);
    expect((await screen.findAllByTestId('adm-mcp-fail-machine'))[0].textContent).toBe('lorcetus');
  });
});
