// @vitest-environment jsdom
// SPRINT_UXR_S7B_ADMIN/S7B-14 — «мои проекты» с сервера.
//
// Прежде «мои» угадывались на клиенте срезом `user_project_roles?kc_sub=`: нет
// kc_sub — «нет входа», пустой срез — «не заведён в графе ролей». Сервер знает
// это сам, и у него три РАЗНЫХ ответа: 401 (не опознан), пустой список (ролей
// нет), строки (вот они). Клиент обязан их различать, а не сводить к «пусто».
import { describe, expect, it, vi } from 'vitest';
import { myProjects } from './me.projects';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('мои проекты', () => {
  it('положительный контроль: слаги и роли читаются', async () => {
    let seen = '';
    const f = vi.fn(async (input: RequestInfo | URL) => { seen = String(input); return json({ projects: [{ slug: 'AIDA/UnlimitedLORE', role: 'admin' }], count: 1 }); });
    const rows = await myProjects(undefined, f as unknown as typeof fetch);
    expect(seen).toBe('/lore/me/projects');
    expect(rows).toEqual([{ slug: 'AIDA/UnlimitedLORE', role: 'admin' }]);
  });

  it('ролей нет — пустой список, а не ошибка', async () => {
    const f = vi.fn(async () => json({ projects: [], count: 0 }));
    expect(await myProjects(undefined, f as unknown as typeof fetch)).toEqual([]);
  });

  it('не опознан — 401, и это не «ролей нет»', async () => {
    const f = vi.fn(async () => json({ error: 'NO_IDENTITY', detail: 'нужен токен' }, 401));
    await expect(myProjects(undefined, f as unknown as typeof fetch)).rejects.toThrow(/401/);
  });

  it('роль без названия — null, а не выдуманная строка', async () => {
    const f = vi.fn(async () => json({ projects: [{ slug: 'A/B' }], count: 1 }));
    expect(await myProjects(undefined, f as unknown as typeof fetch)).toEqual([{ slug: 'A/B', role: null }]);
  });

  it('строка без слага отбрасывается — проект без имени не проект', async () => {
    const f = vi.fn(async () => json({ projects: [{ role: 'admin' }, { slug: 'A/B', role: null }], count: 2 }));
    expect(await myProjects(undefined, f as unknown as typeof fetch)).toEqual([{ slug: 'A/B', role: null }]);
  });

  it('не-JSON в ответе — ошибка, а не пустой список', async () => {
    const f = vi.fn(async () => new Response('<html>502</html>', { status: 502 }));
    await expect(myProjects(undefined, f as unknown as typeof fetch)).rejects.toThrow();
  });
});
