// @vitest-environment jsdom
// SPRINT_UXR_S5_RECORD_TASKS/S5-14 — личное пользователя с сервера вместо
// заглушки в браузере.
//
// Бэкенд S2-04/S2-05 выкатился (LoreMeResource, LoreMemoryResource), но
// подменить заглушку одной строкой нельзя: живой сервер и контракт v2
// расходятся не формой, а ИМЕНАМИ И ЗНАЧЕНИЯМИ.
//
//   контракт v2                     сервер (LoreMePrefs.SETTINGS)
//   collapse_nav_on_read            nav_collapse_on_read
//   right_column: auto|open|closed  right_column: auto|shown|hidden
//   text_size: sm|md|lg|xl          text_size: s|m|l|xl
//   mode: dark|light                theme: dark|light|system
//   nav_version: v1|v2              new_navigation: boolean
//
// Наивная подмена дала бы 400 почти на каждую настройку: неизвестный ключ
// сервер отвергает по белому списку — и правильно делает. Поэтому клиент
// переводит имена и значения в обе стороны.
//
// Чего переводом не закрыть, то названо честно: значение, которого в v2 нет
// (theme: system), не выдумывается и не молчит — берётся умолчание v2, а
// расхождение попадает в warnings ответа.
//
// Остальные расхождения тоже не формальность: 401 на сервере называется
// NO_IDENTITY («не смогли понять, кто вы»), и путать его с «у вас ничего нет»
// нельзя; виды и настройки правятся через POST (PUT/DELETE в /lore нет);
// удаление вида — POST /lore/me/views/delete.
import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS } from './contracts/s2';
import { S2ConflictError, S2HttpError } from './contracts/s2.stubs';
import { createLiveS2Client } from './liveS2';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/** Ответ сервера на GET/POST /lore/me/settings — форма LoreMeResource.settingsOut. */
const settingsOut = (stored: Record<string, unknown>, version = 3) => ({
  ok: true,
  settings: {
    nav_collapse_on_read: false, right_column: 'auto', text_size: 'm', theme: 'dark',
    density: 'roomy', single_key_shortcuts: false, stripes: false, new_navigation: false,
    ...stored,
  },
  stored,
  version,
  updated_at: '2026-11-09T00:00:00.000000Z',
  schema: {
    nav_collapse_on_read: { type: 'boolean', default: false },
    right_column: { type: 'enum', default: 'auto', values: ['auto', 'shown', 'hidden'] },
    text_size: { type: 'enum', default: 'm', values: ['s', 'm', 'l', 'xl'] },
    theme: { type: 'enum', default: 'dark', values: ['dark', 'light', 'system'] },
    density: { type: 'enum', default: 'roomy', values: ['roomy', 'compact', 'comfortable'] },
    single_key_shortcuts: { type: 'boolean', default: false },
    stripes: { type: 'boolean', default: false },
    new_navigation: { type: 'boolean', default: false },
  },
});

const client = (f: unknown) => createLiveS2Client({ fetchImpl: f as typeof fetch });
const callOf = (f: ReturnType<typeof vi.fn>, i = 0) => ({
  url: String(f.mock.calls[i][0]),
  init: (f.mock.calls[i][1] ?? {}) as RequestInit,
  body: f.mock.calls[i][1]?.body ? JSON.parse(String(f.mock.calls[i][1].body)) : undefined,
});

describe('настройки: чтение', () => {
  it('положительный контроль: идём на /lore/me/settings и получаем версию', async () => {
    const f = vi.fn(async () => json(settingsOut({})));
    const got = await client(f).getSettings();
    expect(callOf(f).url).toContain('/lore/me/settings');
    expect(got.version).toBe(3);
  });

  it('имена и значения сервера переводятся в контракт v2', async () => {
    const f = vi.fn(async () => json(settingsOut({
      nav_collapse_on_read: true, right_column: 'hidden', text_size: 'l',
      theme: 'light', new_navigation: true, density: 'compact',
    })));
    const got = await client(f).getSettings();
    expect(got.settings.collapse_nav_on_read).toBe(true);
    expect(got.settings.right_column).toBe('closed');
    expect(got.settings.text_size).toBe('lg');
    expect(got.settings.mode).toBe('light');
    expect(got.settings.nav_version).toBe('v2');
    expect(got.settings.density).toBe('compact');
  });

  it('умолчания сервера тоже переводятся — их показывает экран настроек', async () => {
    const f = vi.fn(async () => json(settingsOut({})));
    const got = await client(f).getSettings();
    expect(got.defaults.right_column).toBe('auto');
    expect(got.defaults.text_size).toBe('md');
    expect(got.defaults.mode).toBe('dark');
  });

  it('text_size: xl доезжает без предупреждений — выбор «очень крупно (4K)» не слетает на умолчание', async () => {
    const f = vi.fn(async () => json(settingsOut({ text_size: 'xl' })));
    const got = await client(f).getSettings();
    expect(got.settings.text_size).toBe('xl');
    expect(got.warnings ?? []).toEqual([]);
  });

  it('значение, которого в v2 нет, не выдумывается: умолчание v2 плюс честное предупреждение', async () => {
    const f = vi.fn(async () => json(settingsOut({ theme: 'system' })));
    const got = await client(f).getSettings();
    expect(got.settings.mode).toBe(DEFAULT_SETTINGS.mode);
    expect(got.settings.text_size).toBe(DEFAULT_SETTINGS.text_size);
    expect(got.warnings?.join(' ')).toMatch(/theme/);
    expect(got.warnings?.join(' ')).not.toMatch(/text_size/);
  });

  it('палитра и roomy доходят, когда сервер их знает (белый список PR #945)', async () => {
    const f = vi.fn(async () => json(settingsOut({ palette: 'lichen', density: 'roomy' })));
    const got = await client(f).getSettings();
    expect(got.settings.palette).toBe('lichen');
    expect(got.settings.density).toBe('roomy');
    expect(got.warnings ?? []).toEqual([]);
  });
});

describe('настройки: запись', () => {
  it('патч уходит POST, с серверными именами и ожидаемой версией', async () => {
    const f = vi.fn(async () => json(settingsOut({ theme: 'light' }, 4)));
    await client(f).patchSettings({ patch: { mode: 'light', text_size: 'sm', nav_version: 'v1' }, expected_version: 3 });
    const { url, init, body } = callOf(f);
    expect(url).toContain('/lore/me/settings');
    expect(init.method).toBe('POST');
    expect(body).toEqual({ settings: { theme: 'light', text_size: 's', new_navigation: false }, expected_version: 3 });
  });

  it('text_size: xl уходит на сервер как xl — round-trip выбора «очень крупно» не теряется', async () => {
    const f = vi.fn(async () => json(settingsOut({}, 4)));
    await client(f).patchSettings({ patch: { text_size: 'xl' }, expected_version: 3 });
    expect(callOf(f).body.settings.text_size).toBe('xl');
  });

  it('409 доносится с ТЕКУЩИМ состоянием — иначе человек повторит вслепую', async () => {
    const f = vi.fn(async () => json({ error: 'CONFLICT', detail: 'изменены в другом месте', current: settingsOut({ theme: 'light' }, 7) }, 409));
    await expect(client(f).patchSettings({ patch: { mode: 'dark' }, expected_version: 3 }))
      .rejects.toSatisfy((e: unknown) => e instanceof S2ConflictError
        && (e.body.current as { version: number }).version === 7);
  });

  it('400 по белому списку — отказ в правке, а не «сохранено»', async () => {
    const f = vi.fn(async () => json({ error: 'BAD_PARAMS', detail: 'неизвестная настройка: palette' }, 400));
    await expect(client(f).patchSettings({ patch: { palette: 'lichen' }, expected_version: 1 }))
      .rejects.toSatisfy((e: unknown) => e instanceof S2HttpError && e.status === 400);
  });

  it('пустой патч на сервер не идёт: нечего сохранять — незачем спрашивать', async () => {
    const f = vi.fn(async () => json(settingsOut({})));
    await client(f).patchSettings({ patch: {}, expected_version: 3 });
    expect(f.mock.calls.length, 'только чтение, без записи').toBe(1);
    expect(callOf(f).init.method ?? 'GET').toBe('GET');
  });
});

describe('«не опознан» — не «ничего нет»', () => {
  it('401 NO_IDENTITY становится UNAUTHENTICATED контракта, с причиной сервера', async () => {
    const f = vi.fn(async () => json({ error: 'NO_IDENTITY', detail: 'нужен токен человека или агента с владельцем' }, 401));
    await expect(client(f).getSettings()).rejects.toSatisfy((e: unknown) =>
      e instanceof S2HttpError && e.status === 401 && e.body.error === 'UNAUTHENTICATED'
      && String(e.body.detail).includes('токен'));
  });

  it('сеть упала — ошибка, а не пустые настройки', async () => {
    const f = vi.fn(async () => { throw new Error('сеть недоступна'); });
    await expect(client(f).getSettings()).rejects.toThrow(/сеть недоступна/);
  });

  it('не-JSON в ответе — тоже ошибка с кодом, а не «пусто»', async () => {
    const f = vi.fn(async () => new Response('<html>502</html>', { status: 502 }));
    await expect(client(f).getSettings()).rejects.toSatisfy((e: unknown) =>
      e instanceof S2HttpError && e.status === 502);
  });
});

describe('память: что LORE помнит обо мне', () => {
  const memoryBody = {
    ok: true, remembering: true, retention_days: 90, count: 2, access: 'self_and_own_agents', warnings: [],
    categories: [
      { kind: 'frequent_views', items: [{ memory_id: 'm1', kind: 'frequent_views', key: 'view-1', label: 'Блокеры', hits: 14, first_seen: '2026-10-01T08:00:00Z', last_seen: '2026-11-09T00:00:00Z' }] },
      { kind: 'frequent_slices', items: [] },
      { kind: 'recent_records', items: [{ memory_id: 'recent:adr:ADR-1', kind: 'recent_records', key: 'adr:ADR-1', label: null, hits: 2, first_seen: '2026-11-08T08:00:00Z', last_seen: '2026-11-09T00:00:00Z' }] },
    ],
  };

  it('положительный контроль: категории и срок хранения приходят как есть', async () => {
    const f = vi.fn(async () => json(memoryBody));
    const got = await client(f).memory();
    expect(callOf(f).url).toContain('/lore/me/memory');
    expect(got.remembering).toBe(true);
    expect(got.retention_days).toBe(90);
    expect(got.categories.map(c => c.kind)).toEqual(['frequent_views', 'frequent_slices', 'recent_records']);
    expect(got.categories[0].items[0].label).toBe('Блокеры');
  });

  it('«не запоминаю» — это значение, а не пустой список', async () => {
    const f = vi.fn(async () => json({ ...memoryBody, remembering: false, categories: [], count: 0 }));
    const got = await client(f).memory();
    expect(got.remembering).toBe(false);
  });

  it('стереть одну запись — POST на /delete с её memory_id', async () => {
    const f = vi.fn(async () => json({ ok: true, outcome: 'DELETED', memory_id: 'm1', erased: { habit: 1 } }));
    await client(f).forget('m1');
    const { url, init, body } = callOf(f);
    expect(url).toContain('/lore/me/memory/delete');
    expect(init.method).toBe('POST');
    expect(body).toEqual({ memory_id: 'm1' });
  });

  it('стереть категорию — тот же путь, но телом kind; без kind стирается всё', async () => {
    const f = vi.fn(async () => json({ ok: true, outcome: 'DELETED', erased: { frequent_views: 3 } }));
    const api = client(f);
    await api.forgetAll('frequent_views');
    expect(callOf(f).body).toEqual({ kind: 'frequent_views' });
    await api.forgetAll();
    expect(callOf(f, 1).body).toEqual({});
  });

  it('сколько стёрли — считается по ответу сервера, а не выдумывается', async () => {
    const f = vi.fn(async () => json({ ok: true, outcome: 'DELETED', erased: { frequent_views: 3, recent_records: 2 } }));
    expect((await client(f).forgetAll()).deleted).toBe(5);
  });

  it('«не найдено» при стирании — ошибка, а не тихий успех', async () => {
    const f = vi.fn(async () => json({ error: 'NOT_FOUND', detail: 'запись памяти m9 не найдена' }, 404));
    await expect(client(f).forget('m9')).rejects.toSatisfy((e: unknown) =>
      e instanceof S2HttpError && e.status === 404);
  });

  it('переключатель «не запоминать» — POST /remembering, ответ сервера главнее', async () => {
    const f = vi.fn(async () => json({ ok: true, remembering: false, outcome: 'UPDATED' }));
    const got = await client(f).setRemembering({ remembering: false });
    expect(callOf(f).url).toContain('/lore/me/memory/remembering');
    expect(callOf(f).body).toEqual({ remembering: false });
    expect(got.remembering).toBe(false);
  });
});

describe('недавнее и избранное', () => {
  it('недавние переводятся в ссылки контракта, «не запоминаю» сохраняется', async () => {
    const f = vi.fn(async () => json({
      ok: true, count: 1, cap: 50, remembering: true, retention_days: 90,
      recent: [{ ref_type: 'adr', ref_id: 'ADR-1', visited_at: '2026-11-09T00:00:00Z', visits: 3 }],
    }));
    const got = await client(f).recent(10);
    expect(callOf(f).url).toMatch(/\/lore\/me\/recent\?limit=10/);
    expect(got.remembering).toBe(true);
    expect(got.items).toEqual([{ type: 'adr', id: 'ADR-1', title: null, last_seen: '2026-11-09T00:00:00Z' }]);
  });

  it('отметка открытия: сервер мог отказать «не запоминаю» — передаём как есть', async () => {
    const f = vi.fn(async () => json({ ok: true, recorded: false, reason: 'not_remembering', outcome: 'NOOP' }));
    expect(await client(f).recordRecent('adr', 'ADR-1')).toEqual({ recorded: false, reason: 'not_remembering' });
  });

  it('избранное: список и добавление одним путём с action', async () => {
    const f = vi.fn(async () => json({ ok: true, count: 1, favorites: [{ ref_type: 'adr', ref_id: 'ADR-1', added_at: '2026-11-09T00:00:00Z' }] }));
    const api = client(f);
    const list = await api.listFavorites();
    expect(list.items[0]).toEqual({ type: 'adr', id: 'ADR-1', title: null, added_at: '2026-11-09T00:00:00Z' });
    await api.addFavorite('adr', 'ADR-2');
    expect(callOf(f, 1).body).toEqual({ ref_type: 'adr', ref_id: 'ADR-2', action: 'add' });
    await api.removeFavorite('adr', 'ADR-2');
    expect(callOf(f, 2).body).toEqual({ ref_type: 'adr', ref_id: 'ADR-2', action: 'remove' });
  });
});

describe('виды: POST вместо PUT/DELETE — в /lore других глаголов нет', () => {
  const viewOut = (over: Record<string, unknown> = {}) => ({
    view_uid: 'view-1', name: 'Открытые', section: 'tasks', query: 'status=open',
    visibility: 'all', roles: [], is_team_default: true, is_personal_default: false,
    own: false, version: 2, created_at: '2026-11-08T00:00:00Z', updated_at: '2026-11-08T00:00:00Z',
    ...over,
  });

  it('список: view_uid становится view_id, видимость — размеченным значением', async () => {
    const f = vi.fn(async () => json({ ok: true, count: 1, views: [viewOut({ visibility: 'roles', roles: ['admin'] })], defaults: { tasks: 'view-1' } }));
    const got = await client(f).listViews('tasks');
    expect(callOf(f).url).toMatch(/\/lore\/me\/views\?section=tasks/);
    expect(got.items[0].view_id).toBe('view-1');
    expect(got.items[0].visibility).toEqual({ kind: 'roles', roles: ['admin'] });
    expect(got.effective_default).toEqual({ tasks: 'view-1' });
  });

  it('создание: POST без view_uid; ответ — созданный вид', async () => {
    const f = vi.fn(async () => json({ ok: true, outcome: 'CREATED', view: viewOut({ view_uid: 'view-9' }) }));
    const got = await client(f).createView({ name: 'Мой', section: 'tasks', query: 'q=1', visibility: { kind: 'me' } });
    expect(callOf(f).body).toEqual({ name: 'Мой', section: 'tasks', query: 'q=1', visibility: 'me', roles: [] });
    expect(got.view_id).toBe('view-9');
  });

  it('правка: тот же POST, но с view_uid и expected_version', async () => {
    const f = vi.fn(async () => json({ ok: true, outcome: 'UPDATED', view: viewOut({ name: 'Иначе', version: 3 }) }));
    const got = await client(f).updateView('view-1', { name: 'Иначе', expected_version: 2 });
    expect(callOf(f).body).toMatchObject({ view_uid: 'view-1', name: 'Иначе', expected_version: 2 });
    expect(got.version).toBe(3);
  });

  it('удаление: POST /views/delete, а не DELETE', async () => {
    const f = vi.fn(async () => json({ ok: true, outcome: 'DELETED', view_uid: 'view-1' }));
    await client(f).deleteView('view-1', 2);
    expect(callOf(f).url).toContain('/lore/me/views/delete');
    expect(callOf(f).init.method).toBe('POST');
    expect(callOf(f).body).toEqual({ view_uid: 'view-1', expected_version: 2 });
  });

  it('409 на правке вида доносит текущий вид', async () => {
    const f = vi.fn(async () => json({ error: 'CONFLICT', detail: 'вид изменён в другом месте', current: viewOut({ version: 5 }) }, 409));
    await expect(client(f).updateView('view-1', { name: 'X', expected_version: 2 }))
      .rejects.toSatisfy((e: unknown) => e instanceof S2ConflictError
        && (e.body.current as { version: number }).version === 5);
  });
});

describe('чего в боевом клиенте нет — говорится громко', () => {
  it('история: форма сервера другая, поэтому честный отказ вместо пустого ответа', async () => {
    const f = vi.fn(async () => json({}));
    await expect(client(f).history({ type: 'task', id: 'T-1' })).rejects.toThrow(/\/lore\/history/);
    expect(f.mock.calls.length, 'на сервер не ходим — и так знаем, что не разберём').toBe(0);
  });

  it('обратные связи: у графа свой живой путь, здесь — отказ со ссылкой на него', async () => {
    const f = vi.fn(async () => json({}));
    await expect(client(f).backlinks({ type: 'adr', id: 'ADR-1' })).rejects.toThrow('record/loreGraph.ts');
    expect(f.mock.calls.length).toBe(0);
  });
});

describe("409 доносит состояние В ФОРМЕ КОНТРАКТА, а не серверную", () => {
  it("настройки: current переведён — повтор правки пойдёт по настоящему значению", async () => {
    const f = vi.fn(async () => json({ error: "CONFLICT", detail: "изменены в другом месте", current: settingsOut({ theme: "light", text_size: "l" }, 7) }, 409));
    await expect(client(f).patchSettings({ patch: { mode: "dark" }, expected_version: 3 }))
      .rejects.toSatisfy((e: unknown) => {
        const cur = (e as S2ConflictError<{ version: number; settings: { mode: string; text_size: string } }>).body.current!;
        return cur.version === 7 && cur.settings.mode === "light" && cur.settings.text_size === "lg";
      });
  });
});
