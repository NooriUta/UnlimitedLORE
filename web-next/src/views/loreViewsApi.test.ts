// SPRINT_LORE_PRODUCT_BACKLOG/MINI-03-ME-VIEWS-CONTRACT — один контракт видов для веба и мобилки:
// клиент ходит туда, где живёт сервер (LoreMeResource), а не в заглушечные /lore/views + PATCH/DELETE.
//   GET  /lore/me/views?section=      → {views:[…], defaults:{section: view_uid}}
//   POST /lore/me/views               → создать (без view_uid) / править (с view_uid + expected_version)
//   POST /lore/me/views/delete        → {view_uid, expected_version}
import { describe, expect, it } from 'vitest';
import { createLoreViewApi } from './loreViewsApi';

type Call = { path: string; init?: RequestInit };

function fakeFetch(handler: (c: Call) => { status?: number; body: unknown }) {
  const calls: Call[] = [];
  const impl = (async (path: string, init?: RequestInit) => {
    const c = { path, init };
    calls.push(c);
    const r = handler(c);
    return new Response(JSON.stringify(r.body), { status: r.status ?? 200, headers: { 'content-type': 'application/json' } });
  }) as unknown as typeof fetch;
  return { impl, calls };
}

const row = (over: Record<string, unknown> = {}) => ({
  view_uid: 'view-1', name: 'Мой', section: 'sprints', query: 'lg=status', visibility: 'me', roles: [],
  is_team_default: false, is_personal_default: false, own: true, version: 3, updated_at: '2026-11-14T00:00:00Z', ...over,
});

describe('MINI-03 · адреса — серверные, не заглушечные', () => {
  it('list → GET /lore/me/views?section=…', async () => {
    const f = fakeFetch(() => ({ body: { ok: true, views: [row()], defaults: {} } }));
    const api = createLoreViewApi({ user: 'kc-1', fetchImpl: f.impl });
    const views = await api.list('sprints');
    expect(f.calls[0].path).toBe('/lore/me/views?section=sprints');
    expect(views).toEqual([expect.objectContaining({ id: 'view-1', name: 'Мой', section: 'sprints', query: 'lg=status', visibility: 'me', owner: 'kc-1' })]);
  });

  it('create → POST /lore/me/views без view_uid', async () => {
    const f = fakeFetch(() => ({ body: { ok: true, view: row({ view_uid: 'view-9' }) } }));
    const api = createLoreViewApi({ user: 'kc-1', fetchImpl: f.impl });
    const v = await api.create({ name: 'Мой', section: 'sprints', query: 'lg=status', visibility: 'me' });
    expect(f.calls[0].path).toBe('/lore/me/views');
    expect(f.calls[0].init?.method).toBe('POST');
    const sent = JSON.parse(String(f.calls[0].init?.body));
    expect(sent).toMatchObject({ name: 'Мой', section: 'sprints', query: 'lg=status', visibility: 'me' });
    expect(sent.view_uid).toBeUndefined();
    expect(v.id).toBe('view-9');
  });

  it('update → POST /lore/me/views с view_uid и expected_version из последнего чтения', async () => {
    const f = fakeFetch(c => c.path.startsWith('/lore/me/views?')
      ? { body: { ok: true, views: [row()] } }
      : { body: { ok: true, view: row({ name: 'Новое', version: 4 }) } });
    const api = createLoreViewApi({ user: 'kc-1', fetchImpl: f.impl });
    await api.list('sprints');
    const v = await api.update('view-1', { name: 'Новое' });
    const sent = JSON.parse(String(f.calls[1].init?.body));
    expect(f.calls[1].path).toBe('/lore/me/views');
    expect(sent).toMatchObject({ view_uid: 'view-1', name: 'Новое', expected_version: 3 });
    expect(v.name).toBe('Новое');
  });

  it('remove → POST /lore/me/views/delete', async () => {
    const f = fakeFetch(() => ({ body: { ok: true, outcome: 'deleted' } }));
    const api = createLoreViewApi({ user: 'kc-1', fetchImpl: f.impl });
    await api.remove('view-1');
    expect(f.calls[0].path).toBe('/lore/me/views/delete');
    expect(JSON.parse(String(f.calls[0].init?.body))).toMatchObject({ view_uid: 'view-1' });
  });
});

describe('MINI-03 · формы и честные отказы', () => {
  it('командный вид — owner null и team_default; видимость по ролям — {roles}', async () => {
    const f = fakeFetch(() => ({ body: { ok: true, views: [
      row({ view_uid: 't', own: false, is_team_default: true, visibility: 'all' }),
      row({ view_uid: 'r', own: false, visibility: 'roles', roles: ['architect'] }),
    ] } }));
    const views = await createLoreViewApi({ user: 'kc-1', fetchImpl: f.impl }).list('adrs');
    expect(views[0]).toMatchObject({ id: 't', owner: null, team_default: true, visibility: 'all' });
    expect(views[1]).toMatchObject({ id: 'r', visibility: { roles: ['architect'] } });
    expect(views[1].owner).not.toBe('kc-1');
  });

  it('отказ сервера — исключение со status (403/404/409), а не пустой список', async () => {
    for (const status of [401, 403, 404, 409]) {
      const f = fakeFetch(() => ({ status, body: { error: 'X', detail: 'd' } }));
      await expect(createLoreViewApi({ user: 'kc-1', fetchImpl: f.impl }).list('sprints'))
        .rejects.toMatchObject({ status });
    }
  });
});
