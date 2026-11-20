// @vitest-environment jsdom
// SPRINT_LORE_PRODUCT_BACKLOG/SUPERTAGS-SPIKE — экран «сущности по тегу с полями» и источник тегов для «#тег»
// (прототип docs/prototypes/supertags-spike.html, «ок по sypertag» 20.11.2026). Колонки-поля — объединение ключей
// с рёбер TAGGED_WITH (их собирает сервер), фасеты с явным «не задано»; честные состояния: пусто ≠ не загрузилось.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { routeOf } from '../App';
import { applyTag, fetchTagEntities, fetchTagSuggest } from './tagApi';
import { TagEntitiesPage } from './TagEntitiesPage';
import { loreTagSource } from './tagSource';

const TABLE = {
  tag: 'security-review', state: 'ok', total: 3, types: { adr: 2, decision: 1 },
  columns: [{ key: 'risk', filled: 2 }, { key: 'due', filled: 1 }],
  facets: {
    risk: { values: [{ value: 'high', count: 1 }, { value: 'medium', count: 1 }], empty: 1, nonempty: 2, total: 3 },
    due: { values: [{ value: '2026-11-27', count: 1 }], empty: 2, nonempty: 1, total: 3 },
  },
  rows: [
    { type: 'adr', id: 'ADR-LORE-050', title: 'Ссылка на объект LORE прямо в MD', fields: { risk: 'high', due: '2026-11-27' }, tagged_at: '2026-11-20T10:00:00Z', tagged_by: 'arharaga' },
    { type: 'decision', id: 'D-2026-X', title: 'Решение', fields: { risk: 'medium' }, tagged_at: '2026-11-19T10:00:00Z' },
    { type: 'adr', id: 'ADR-LORE-053', title: 'Гейты', fields: {}, tagged_at: '2026-11-12T10:00:00Z' },
  ],
};

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

function fakeFetch(routes: Record<string, () => Response>) {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const hit = Object.entries(routes).find(([p]) => url.pathname === p);
    if (!hit) return json({ error: 'NOT_FOUND' }, 404);
    void init;
    return hit[1]();
  });
}

function fakeWin(search: string) {
  const loc = { search, pathname: '/tags', hash: '' };
  return {
    location: loc,
    history: { replaceState: vi.fn((_s: unknown, _t: string, url: string) => { loc.search = new URL(url, 'http://x').search; }), pushState: vi.fn() },
  } as unknown as Window;
}

beforeEach(() => { document.documentElement.lang = 'ru'; });
afterEach(cleanup);

describe('маршрут и клиент API', () => {
  it('/tags — экран тегов', () => {
    expect(routeOf('/tags')).toBe('tags');
    expect(routeOf('/tags/')).toBe('tags');
  });

  it('apply — POST /lore/tag/apply с полями; отказ — ошибка со статусом и причиной', async () => {
    const f = fakeFetch({ '/lore/tag/apply': () => json({ ok: true, action: 'added' }) });
    await applyTag({ type: 'adr', id: 'ADR-1', tag: 'security-review', fields: { risk: 'high' } }, { fetchImpl: f });
    const [, init] = f.mock.calls[0];
    expect(init?.method).toBe('POST');
    expect(JSON.parse(String(init?.body))).toEqual({ type: 'adr', id: 'ADR-1', tag_id: 'security-review', fields: { risk: 'high' }, action: 'add' });
    const bad = fakeFetch({ '/lore/tag/apply': () => json({ error: 'BAD_PARAMS', detail: 'ключ поля' }, 400) });
    await expect(applyTag({ type: 'adr', id: 'A', tag: 't', fields: {} }, { fetchImpl: bad })).rejects.toThrow(/400.*ключ поля/);
  });

  it('suggest и entities — разбор ответа; 502 — ошибка, а не пустой список', async () => {
    const f = fakeFetch({
      '/lore/tag/suggest': () => json({ q: 'sec', state: 'ok', tags: [{ tag_id: 'security-review', uses: 7, keys: ['risk'] }] }),
      '/lore/tag/entities': () => json(TABLE),
    });
    expect(await fetchTagSuggest('sec', { fetchImpl: f })).toEqual([{ tag: 'security-review', uses: 7, keys: ['risk'] }]);
    expect((await fetchTagEntities('security-review', null, { fetchImpl: f })).columns.map(c => c.key)).toEqual(['risk', 'due']);
    const down = fakeFetch({ '/lore/tag/suggest': () => json({ error: 'UPSTREAM' }, 502) });
    await expect(fetchTagSuggest('x', { fetchImpl: down })).rejects.toThrow(/502/);
  });
});

describe('источник тегов для TipTap', () => {
  it('ставится только типам-владельцам (ADR, решение); у задачи «#слово» остаётся «тип не знаем»', async () => {
    const f = fakeFetch({ '/lore/tag/apply': () => json({ ok: true }) });
    const src = loreTagSource({ type: 'adr', id: 'ADR-LORE-050' }, { fetchImpl: f });
    expect(src?.host).toBe('ADR-LORE-050');
    expect(loreTagSource({ type: 'task', id: 'SP/T1' })).toBeUndefined();
    expect(loreTagSource({ type: 'adr', id: '' })?.host).toBeNull();
    expect(await src!.apply('security-review', { risk: 'high' })).toEqual({ ok: true });
    const failing = loreTagSource({ type: 'decision', id: 'D-1' }, { fetchImpl: fakeFetch({ '/lore/tag/apply': () => json({ error: 'FORBIDDEN', detail: 'нет прав' }, 403) }) });
    const r = await failing!.apply('x', {});
    expect(r.ok).toBe(false);
    expect(r.ok ? '' : r.reason).toMatch(/403/);
  });
});

describe('экран «сущности по тегу»', () => {
  it('колонки — ключи рёбер; «—» где ключа нет; фасет считает «не задано» явно', async () => {
    const f = fakeFetch({ '/lore/tag/entities': () => json(TABLE), '/lore/tag/suggest': () => json({ state: 'ok', tags: [] }) });
    render(<TagEntitiesPage fetchImpl={f} win={fakeWin('?tag=security-review')} narrow={false} />);
    await waitFor(() => expect(screen.getByRole('columnheader', { name: 'risk' })).toBeTruthy());
    expect(screen.getByRole('columnheader', { name: 'due' })).toBeTruthy();
    const link = screen.getByRole('link', { name: 'ADR-LORE-050' });
    expect(link.getAttribute('href')).toContain('ADR-LORE-050');
    expect(screen.getAllByText('—').length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: /risk: не задано · 1/ })).toBeTruthy();
  });

  it('фасет сужает строки и пишется в адрес', async () => {
    const win = fakeWin('?tag=security-review');
    const f = fakeFetch({ '/lore/tag/entities': () => json(TABLE), '/lore/tag/suggest': () => json({ state: 'ok', tags: [] }) });
    render(<TagEntitiesPage fetchImpl={f} win={win} narrow={false} />);
    fireEvent.click(await screen.findByRole('button', { name: /risk: high · 1/ }));
    await waitFor(() => expect(screen.queryByRole('link', { name: 'D-2026-X' })).toBeNull());
    expect(screen.getByRole('link', { name: 'ADR-LORE-050' })).toBeTruthy();
    expect(win.location.search).toContain('f=risk%3Ahigh');
  });

  it('пусто — «записей с тегом нет»; 502 — «не смогли загрузить», и это не «пусто»', async () => {
    const empty = fakeFetch({ '/lore/tag/entities': () => json({ ...TABLE, state: 'empty', total: 0, rows: [], columns: [], facets: {}, types: {} }), '/lore/tag/suggest': () => json({ state: 'ok', tags: [] }) });
    render(<TagEntitiesPage fetchImpl={empty} win={fakeWin('?tag=nothing')} narrow={false} />);
    await waitFor(() => expect(screen.getByText(/Записей с тегом «#nothing» нет/)).toBeTruthy());
    cleanup();
    const down = fakeFetch({ '/lore/tag/entities': () => json({ error: 'UPSTREAM', detail: 'ArcadeDB недоступна' }, 502), '/lore/tag/suggest': () => json({ state: 'ok', tags: [] }) });
    render(<TagEntitiesPage fetchImpl={down} win={fakeWin('?tag=security-review')} narrow={false} />);
    await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/502/));
    expect(screen.queryByText(/Записей с тегом/)).toBeNull();
  });

  it('без тега в адресе — выбор тега из подсказки', async () => {
    const win = fakeWin('');
    const f = fakeFetch({ '/lore/tag/suggest': () => json({ state: 'ok', tags: [{ tag_id: 'security-review', uses: 7, keys: [] }] }), '/lore/tag/entities': () => json(TABLE) });
    render(<TagEntitiesPage fetchImpl={f} win={win} narrow={false} />);
    fireEvent.click(await screen.findByRole('button', { name: /#security-review · 7/ }));
    await waitFor(() => expect(screen.getByRole('columnheader', { name: 'risk' })).toBeTruthy());
    expect(win.location.search).toContain('tag=security-review');
  });

  it('телефон: карточки вместо таблицы', async () => {
    const f = fakeFetch({ '/lore/tag/entities': () => json(TABLE), '/lore/tag/suggest': () => json({ state: 'ok', tags: [] }) });
    const { container } = render(<TagEntitiesPage fetchImpl={f} win={fakeWin('?tag=security-review')} narrow />);
    await waitFor(() => expect(screen.getByRole('link', { name: 'ADR-LORE-050' })).toBeTruthy());
    expect(container.querySelector('table')).toBeNull();
    expect(container.querySelectorAll('.tg-card').length).toBe(3);
  });

  it('правка полей ребра из строки: patch уходит на /lore/tag/apply, таблица перечитывается', async () => {
    const f = fakeFetch({ '/lore/tag/entities': () => json(TABLE), '/lore/tag/suggest': () => json({ state: 'ok', tags: [] }), '/lore/tag/apply': () => json({ ok: true, action: 'updated' }) });
    render(<TagEntitiesPage fetchImpl={f} win={fakeWin('?tag=security-review')} narrow={false} />);
    fireEvent.click((await screen.findAllByRole('button', { name: /Править поля/ }))[0]);
    fireEvent.change(screen.getByLabelText('risk'), { target: { value: 'low' } });
    fireEvent.change(screen.getByLabelText('due'), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));
    await waitFor(() => expect(f.mock.calls.some(([u]) => String(u).includes('/lore/tag/apply'))).toBe(true));
    const call = f.mock.calls.find(([u]) => String(u).includes('/lore/tag/apply'))!;
    expect(JSON.parse(String(call[1]?.body))).toEqual({ type: 'adr', id: 'ADR-LORE-050', tag_id: 'security-review', fields: { risk: 'low', due: null }, action: 'add' });
    await waitFor(() => expect(f.mock.calls.filter(([u]) => String(u).includes('/lore/tag/entities')).length).toBe(2));
  });
});
