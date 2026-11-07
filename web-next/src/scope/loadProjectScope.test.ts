// SPRINT_UXR_S4_UI_SHELL_LISTS/S4-03 — список проектов для выбора в шапке из
// существующих слайсов LORE: git_projects (все) + user_project_roles (мои).
// Полнота (метаданные S1) проходит насквозь; сбой ролей не роняет список, а
// честно делает «мои» непроверенными.
import { describe, expect, it, vi } from 'vitest';
import { LoreHttpError, fetchSlice } from '../api/loreSlice';
import type { SliceFetcher } from '../api/loreSlice';
import { loadProjectScope } from './loadProjectScope';

const asFetch = (f: unknown) => f as SliceFetcher;

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

describe('S4-03 · клиент слайсов web-next', () => {
  it('GET /lore/slice/{id} с параметрами; тело — со строками и метаданными полноты', async () => {
    const f = vi.fn(async () => jsonResponse(200, { rows: [{ slug: 'a' }], truncated: true, limit: 1 }));
    const body = await fetchSlice<{ slug: string }>('git_projects', { kc_sub: 'u 1' }, { fetchImpl: f });
    expect(body.rows).toEqual([{ slug: 'a' }]);
    expect(body.truncated).toBe(true);
    const url = String((f.mock.calls[0] as unknown[])[0]);
    expect(url).toMatch(/\/lore\/slice\/git_projects\?kc_sub=u(\+|%20)1$/);
  });

  it('не-2xx — ошибка со статусом (403 станет «нет прав», а не «пусто»)', async () => {
    const f = vi.fn(async () => jsonResponse(403, { error: 'FORBIDDEN', detail: 'scope' }));
    await expect(fetchSlice('git_projects', {}, { fetchImpl: f })).rejects.toMatchObject({ status: 403 });
    await expect(fetchSlice('git_projects', {}, { fetchImpl: f })).rejects.toBeInstanceOf(LoreHttpError);
  });

  it('не-JSON (страница прокси) — ошибка, а не пустой список', async () => {
    const f = vi.fn(async () => new Response('<html>', { status: 200, headers: { 'Content-Type': 'text/html' } }));
    await expect(fetchSlice('git_projects', {}, { fetchImpl: f })).rejects.toBeInstanceOf(LoreHttpError);
  });
});

describe('S4-03 · список проектов', () => {
  const projects = { rows: [{ slug: 'tyr', name: 'TYR' }, { slug: 'unlimitedlore', name: null, default_branch: 'develop' }] };

  it('без пользователя — все проекты, «мои» не проверены и сказано почему', async () => {
    const fetch = vi.fn(async () => projects);
    const d = await loadProjectScope({ fetch: asFetch(fetch) });
    expect(d.rows.map(o => o.id)).toEqual(['tyr', 'unlimitedlore']);
    expect(d.rows[0].title).toBe('TYR');
    expect(d.rows[1].title).toBeUndefined();
    expect(d.mine).toBe('unknown');
    expect(d.mineReason).toBe('no-user');
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('с пользователем — его роли помечают «мои»', async () => {
    const fetch = vi.fn(async (slice: string) => slice === 'git_projects'
      ? projects
      : { rows: [{ kc_sub: 'u1', projects: ['unlimitedlore', null], roles: ['owner'] }] });
    const d = await loadProjectScope({ fetch: asFetch(fetch), sub: 'u1' });
    expect(d.mine).toBe('known');
    expect(d.rows.find(o => o.id === 'unlimitedlore')?.mine).toBe(true);
    expect(d.rows.find(o => o.id === 'tyr')?.mine).toBe(false);
    expect(fetch).toHaveBeenCalledWith('user_project_roles', { kc_sub: 'u1' }, undefined);
  });

  it('пользователь не заведён в графе ролей (0 строк) — «мои» не проверены, а не «ролей нет»', async () => {
    const fetch = vi.fn(async (slice: string) => slice === 'git_projects' ? projects : { rows: [] });
    const d = await loadProjectScope({ fetch: asFetch(fetch), sub: 'ghost' });
    expect(d.mine).toBe('unknown');
    expect(d.mineReason).toBe('not-registered');
  });

  it('слайс ролей упал — список есть, «мои» не проверены с причиной', async () => {
    const fetch = vi.fn(async (slice: string) => {
      if (slice === 'git_projects') return projects;
      throw new LoreHttpError(502, 'LORE_UPSTREAM', 'down');
    });
    const d = await loadProjectScope({ fetch: asFetch(fetch), sub: 'u1' });
    expect(d.rows.length).toBe(2);
    expect(d.mine).toBe('unknown');
    expect(d.mineReason).toBe('roles-error');
  });

  it('метаданные полноты git_projects проходят насквозь', async () => {
    const fetch = vi.fn(async () => ({ ...projects, truncated: 'unknown' as const }));
    const d = await loadProjectScope({ fetch: asFetch(fetch) });
    expect(d.truncated).toBe('unknown');
  });

  it('сам список не получен — ошибка наверх (экран покажет ошибку, не пусто)', async () => {
    const fetch = vi.fn(async () => { throw new LoreHttpError(403, 'FORBIDDEN', ''); });
    await expect(loadProjectScope({ fetch: asFetch(fetch) })).rejects.toMatchObject({ status: 403 });
  });
});
