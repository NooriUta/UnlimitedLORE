// @vitest-environment jsdom
// SPRINT_UXR_S7B_ADMIN/S7B-31 п.4 (решение 4а) — «Последние отказы доступа»
// из старой вкладки v1 «Настройки» (AL-45, DS-LINK-2) переехали в «Журнал».
//
// Источник — GET /lore/kc/denials: кольцевой буфер памяти процесса до
// рестарта, не аудит. Это сказано на экране. Пустой буфер — «с рестарта
// отказов не было» (проверенный ноль); 403 — «нет прав»; сбой — словами.
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import gameIcons from '@iconify-json/game-icons/icons.json';
import { KitLangProvider, registerGameIcons } from '@seidr/kit';
import { KcDenials } from './KcDenials';
import { ActionsScreen } from './ActionsScreen';
import { DENIALS_SHOWN, parseDenials } from './denials';

beforeAll(() => { registerGameIcons(gameIcons); });
beforeEach(() => { window.history.replaceState(null, '', '/'); });

const D = (i: number) => ({ ts: `2026-11-11T10:${String(i % 60).padStart(2, '0')}:00Z`, method: 'POST', path: `lore/dict/entry/${i}`, status: 403, error: 'FORBIDDEN', role: 'viewer' });

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}
const fake = (body: unknown, status = 200) => vi.fn(async (url: string) => {
  if (url.startsWith('/lore/kc/denials')) return json(body, status);
  if (url.startsWith('/lore/admin/actions')) return json({ rows: [], total: 0, total_state: 'exact' });
  return json({ rows: [] });
}) as unknown as typeof fetch;

const mount = (f: typeof fetch) => render(<KitLangProvider lang="ru"><KcDenials fetchImpl={f} /></KitLangProvider>);

describe('S7B-31 · модель отказов', () => {
  it('разбор: строки по полям; без массива denials — сбой, а не «отказов нет»', () => {
    const d = parseDenials({ source: 'ring', denials: [D(1)] });
    expect(d.rows[0]).toMatchObject({ method: 'POST', status: 403, role: 'viewer' });
    expect(d.source).toBe('ring');
    expect(() => parseDenials({})).toThrow(/malformed/);
  });
});

describe('S7B-31 · блок «Отказы доступа»', () => {
  it('отказы таблицей; источник назван (буфер до рестарта)', async () => {
    mount(fake({ source: 'in-memory ring', denials: [D(1), D(2)] }));
    const table = await screen.findByTestId('adm-denials');
    expect(within(table).getAllByRole('row')).toHaveLength(3);
    expect(screen.getByTestId('adm-denials-src').textContent).toMatch(/рестарт/);
  });

  it('больше предела — «показано N из M»', async () => {
    mount(fake({ denials: Array.from({ length: DENIALS_SHOWN + 5 }, (_, i) => D(i)) }));
    const table = await screen.findByTestId('adm-denials');
    expect(within(table).getAllByRole('row')).toHaveLength(DENIALS_SHOWN + 1);
    expect(screen.getByTestId('adm-denials-more').textContent).toContain(String(DENIALS_SHOWN + 5));
  });

  it('пусто — «с рестарта отказов не было», а не сбой', async () => {
    mount(fake({ denials: [] }));
    expect((await screen.findByTestId('adm-denials-empty')).textContent).toMatch(/отказов не было/);
  });

  it('403 — «нет прав», не пустой список', async () => {
    mount(fake({ error: 'FORBIDDEN', detail: 'admin only' }, 403));
    expect(await screen.findByTestId('adm-denials-forbidden')).toBeTruthy();
    expect(screen.queryByTestId('adm-denials-empty')).toBeNull();
  });

  it('сбой — словами и «Повторить»', async () => {
    mount(fake({ error: 'DOWN' }, 502));
    expect(await screen.findByRole('button', { name: 'Повторить' })).toBeTruthy();
    expect(screen.queryByTestId('adm-denials-empty')).toBeNull();
  });

  it('в «Журнале» — отдельным блоком', async () => {
    render(<KitLangProvider lang="ru"><ActionsScreen fetchImpl={fake({ denials: [D(1)] })} /></KitLangProvider>);
    expect(await screen.findByTestId('adm-denials')).toBeTruthy();
  });
});
