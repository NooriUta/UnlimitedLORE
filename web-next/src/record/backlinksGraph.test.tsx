// @vitest-environment jsdom
// SPRINT_UXR_S5_RECORD_TASKS/S5-10 · локальный граф паспорта на обратных связях
// S2 (контракт GET /lore/backlinks, SPEC-LORE-UXR-S2-CONTRACTS): словарь типов
// рёбер LORE с подписями ru/en и слоем структурных связей; сбор графа глубины
// 1–3 обходом backlinks; честные состояния (вне скоупа, ошибка, обрезка).
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';
import gameIcons from '@iconify-json/game-icons/icons.json';
import { RecordView, registerGameIcons, type KitConfig, type KitCtx } from '@seidr/kit';
import {
  LORE_EDGE_TYPES, LORE_STRUCTURAL_EDGES, loreEdgesConfig, loreEdgeLabel,
} from './loreEdges';
import {
  createBacklinksStub, fetchBacklinksHttp, loadBacklinksGraph,
  type BacklinksFetcher, type BacklinksResponse,
} from './backlinksGraph';

beforeAll(() => registerGameIcons(gameIcons));
afterEach(() => window.history.replaceState(null, '', '/'));

/** Все типы рёбер, которые ставит «Связать» S2-06 (LoreLinkTypes.PAIRS) и структурные. */
const SCHEMA_EDGES = [
  'REFERENCES', 'REFERENCES_ADR', 'DECIDED_IN', 'IMPLEMENTED_IN', 'IMPLEMENTED_IN_RELEASE', 'DEPENDS_ON',
  'JUSTIFIED_BY', 'REALIZES', 'RAISED_IN', 'ANSWERS', 'SUPERSEDES', 'GATES', 'BLOCKS', 'TRACED_TO',
  'UC_INCLUDES', 'UC_EXTENDS', 'BUILDS_ON', 'HAS_ACTOR', 'RELIEVES', 'PROMISES', 'PERFORMS', 'HELPS_WITH',
  'DELIVERS', 'ADDRESSES', 'FELT_BY', 'PERFORMED_BY', 'SUCCESS_OF', 'DESIRED_BY',
  'HAS_STATE', 'BELONGS_TO_PROJECT', 'PART_OF', 'IN_PHASE', 'BELONGS_TO', 'TAGGED_WITH', 'DOC_CHILD_OF',
];

describe('S5-10 · словарь типов рёбер LORE', () => {
  it('каждый тип схемы подписан словами на ru и en, цвет — токен', () => {
    for (const t of SCHEMA_EDGES) {
      const e = LORE_EDGE_TYPES[t];
      expect(e, t).toBeTruthy();
      expect(e.ru.trim(), t).not.toBe('');
      expect(e.en.trim(), t).not.toBe('');
      expect(e.ru, t).not.toBe(t);
      expect(e.color, t).toMatch(/^--(acc|suc|wrn|dng|inf|t2|t3)$/);
    }
  });

  it('русская подпись — по-русски (кириллица), английская — латиницей', () => {
    for (const [t, e] of Object.entries(LORE_EDGE_TYPES)) {
      expect(e.ru, t).toMatch(/[а-яё]/i);
      expect(e.en, t).not.toMatch(/[а-яё]/i);
    }
  });

  it('структурный слой — принадлежность и иерархия (как в S2: LoreLinkTypes, BACKLINK_EXCLUDED_EDGE_TYPES)', () => {
    expect([...LORE_STRUCTURAL_EDGES].sort()).toEqual(
      ['BELONGS_TO', 'BELONGS_TO_PROJECT', 'DOC_CHILD_OF', 'HAS_STATE', 'IN_PHASE', 'PART_OF', 'TAGGED_WITH'],
    );
  });

  it('config.edges для kit: подпись по языку, слой structural; неизвестный тип — код', () => {
    const ru = loreEdgesConfig('ru');
    expect(ru.DECIDED_IN).toEqual({ label: 'решено в', color: '--acc' });
    expect(ru.PART_OF.layer).toBe('structural');
    expect(loreEdgesConfig('en').DECIDED_IN.label).toBe('decided in');
    expect(loreEdgeLabel('ru', 'SOMETHING_NEW')).toBe('SOMETHING_NEW');
  });
});

// ── Заглушка по контракту S2 ──────────────────────────────────────────────

const ADR = { type: 'adr', id: 'ADR-LORE-045', title: 'UI v2 отдельным приложением' };
const resp = (target: { type: string; id: string; title: string | null }, groups: BacklinksResponse['groups'], over: Partial<BacklinksResponse> = {}): BacklinksResponse => ({
  target, groups, total: groups.reduce((n, g) => n + g.total, 0), excluded_edge_types: ['HAS_STATE', 'BELONGS_TO_PROJECT'],
  scope: null, outside_scope: null, completeness: 'complete', warnings: [], ...over,
});
const item = (type: string, id: string, title: string, status = 'done') =>
  ({ type, id, title, status, status_category: 'finished' as const, linked_at: null });

const FIXTURES: Record<string, BacklinksResponse> = {
  'adr:ADR-LORE-045': resp(ADR, [
    { edge_type: 'REFERENCES_ADR', direction: 'in', total: 2, truncated: false, items: [
      item('task', 'SPRINT_UXR_S3_V2_INFRA/S3-01', 'Каталог web-next'),
      item('spec', 'SPEC-LORE-UXR-S1-CONTRACTS', 'Контракты S1', 'accepted'),
    ] },
    { edge_type: 'DECIDED_IN', direction: 'in', total: 1, truncated: false, items: [
      item('decision', 'D-2026-UXR-V2-FOLDER-V1-FROZEN', 'Код v1 заморожен', 'accepted'),
    ] },
  ]),
  'task:SPRINT_UXR_S3_V2_INFRA/S3-01': resp({ type: 'task', id: 'SPRINT_UXR_S3_V2_INFRA/S3-01', title: 'Каталог web-next' }, [
    { edge_type: 'REFERENCES', direction: 'in', total: 1, truncated: false, items: [item('doc', 'DOC-1', 'Заметка')] },
  ]),
  'doc:DOC-1': resp({ type: 'doc', id: 'DOC-1', title: 'Заметка' }, [
    { edge_type: 'REFERENCES', direction: 'in', total: 1, truncated: false, items: [item('task', 'T-DEEP', 'Глубоко')] },
  ]),
};

describe('S5-10 · сбор графа из backlinks', () => {
  it('глубина 1: ребро от ссылающейся записи к цели, записи с названием и статусом', async () => {
    const d = await loadBacklinksGraph(createBacklinksStub(FIXTURES), ADR, { depth: 1 });
    expect(d.edges).toEqual([
      { from: 'D-2026-UXR-V2-FOLDER-V1-FROZEN', to: 'ADR-LORE-045', type: 'DECIDED_IN' },
      { from: 'SPEC-LORE-UXR-S1-CONTRACTS', to: 'ADR-LORE-045', type: 'REFERENCES_ADR' },
      { from: 'SPRINT_UXR_S3_V2_INFRA/S3-01', to: 'ADR-LORE-045', type: 'REFERENCES_ADR' },
    ]);
    const task = d.records.find(r => r.id === 'SPRINT_UXR_S3_V2_INFRA/S3-01');
    expect(task).toMatchObject({ kind: 'task', title: 'Каталог web-next', status: 'done' });
    expect(d.records.find(r => r.id === 'ADR-LORE-045')?.title).toBe('UI v2 отдельным приложением');
    expect(d.meta.truncated).toBe(false);
    expect(d.meta.errors).toBeUndefined();
  });

  it('глубина 2 и 3 — обход соседей, каждая запись спрашивается один раз', async () => {
    const stub = createBacklinksStub(FIXTURES);
    const spy = vi.fn(stub);
    const d2 = await loadBacklinksGraph(spy, ADR, { depth: 2 });
    expect(d2.edges.some(e => e.from === 'DOC-1')).toBe(true);
    expect(d2.edges.some(e => e.from === 'T-DEEP')).toBe(false);
    const asked = spy.mock.calls.map(c => `${c[0].type}:${c[0].id}`);
    expect(new Set(asked).size).toBe(asked.length);
    const d3 = await loadBacklinksGraph(stub, ADR, { depth: 3 });
    expect(d3.edges.some(e => e.from === 'T-DEEP')).toBe(true);
  });

  it('потолок вызовов — граф обрезан и это сказано (meta.truncated)', async () => {
    const d = await loadBacklinksGraph(createBacklinksStub(FIXTURES), ADR, { depth: 3, maxCalls: 1 });
    expect(d.meta.truncated).toBe(true);
    expect(d.edges).toHaveLength(3);
  });

  it('группа обрезана per_edge или completeness=partial — meta.truncated', async () => {
    const fx = { 'adr:ADR-LORE-045': resp(ADR, [{ ...FIXTURES['adr:ADR-LORE-045'].groups[0], truncated: true }], { completeness: 'partial' }) };
    const d = await loadBacklinksGraph(createBacklinksStub(fx), ADR, { depth: 1 });
    expect(d.meta.truncated).toBe(true);
  });

  it('цель вне скоупа — ошибка блока рёбер, а не «связей нет»', async () => {
    const fx = { 'adr:ADR-LORE-045': resp(ADR, [], { outside_scope: { id: 'ADR-LORE-045', verdict: 'outside_scope', reason: 'нет доступа к проекту' } }) };
    const d = await loadBacklinksGraph(createBacklinksStub(fx), ADR, { depth: 1 });
    expect(d.meta.errors).toEqual([{ block: 'edges', reason: 'outside_scope: нет доступа к проекту' }]);
  });

  it('эндпоинт упал на цели — ошибка блока рёбер', async () => {
    const failing: BacklinksFetcher = () => Promise.reject(new Error('503 LORE_DISABLED'));
    const d = await loadBacklinksGraph(failing, ADR, { depth: 2 });
    expect(d.meta.errors).toEqual([{ block: 'edges', reason: '503 LORE_DISABLED' }]);
    expect(d.edges).toEqual([]);
  });

  it('упал сосед глубже — первый круг остаётся, граф помечен обрезанным', async () => {
    const stub = createBacklinksStub(FIXTURES);
    const flaky: BacklinksFetcher = q => (q.id === 'ADR-LORE-045' ? stub(q) : Promise.reject(new Error('timeout')));
    const d = await loadBacklinksGraph(flaky, ADR, { depth: 2 });
    expect(d.edges).toHaveLength(3);
    expect(d.meta.truncated).toBe(true);
    expect(d.meta.errors?.[0]).toMatchObject({ block: 'graph' });
  });

  it('тип записи не из веток backlinks — её соседей не спрашиваем (не 400 BAD_PARAMS)', async () => {
    const fx = { 'adr:ADR-LORE-045': resp(ADR, [{ edge_type: 'REFERENCES', direction: 'in', total: 1, truncated: false, items: [item('component', 'CMP-1', 'Компонент')] }]) };
    const spy = vi.fn(createBacklinksStub(fx));
    await loadBacklinksGraph(spy, ADR, { depth: 2 });
    expect(spy.mock.calls.map(c => c[0].type)).toEqual(['adr']);
  });
});

/**
 * Ответ GET /lore/backlinks В ФОРМЕ СЕРВЕРА (LoreSearchResource.backlinks, сверено
 * по коду 11.11.2026): edge/count/ref_id/complete/excluded_edges, все связи
 * входящие, поля direction нет. Прежний тест гонял заглушечную форму S2 насквозь,
 * поэтому не видел, что на живом сервере у узлов коды undefined (дефект P0 S5-10).
 */
const SERVER_BODY = {
  type: 'adr', id: 'ADR-LORE-045', title: 'UI LORE v2', total: 3,
  groups: [
    { edge: 'JUSTIFIED_BY', count: 2, truncated: false, items: [
      { type: 'task', ref_id: 'SPRINT_X/T-1', title: 'Задача один', source_class: 'KnowTask' },
      { type: 'task', ref_id: 'SPRINT_X/T-2', title: null, source_class: 'KnowTask' },
    ] },
    { edge: 'DECIDED_IN', count: 1, truncated: false, items: [
      { type: 'decision', ref_id: 'D-2026-1', title: 'Решение', source_class: 'KnowDecision' },
    ] },
  ],
  by_edge: { JUSTIFIED_BY: 2, DECIDED_IN: 1 }, hidden_by_scope: 0,
  excluded_edges: ['BELONGS_TO_PROJECT', 'HAS_STATE'], limit: 20, complete: true,
};
const serverFetch = (body: unknown, status = 200) =>
  vi.fn(async (_url: string, _init?: RequestInit) => new Response(JSON.stringify(body), { status }));

describe('S5-10 · HTTP по контракту GET /lore/backlinks', () => {
  it('запрос — type/id/limit (сервер знает только limit, per_edge он молча игнорировал); не-2xx — ошибка с кодом', async () => {
    const fetchFn = serverFetch(SERVER_BODY);
    await fetchBacklinksHttp(fetchFn)({ type: 'task', id: 'S/T-1', per_edge: 20 });
    expect(fetchFn.mock.calls[0][0]).toBe('/lore/backlinks?type=task&id=S%2FT-1&limit=20');
    const bad = vi.fn(async () => new Response(JSON.stringify({ error: 'NOT_FOUND' }), { status: 404 }));
    await expect(fetchBacklinksHttp(bad)({ type: 'adr', id: 'X' })).rejects.toThrow(/404 NOT_FOUND/);
  });

  it('ответ в форме сервера переводится: edge→edge_type, count→total, ref_id→id, все связи входящие', async () => {
    const got = await fetchBacklinksHttp(serverFetch(SERVER_BODY))({ type: 'adr', id: 'ADR-LORE-045' });
    expect(got.target).toEqual({ type: 'adr', id: 'ADR-LORE-045', title: 'UI LORE v2' });
    expect(got.groups.map(g => [g.edge_type, g.direction, g.total])).toEqual([['JUSTIFIED_BY', 'in', 2], ['DECIDED_IN', 'in', 1]]);
    expect(got.groups[0].items.map(i => i.id)).toEqual(['SPRINT_X/T-1', 'SPRINT_X/T-2']);
    expect(got.completeness).toBe('complete');
    expect(got.excluded_edge_types).toEqual(['BELONGS_TO_PROJECT', 'HAS_STATE']);
  });

  it('граф на живом ответе: у узлов настоящие коды, а не undefined; рёбра от ссылающихся к цели', async () => {
    const data = await loadBacklinksGraph(fetchBacklinksHttp(serverFetch(SERVER_BODY)), { type: 'adr', id: 'ADR-LORE-045' }, { depth: 1 });
    const ids = data.records.map(r => r.id);
    expect(ids).not.toContain(undefined);
    expect(ids.sort()).toEqual(['ADR-LORE-045', 'D-2026-1', 'SPRINT_X/T-1', 'SPRINT_X/T-2']);
    expect(data.edges).toContainEqual({ from: 'SPRINT_X/T-1', to: 'ADR-LORE-045', type: 'JUSTIFIED_BY' });
    expect(data.edges.every(e => e.type && e.from && e.to)).toBe(true);
    expect(data.meta?.truncated).toBe(false);
  });

  it('complete:false, скрытые скоупом или источник без кода — граф помечен неполным, а не «всё показано»', async () => {
    const partial = { ...SERVER_BODY, complete: false };
    const a = await fetchBacklinksHttp(serverFetch(partial))({ type: 'adr', id: 'ADR-LORE-045' });
    expect(a.completeness).toBe('partial');
    const hidden = { ...SERVER_BODY, hidden_by_scope: 2 };
    expect((await fetchBacklinksHttp(serverFetch(hidden))({ type: 'adr', id: 'ADR-LORE-045' })).completeness).toBe('partial');
    const nocode = { ...SERVER_BODY, groups: [{ edge: 'REFERENCES', count: 1, truncated: false, items: [{ type: null, ref_id: null, title: null, source_class: 'Mystery' }] }] };
    const c = await fetchBacklinksHttp(serverFetch(nocode))({ type: 'adr', id: 'ADR-LORE-045' });
    expect(c.groups[0].items).toEqual([]);
    expect(c.completeness).toBe('partial');
  });
});

describe('S5-10 · вкладка «Граф» kit на данных backlinks', () => {
  it('русские подписи рёбер в графе и в фильтре', async () => {
    const data = await loadBacklinksGraph(createBacklinksStub(FIXTURES), ADR, { depth: 1 });
    const config: KitConfig = {
      modules: [], menu: { groups: [] }, kinds: {},
      edges: loreEdgesConfig('ru'),
      graph: { depth: 1, limit: 60, colorBy: 'type' },
      statuses: { items: [{ code: 'done', title: 'готово', category: 'done', icon: 'check-mark', color: '--suc' }] },
    };
    const ctx: KitCtx = { data, config, href: id => `?passport=${encodeURIComponent(id)}`, esc: s => s, md: s => s };
    const rec = data.records.find(r => r.id === 'ADR-LORE-045')!;
    render(<RecordView record={rec} ctx={ctx} tab="graph" onTab={() => {}} />);
    const legend = document.querySelector('[data-testid="kit-graph-legend"]')!.textContent ?? '';
    expect(legend).toContain('решено в');
    expect(legend).toContain('ссылается на ADR');
    const labels = [...document.querySelectorAll('.sk-rec-graph__edge-label')].map(t => t.textContent);
    expect(labels).toContain('решено в');
  });
});
