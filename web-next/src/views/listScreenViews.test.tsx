// @vitest-environment jsdom
// Сохранённые виды в разделах v2 (владелица 19–20.11.2026: «доделать функции, чтобы все поля работали»).
// До этого хранилище видов на сервере (KnowSavedView, LoreMeResource) и HTTP-клиент были, а панели видов в
// разделах не было вовсе — сохранить, открыть и поделиться видом было негде. Здесь: панель видов в разделах
// sprints / adrs / specs, вид применяется к списку, ссылка «Поделиться» ведёт на сохранённый вид.
import { beforeAll, describe, expect, it } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import gameIcons from '@iconify-json/game-icons/icons.json';
import { registerGameIcons } from '@seidr/kit';
import type { UrlWindow } from '@seidr/kit';
import { ListScreen } from '../pages/ListScreen';

beforeAll(() => { registerGameIcons(gameIcons); });

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const adrs = [
  { adr_id: 'ADR-1', name: 'Альфа', status: 'accepted', date_created: '2026-01-01' },
  { adr_id: 'ADR-2', name: 'Бета', status: 'proposed', date_created: '2026-06-01' },
];
const view = (over: Record<string, unknown>) => ({
  view_uid: 'v-1', name: 'Предложенные', section: 'adrs', query: 'lq=proposed', visibility: 'all', roles: [],
  is_team_default: false, is_personal_default: false, own: false, version: 1, updated_at: '2026-11-20T00:00:00Z', ...over,
});

function win(search: string) {
  const loc = { pathname: '/', search, hash: '' };
  const set = (_: unknown, __: string, u: string) => { const n = new URL(u, 'https://lore.test'); loc.pathname = n.pathname; loc.search = n.search; };
  return { location: loc, history: { pushState: set, replaceState: set } } as unknown as UrlWindow & { location: typeof loc };
}

function fetchWith(views: unknown[], role = 'viewer') {
  const calls: string[] = [];
  const impl = (async (url: string, init?: RequestInit) => {
    calls.push(`${init?.method ?? 'GET'} ${url}`);
    if (url.startsWith('/lore/me/views')) return json({ ok: true, views, count: views.length, defaults: {} });
    if (url.startsWith('/lore/whoami')) return json({ seer_role: role });
    return json({ rows: adrs });
  }) as unknown as typeof fetch;
  return { impl, calls };
}

const rowIds = (c: HTMLElement) => [...c.querySelectorAll('[data-record-id]')].map(r => r.getAttribute('data-record-id'));

describe('сохранённые виды в разделе', () => {
  it('раздел ADR: панель видов с серверными видами; выбор вида применяет его к списку', async () => {
    const f = fetchWith([view({})]);
    const w = win('?mod=forseti&sec=adrs');
    const { container } = render(<ListScreen screen="adrs" fetchImpl={f.impl} urlState={w} />);
    await waitFor(() => expect(rowIds(container)).toHaveLength(2));
    const bar = await screen.findByTestId('kit-views');
    expect(f.calls).toContain('GET /lore/me/views?section=adrs');
    const sel = within(bar).getByLabelText('Вид') as HTMLSelectElement;
    await waitFor(() => expect(sel.disabled).toBe(false));
    await act(async () => { fireEvent.change(sel, { target: { value: 'v-1' } }); });
    expect(w.location.search).toContain('vw=v-1');
    expect(w.location.search).toContain('lq=proposed');
    await waitFor(() => expect(rowIds(container)).toEqual(['ADR-2']));
  });

  it('ссылка на вид у другого человека открывает его (видимость решил сервер — вид в его списке)', async () => {
    const f = fetchWith([view({})]);
    const { container } = render(<ListScreen screen="adrs" fetchImpl={f.impl} urlState={win('?mod=forseti&sec=adrs&vw=v-1')} />);
    await waitFor(() => expect(rowIds(container)).toEqual(['ADR-2']));
  });

  it('ссылка на вид, не видимый этому человеку, — сказано словами', async () => {
    const f = fetchWith([]);
    render(<ListScreen screen="adrs" fetchImpl={f.impl} urlState={win('?mod=forseti&sec=adrs&vw=v-secret')} />);
    expect((await screen.findByTestId('kit-views-link-missing')).textContent).toContain('недоступен');
  });

  it('раздел без видов (решения) — панели нет и запроса видов нет', async () => {
    const f = fetchWith([]);
    render(<ListScreen screen="decisions" fetchImpl={f.impl} urlState={win('?mod=forseti&sec=decisions')} />);
    await waitFor(() => expect(f.calls.length).toBeGreaterThan(0));
    expect(screen.queryByTestId('kit-views')).toBeNull();
    expect(f.calls.some(c => c.includes('/lore/me/views'))).toBe(false);
  });

  it('«Командный по умолчанию» — только админу', async () => {
    const f = fetchWith([], 'admin');
    render(<ListScreen screen="adrs" fetchImpl={f.impl} urlState={win('?mod=forseti&sec=adrs')} />);
    const bar = await screen.findByTestId('kit-views');
    await waitFor(() => expect(f.calls).toContain('GET /lore/whoami'));
    fireEvent.click(within(bar).getByRole('button', { name: 'Сохранить как…' }));
    fireEvent.change(within(bar).getByLabelText('Кому виден'), { target: { value: 'all' } });
    await waitFor(() => expect(within(bar).getByRole('checkbox', { name: 'Командный по умолчанию' })).toBeTruthy());
  });
});
