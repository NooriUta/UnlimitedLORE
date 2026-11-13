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
