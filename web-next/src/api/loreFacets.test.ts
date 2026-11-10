// @vitest-environment jsdom
// SPRINT_UXR_S9_SCALE_OPT/S9-01, клиентская половина — чтение счётчиков с сервера.
//
// GET /lore/slice/{id}/facets считает оси по ВСЕЙ выдаче, а не по странице.
// Поэтому у ответа столько же разных смыслов, сколько у него кодов, и свести их
// к одному «пусто» нельзя:
//   • ось в `facets` — посчитана;
//   • ось в `unavailable` — НЕ посчитана (это не ноль);
//   • 400 NOT_FACETABLE — счётчиков у раздела не бывает (тоже не ноль);
//   • 403 SCOPE_EMPTY — нет разрешённых проектов (не «ничего не найдено»);
//   • 400 BAD_PARAMS, 5xx, не-JSON — сбой с причиной.
//
// И отдельно: Σcount по оси бывает больше `total` — одна запись лежит в
// нескольких компонентах. Это норма, и читатель помечает такую ось, чтобы
// список не выглядел как ошибка счёта.
import { describe, expect, it, vi } from 'vitest';
import { LORE_FACET_AXES, axesForKeys, fetchFacets } from './loreFacets';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const ok = (facets: Record<string, unknown>, extra: Record<string, unknown> = {}) =>
  json({ section: 'sprints', axes: Object.keys(facets), facets, completeness: 'complete', cap: null, ...extra });

const axes = { sprint_id: 'fields.sprint', components: 'fields.components' };

describe('S9-01 · счётчики с сервера: разбор ответа', () => {
  it('положительный контроль: адрес, оси и числа', async () => {
    let seen = '';
    const f = vi.fn(async (u: RequestInfo | URL) => {
      seen = String(u);
      return ok({ sprint_id: { values: [{ value: 'S1', count: 240 }, { value: 'S2', count: 150 }], empty: 10, nonempty: 390, total: 400 } });
    });
    const counts = await fetchFacets('all_tasks', { axes, params: { q: 'дыры' }, scopeProjects: ['AIDA/UnlimitedLORE'], fetchImpl: f as unknown as typeof fetch });
    expect(seen).toContain('/lore/slice/all_tasks/facets');
    expect(seen).toContain('axes=sprint_id%2Ccomponents');
    expect(seen).toContain('q=%D0%B4%D1%8B%D1%80%D1%8B');
    expect(seen).toContain('scope_projects=AIDA%2FUnlimitedLORE');
    expect(counts.kind).toBe('counted');
    if (counts.kind !== 'counted') return;
    // Ключ — фасета kit, а не столбца среза: в списке ось зовут иначе.
    expect(counts.axes['fields.sprint'].values).toEqual([{ value: 'S1', count: 240 }, { value: 'S2', count: 150 }]);
    expect(counts.axes['fields.sprint'].total).toBe(400);
    expect(counts.axes['fields.sprint'].empty).toBe(10);
    expect(counts.axes['fields.sprint'].multi).toBeUndefined();
    expect(counts.completeness).toBe('complete');
  });

  it('ось в unavailable — «не посчитана» с причиной, а не ноль', async () => {
    const f = vi.fn(async () => ok({}, { unavailable: { components: 'разрез по компонентам не считается' } }));
    const counts = await fetchFacets('all_tasks', { axes, fetchImpl: f as unknown as typeof fetch });
    if (counts.kind !== 'counted') throw new Error(`ожидался counted, пришло ${counts.kind}`);
    expect(counts.axes['fields.components']).toBeUndefined();
    expect(counts.unavailable?.['fields.components']).toBe('разрез по компонентам не считается');
  });

  it('Σcount больше итога — ось многозначная, а не сбойная', async () => {
    const f = vi.fn(async () => ok({ components: { values: [{ value: 'LORE', count: 300 }, { value: 'FORSETI', count: 250 }], empty: 0, nonempty: 400, total: 400 } }));
    const counts = await fetchFacets('all_tasks', { axes, fetchImpl: f as unknown as typeof fetch });
    if (counts.kind !== 'counted') throw new Error('ожидался counted');
    expect(counts.axes['fields.components'].multi).toBe(true);
  });

  it('ось без итога — «не посчитана», итог не выдумывается', async () => {
    const f = vi.fn(async () => ok({ sprint_id: { values: [{ value: 'S1', count: 5 }], empty: 0, nonempty: 5 } }));
    const counts = await fetchFacets('all_tasks', { axes, fetchImpl: f as unknown as typeof fetch });
    if (counts.kind !== 'counted') throw new Error('ожидался counted');
    expect(counts.axes['fields.sprint']).toBeUndefined();
    expect(counts.unavailable?.['fields.sprint']).toMatch(/итог/);
  });

  it('partial и cap читаются: «посчитано не целиком» и чем обрезано', async () => {
    const f = vi.fn(async () => ok({}, { completeness: 'partial', cap: { parts: ['totals', 'sprint_id'], limit: 5000 } }));
    const counts = await fetchFacets('all_tasks', { axes, fetchImpl: f as unknown as typeof fetch });
    if (counts.kind !== 'counted') throw new Error('ожидался counted');
    expect(counts.completeness).toBe('partial');
    expect(counts.cap).toEqual({ parts: ['totals', 'sprint_id'], limit: 5000 });
  });

  it('неизвестная полнота не выдаётся за полную', async () => {
    const f = vi.fn(async () => json({ facets: {} }));
    const counts = await fetchFacets('all_tasks', { axes, fetchImpl: f as unknown as typeof fetch });
    if (counts.kind !== 'counted') throw new Error('ожидался counted');
    expect(counts.completeness).toBe('unknown');
  });

  it('оси, которой не просили, в ответе не бывает — чужие ключи не выдумываем', async () => {
    const f = vi.fn(async () => ok({ who_knows: { values: [{ value: 'x', count: 1 }], empty: 0, nonempty: 1, total: 1 } }));
    const counts = await fetchFacets('all_tasks', { axes, fetchImpl: f as unknown as typeof fetch });
    if (counts.kind !== 'counted') throw new Error('ожидался counted');
    expect(Object.keys(counts.axes)).toEqual([]);
  });
});

describe('S9-01 · отказы сервера: четыре разных ответа, ни один не ноль', () => {
  it('400 NOT_FACETABLE — счётчиков у раздела не бывает', async () => {
    const f = vi.fn(async () => json({ error: 'NOT_FACETABLE', detail: 'срез docs не фасетится' }, 400));
    expect(await fetchFacets('docs', { axes, fetchImpl: f as unknown as typeof fetch })).toEqual({ kind: 'unsupported' });
  });

  it('403 SCOPE_EMPTY — нет разрешённых проектов', async () => {
    const f = vi.fn(async () => json({ error: 'SCOPE_EMPTY', detail: 'нет разрешённых проектов' }, 403));
    const c = await fetchFacets('all_tasks', { axes, fetchImpl: f as unknown as typeof fetch });
    expect(c.kind).toBe('forbidden');
    expect(c.kind === 'forbidden' && c.reason).toBe('нет разрешённых проектов');
  });

  it('400 BAD_PARAMS (неизвестная ось) — сбой с причиной, а не «нет значений»', async () => {
    const f = vi.fn(async () => json({ error: 'BAD_PARAMS', detail: 'ось release_ids неизвестна' }, 400));
    const c = await fetchFacets('all_tasks', { axes, fetchImpl: f as unknown as typeof fetch });
    expect(c.kind).toBe('failed');
    expect(c.kind === 'failed' && c.reason).toMatch(/release_ids/);
  });

  it('не-JSON (прокси вместо ответа) — сбой, а не пустые счётчики', async () => {
    const f = vi.fn(async () => new Response('<html>502</html>', { status: 502 }));
    const c = await fetchFacets('all_tasks', { axes, fetchImpl: f as unknown as typeof fetch });
    expect(c.kind).toBe('failed');
    expect(c.kind === 'failed' && c.reason).toMatch(/502/);
  });

  it('200 с не-JSON телом — тоже сбой: «пусто» так не выглядит', async () => {
    const f = vi.fn(async () => new Response('<html>ok</html>', { status: 200, headers: { 'content-type': 'text/html' } }));
    expect((await fetchFacets('all_tasks', { axes, fetchImpl: f as unknown as typeof fetch })).kind).toBe('failed');
  });

  it('сеть упала — сбой с причиной, а не тишина', async () => {
    const f = vi.fn(async () => { throw new Error('network down'); });
    const c = await fetchFacets('all_tasks', { axes, fetchImpl: f as unknown as typeof fetch });
    expect(c.kind === 'failed' && c.reason).toMatch(/network down/);
  });

  it('запрос отменён — это не «сбой счёта»: отмена пробрасывается', async () => {
    const ctl = new AbortController();
    ctl.abort();
    const f = vi.fn(async () => { throw new DOMException('aborted', 'AbortError'); });
    await expect(fetchFacets('all_tasks', { axes, signal: ctl.signal, fetchImpl: f as unknown as typeof fetch })).rejects.toThrow();
  });
});

describe('S9-01 · карта осей LORE', () => {
  it('положительный контроль: оси ведут на ключи фасетов, которыми список и пользуется', () => {
    expect(Object.values(LORE_FACET_AXES).every(k => k.startsWith('fields.'))).toBe(true);
    expect(Object.values(LORE_FACET_AXES)).toContain('fields.components');
  });

  it('статусной оси в карте НЕТ: категория сервера и код словаря — разные значения', () => {
    expect(Object.values(LORE_FACET_AXES)).not.toContain('status');
    expect(Object.keys(LORE_FACET_AXES)).not.toContain('status_category');
  });

  it('просим только оси этого списка: лишняя ось — 400 на весь запрос', () => {
    expect(axesForKeys(['status', 'fields.components', 'fields.sprint'])).toEqual({
      components: 'fields.components', sprint_id: 'fields.sprint',
    });
  });

  it('фасетов, которых сервер не считает, в запросе нет — и это не «ноль», а счёт по странице', () => {
    expect(axesForKeys(['status', 'fields.owner'])).toEqual({});
  });
});
