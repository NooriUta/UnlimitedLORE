// SPRINT_UXR_S2_GRAPH_MEMORY/S2-01 — контракты API S2 и заглушки для UI v2 (S4).
// Спека: SPEC-LORE-UXR-S2-CONTRACTS. Тест держит три вещи:
//   1) сверку с бэкендом там, где правда уже живёт в Java (HIST_PARENT, Branch);
//   2) правила, которые сервер обязан повторить (видимость видов, «по умолчанию»,
//      настройки, доступ к памяти, аномалии истории);
//   3) заглушки ведут себя по контракту (409 с current, «не запоминаю» ≠ «пусто»).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  BACKLINK_EXCLUDED_EDGE_TYPES,
  BACKLINK_TARGET_TYPES,
  DEFAULT_SETTINGS,
  HISTORY_HIST_CLASS,
  HISTORY_TYPES,
  MEMORY_KINDS,
  MEMORY_RETENTION_DAYS,
  S2_ENDPOINTS,
  canReadMemory,
  canSeeView,
  changedFields,
  effectiveDefaultView,
  historyAnomalies,
  mergeSettings,
  validateSettingsPatch,
  type HistoryVersion,
  type S2Caller,
  type SavedView,
} from './s2';
import { S2ConflictError, S2HttpError, createS2Stub } from './s2.stubs';

const LORE_JAVA = join(__dirname, '../../../../backend/src/main/java/studio/seer/heimdall/lore');

const me: S2Caller = { kind: 'human', kc_sub: 'sub-owner', roles: ['admin'] };
const peer: S2Caller = { kind: 'human', kc_sub: 'sub-peer', roles: ['pm'] };

function view(over: Partial<SavedView>): SavedView {
  return {
    view_id: 'v1', name: 'Мои открытые', section: 'tasks', query: 'status=open',
    visibility: { kind: 'me' }, owner: { kc_sub: 'sub-owner' }, is_team_default: false,
    order: 0, created_at: '2026-11-07T10:00:00Z', updated_at: '2026-11-07T10:00:00Z', version: 1,
    ...over,
  };
}

describe('S2-01 · сверка с бэкендом: типы берутся из Java, а не выдумываются', () => {
  it('HISTORY_TYPES = entityType из LoreSlices.HIST_PARENT (та же карта, что у history_hygiene)', () => {
    const src = readFileSync(join(LORE_JAVA, 'LoreSlices.java'), 'utf8');
    const pairs = [...src.matchAll(/Map\.entry\("(\w+)",\s*new HistParent\("(\w+)",\s*"(\w+)"\)\)/g)];
    expect(pairs.length).toBeGreaterThan(5); // положительный контроль: парсер что-то нашёл
    const fromJava = pairs.map(m => m[2]).sort();
    expect([...HISTORY_TYPES].sort()).toEqual(fromJava);
    // и класс цепочки у каждого типа тот же, что ключ карты
    expect(Object.fromEntries(pairs.map(m => [m[2], m[1]]))).toEqual({ ...HISTORY_HIST_CLASS });
  });

  it('BACKLINK_TARGET_TYPES = типы веток поиска (S2-02 переиспользует таблицу Branch)', () => {
    const src = readFileSync(join(LORE_JAVA, 'LoreSearchResource.java'), 'utf8');
    const fromJava = [...src.matchAll(/new Branch\("(\w+)"/g)].map(m => m[1]).sort();
    expect(fromJava.length).toBeGreaterThan(5);
    expect([...BACKLINK_TARGET_TYPES].sort()).toEqual(fromJava);
  });

  it('исключаемые из backlinks рёбра — реальные типы схемы (опечатка = молча пропущенная связь)', () => {
    const all = ['LoreSchemaInitializer.java', 'LoreSchemaMigrations.java']
      .map(f => readFileSync(join(LORE_JAVA, f), 'utf8')).join('\n');
    const edgeTypes = new Set([...all.matchAll(/CREATE EDGE TYPE (\w+)/g)].map(m => m[1]));
    expect(edgeTypes.has('HAS_STATE')).toBe(true); // положительный контроль
    for (const e of BACKLINK_EXCLUDED_EDGE_TYPES) expect(edgeTypes.has(e), e).toBe(true);
    expect(BACKLINK_EXCLUDED_EDGE_TYPES).toEqual(expect.arrayContaining(['HAS_STATE', 'BELONGS_TO_PROJECT']));
  });
});

describe('S2-01 · реестр эндпоинтов', () => {
  it('личное — только под /lore/me/*: владелец всегда вызывающий, чужого пользователя адресовать нельзя', () => {
    const personal = S2_ENDPOINTS.filter(e => e.contract === 'views' || e.contract === 'settings' || e.contract === 'memory');
    expect(personal.length).toBeGreaterThan(5);
    for (const e of personal) {
      expect(e.path.startsWith('/lore/me/'), e.path).toBe(true);
      // «никаких сводок по людям для руководителя» — нет ни параметра, ни сегмента пользователя
      expect(e.path + ' ' + (e.query ?? []).join(' ')).not.toMatch(/\b(user|kc_sub|sub|owner)\b/);
    }
  });

  it('каждая запись над SCD2/версией объявляет 409 (S2-09), а чтение — нет', () => {
    for (const e of S2_ENDPOINTS) {
      const writes = e.method === 'PUT' || e.method === 'PATCH' || e.method === 'DELETE';
      if (writes && e.versioned) expect(e.errors, `${e.method} ${e.path}`).toContain('CONFLICT');
      if (e.method === 'GET') expect(e.errors).not.toContain('CONFLICT');
    }
    expect(S2_ENDPOINTS.some(e => e.versioned)).toBe(true);
  });

  it('память (S2-05) — пути и методы как у бэкенда LoreMemoryResource: только GET/POST', () => {
    const mem = S2_ENDPOINTS.filter(e => e.contract === 'memory').map(e => `${e.method} ${e.path}`);
    expect(mem).toEqual(expect.arrayContaining([
      'GET /lore/me/memory',
      'POST /lore/me/memory/delete',
      'POST /lore/me/memory/remembering',
      'POST /lore/me/memory/hit',
    ]));
    expect(mem.filter(k => /^(DELETE|PUT|PATCH) /.test(k))).toEqual([]);
    const hit = S2_ENDPOINTS.find(e => e.method === 'POST' && e.path === '/lore/me/memory/hit');
    expect(hit?.agents).toBe('none');
    expect(hit?.errors).toEqual(expect.arrayContaining(['UNAUTHENTICATED', 'BAD_PARAMS', 'NOT_FOUND', 'AGENT_SCOPE_FORBIDDEN']));
  });

  it('пары method+path уникальны', () => {
    const keys = S2_ENDPOINTS.map(e => `${e.method} ${e.path}`);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe('S2-01 · история: аномалии и дифф', () => {
  const v = (state_uid: string, valid_to: string | null, fields: Record<string, unknown>): HistoryVersion => ({
    state_uid, valid_from: '2026-11-01T00:00:00Z', valid_to, is_open: valid_to == null,
    status: null, status_category: null, fields, changed: [], author: { kind: 'unknown' },
  });

  it('две открытые версии — аномалия гонки (то, что лечит S2-09), а не «последняя победила»', () => {
    expect(historyAnomalies([v('a', null, {}), v('b', null, {})])).toContain('multiple_open_versions');
    expect(historyAnomalies([v('a', null, {}), v('b', '2026-11-02T00:00:00Z', {})])).toEqual([]);
  });

  it('открытая версия без valid_from — та же находка, что у history_hygiene', () => {
    expect(historyAnomalies([{ ...v('a', null, {}), valid_from: null }])).toContain('open_state_without_valid_from');
  });

  it('ни одной открытой при непустой истории — запись закрыта целиком, это видно', () => {
    expect(historyAnomalies([v('a', '2026-11-02T00:00:00Z', {})])).toContain('no_open_version');
    expect(historyAnomalies([])).toEqual([]);
  });

  it('changedFields: только реально изменённые поля, в устойчивом порядке', () => {
    expect(changedFields({ a: 1, b: 'x', c: [1] }, { a: 1, b: 'y', c: [1], d: true })).toEqual(['b', 'd']);
    expect(changedFields(null, { a: 1 })).toEqual(['a']);
    expect(changedFields({ a: 1, b: 2 }, { a: 1 })).toEqual(['b']);
  });
});

describe('S2-01 · виды: видимость и «по умолчанию»', () => {
  it('me — только владельцу; all — всем; roles — по пересечению ролей', () => {
    expect(canSeeView(view({}), me)).toBe(true);
    expect(canSeeView(view({}), peer)).toBe(false);
    expect(canSeeView(view({ visibility: { kind: 'all' } }), peer)).toBe(true);
    expect(canSeeView(view({ visibility: { kind: 'roles', roles: ['pm'] } }), peer)).toBe(true);
    expect(canSeeView(view({ visibility: { kind: 'roles', roles: ['architect'] } }), peer)).toBe(false);
  });

  it('агент видит виды своего владельца и только их', () => {
    const agent: S2Caller = { kind: 'agent', client_id: 'lore-agent-full', owner_kc_sub: 'sub-owner', roles: [] };
    const orphan: S2Caller = { kind: 'agent', client_id: 'x', owner_kc_sub: null, roles: [] };
    expect(canSeeView(view({}), agent)).toBe(true);
    expect(canSeeView(view({}), orphan)).toBe(false);
  });

  it('личный вид по умолчанию перекрывает командный; без личного — командный; без обоих — null', () => {
    const team = view({ view_id: 't', owner: null, is_team_default: true, visibility: { kind: 'all' } });
    const mine = view({ view_id: 'm', is_team_default: true });
    expect(effectiveDefaultView([team, mine], 'tasks', me)?.view_id).toBe('m');
    expect(effectiveDefaultView([team, mine], 'tasks', peer)?.view_id).toBe('t');
    expect(effectiveDefaultView([team], 'adrs', me)).toBeNull();
  });

  it('командный вид, невидимый по ролям, не становится чужим умолчанием', () => {
    const team = view({ view_id: 't', owner: null, is_team_default: true, visibility: { kind: 'roles', roles: ['architect'] } });
    expect(effectiveDefaultView([team], 'tasks', peer)).toBeNull();
  });
});

describe('S2-01 · настройки', () => {
  it('патч с неизвестным ключом или чужим значением — ошибка с перечнем, а не тихий отброс', () => {
    expect(validateSettingsPatch({ density: 'compact' })).toEqual([]);
    expect(validateSettingsPatch({ density: 'huge' } as never)).toEqual(['density']);
    expect(validateSettingsPatch({ colour: 'red' } as never)).toEqual(['colour']);
    expect(validateSettingsPatch({ single_key_shortcuts: 'yes' } as never)).toEqual(['single_key_shortcuts']);
  });

  it('mergeSettings: сохранённое поверх умолчаний, незнакомые ключи сервера отбрасываются (аддитивность)', () => {
    const merged = mergeSettings({ density: 'comfortable', future_key: 1 } as never);
    expect(merged.density).toBe('comfortable');
    expect(merged.text_size).toBe(DEFAULT_SETTINGS.text_size);
    expect('future_key' in merged).toBe(false);
  });

  it('все пункты S2-04 есть в настройках, включая флаг новой навигации', () => {
    expect(Object.keys(DEFAULT_SETTINGS).sort()).toEqual([
      'collapse_nav_on_read', 'density', 'graph_view', 'mode', 'nav_version', 'palette', 'peek_hover',
      'right_column', 'show_tech', 'single_key_shortcuts', 'stripes', 'text_scale', 'text_size',
    ]);
  });

  it('GC-03 · вид графа: auto по умолчанию, четыре вида, незнакомый — отказ', () => {
    expect(DEFAULT_SETTINGS.graph_view).toBe('auto');
    for (const v of ['auto', 'sectors', 'list', 'force', 'obsidian'] as const) expect(validateSettingsPatch({ graph_view: v })).toEqual([]);
    expect(validateSettingsPatch({ graph_view: 'canvas' as never })).toEqual(['graph_view']);
  });
});

describe('S2-01 · «что помнит»: доступ', () => {
  it('сам пользователь и его агенты — да; другой человек, даже admin, — нет', () => {
    expect(canReadMemory(me, 'sub-owner')).toBe(true);
    expect(canReadMemory({ kind: 'agent', client_id: 'a', owner_kc_sub: 'sub-owner', roles: [] }, 'sub-owner')).toBe(true);
    expect(canReadMemory({ kind: 'human', kc_sub: 'boss', roles: ['admin', 'superadmin'] }, 'sub-owner')).toBe(false);
    expect(canReadMemory({ kind: 'agent', client_id: 'a', owner_kc_sub: null, roles: [] }, 'sub-owner')).toBe(false);
    expect(canReadMemory({ kind: 'anonymous' }, 'sub-owner')).toBe(false);
  });

  it('виды памяти и срок хранения зафиксированы', () => {
    expect([...MEMORY_KINDS]).toEqual(['frequent_views', 'frequent_slices', 'recent_records']);
    expect(MEMORY_RETENTION_DAYS).toBe(90);
  });
});

describe('S2-01 · заглушки ведут себя по контракту', () => {
  it('backlinks: группы по типу ребра, без структурных, обрезка хаба помечена', async () => {
    const s = createS2Stub();
    const r = await s.backlinks({ type: 'adr', id: 'ADR-LORE-045' });
    expect(r.groups.length).toBeGreaterThan(0);
    for (const g of r.groups) expect(BACKLINK_EXCLUDED_EDGE_TYPES).not.toContain(g.edge_type);
    expect(r.excluded_edge_types).toEqual([...BACKLINK_EXCLUDED_EDGE_TYPES]);
    const hub = await s.backlinks({ type: 'adr', id: 'ADR-LORE-045', per_edge: 1 });
    expect(hub.groups.some(g => g.truncated && g.items.length === 1 && g.total > 1)).toBe(true);
    expect(hub.completeness).toBe('partial');
  });

  it('backlinks: нет связей ≠ вне скоупа ≠ нет записи', async () => {
    const s = createS2Stub();
    const none = await s.backlinks({ type: 'spec', id: 'SPEC-LONELY' });
    expect(none.groups).toEqual([]);
    expect(none.outside_scope).toBeNull();
    const out = await s.backlinks({ type: 'adr', id: 'ADR-VOLVA-001' });
    expect(out.outside_scope?.verdict).toBe('outside_scope');
    await expect(s.backlinks({ type: 'adr', id: 'ADR-NOPE-404' })).rejects.toMatchObject({ status: 404, body: { error: 'NOT_FOUND' } });
    await expect(s.backlinks({ type: 'bogus' as never, id: 'x' })).rejects.toMatchObject({ status: 400 });
  });

  it('history: новейшая первой, changed посчитан, тип без SCD2 — not_tracked, а не пусто', async () => {
    const s = createS2Stub();
    const h = await s.history({ type: 'task', id: 'SPRINT_UXR_S2_GRAPH_MEMORY/S2-01' });
    expect(h.tracking).toBe('scd2');
    expect(h.versions[0].is_open).toBe(true);
    expect(h.versions[0].changed).toContain('status_raw');
    expect(h.versions.some(x => x.author.kind === 'agent')).toBe(true);
    const q = await s.history({ type: 'question', id: 'Q-1' });
    expect(q.tracking).toBe('not_tracked');
    expect(q.versions).toEqual([]);
  });

  it('виды: правка по устаревшей версии — 409 с текущим состоянием', async () => {
    const s = createS2Stub();
    const created = await s.createView({ name: 'Блокеры', section: 'tasks', query: 'status=blocked', visibility: { kind: 'me' } });
    expect(created.version).toBe(1);
    const updated = await s.updateView(created.view_id, { name: 'Блокеры!', expected_version: 1 });
    expect(updated.version).toBe(2);
    const stale = s.updateView(created.view_id, { name: 'гонка', expected_version: 1 });
    await expect(stale).rejects.toBeInstanceOf(S2ConflictError);
    await expect(stale).rejects.toMatchObject({ status: 409, body: { error: 'CONFLICT', current: { name: 'Блокеры!', version: 2 } } });
    await s.deleteView(created.view_id, 2);
    expect((await s.listViews()).items.find(x => x.view_id === created.view_id)).toBeUndefined();
  });

  it('командный вид по умолчанию без права admin — 403', async () => {
    const s = createS2Stub({ caller: peer });
    await expect(s.createView({ name: 'Команда', section: 'tasks', query: '', visibility: { kind: 'all' }, is_team_default: true }))
      .rejects.toMatchObject({ status: 403, body: { error: 'FORBIDDEN' } });
  });

  it('избранное идемпотентно', async () => {
    const s = createS2Stub();
    await s.addFavorite('adr', 'ADR-LORE-045');
    await s.addFavorite('adr', 'ADR-LORE-045');
    expect((await s.listFavorites()).items.filter(f => f.id === 'ADR-LORE-045')).toHaveLength(1);
    await s.removeFavorite('adr', 'ADR-LORE-045');
    expect((await s.listFavorites()).items.some(f => f.id === 'ADR-LORE-045')).toBe(false);
  });

  it('настройки: патч с версией, 409 на устаревшей, 400 на неизвестном ключе', async () => {
    const s = createS2Stub();
    const got = await s.getSettings();
    const next = await s.patchSettings({ patch: { density: 'comfortable' }, expected_version: got.version });
    expect(next.settings.density).toBe('comfortable');
    await expect(s.patchSettings({ patch: { stripes: false }, expected_version: got.version })).rejects.toMatchObject({ status: 409 });
    await expect(s.patchSettings({ patch: { colour: 'red' } as never, expected_version: next.version }))
      .rejects.toMatchObject({ status: 400, body: { error: 'BAD_PARAMS' } });
  });

  it('память: «не запоминать» — недавние честно говорят remembering:false, запись не принимается', async () => {
    const s = createS2Stub();
    expect((await s.recordRecent('adr', 'ADR-LORE-045')).recorded).toBe(true);
    expect((await s.recent()).items.length).toBeGreaterThan(0);
    await s.setRemembering({ remembering: false, purge: true });
    const r = await s.recent();
    expect(r.remembering).toBe(false);
    expect(r.items).toEqual([]);
    expect(await s.recordRecent('adr', 'ADR-LORE-038')).toEqual({ recorded: false, reason: 'not_remembering' });
    const m = await s.memory();
    expect(m.remembering).toBe(false);
    expect(m.access).toBe('self_and_own_agents');
  });

  it('память: стереть одну, по виду, всё', async () => {
    const s = createS2Stub();
    const m = await s.memory();
    const total = m.categories.reduce((n, c) => n + c.items.length, 0);
    expect(total).toBeGreaterThan(2);
    const first = m.categories.find(c => c.items.length > 0)!.items[0];
    await s.forget(first.memory_id);
    expect((await s.forgetAll('frequent_slices')).deleted).toBeGreaterThan(0);
    expect((await s.forgetAll()).deleted).toBeGreaterThan(0);
    expect((await s.memory()).categories.every(c => c.items.length === 0)).toBe(true);
  });

  it('память чужого — 403 даже администратору (заглушка повторяет правило сервера)', async () => {
    const s = createS2Stub({ caller: { kind: 'human', kc_sub: 'boss', roles: ['admin'] }, memoryOwner: 'sub-owner' });
    await expect(s.memory()).rejects.toBeInstanceOf(S2HttpError);
    await expect(s.memory()).rejects.toMatchObject({ status: 403 });
  });
});
