// @vitest-environment jsdom
// Данные карточки Peek для LORE (SPRINT_UXR_S10_SEIDR_KIT_2/S9-10, D-2026-LORE-PEEK-ONE-CARD):
// запись фасада lore.record → карточка: 2–3 свойства по типу (только те, что есть в схеме), один
// раздел тела (первый непустой), до трёх счётчиков связей, адрес паспорта; «записи нет» и «нет прав»
// — свои состояния, а не общий сбой.
import { describe, expect, it, vi } from 'vitest';
import { toPeekCard, loadPeek } from './lorePeek';
import type { LoreRecord1 } from './loreRecordContract';

const rec = (over: Partial<LoreRecord1> = {}): LoreRecord1 => ({
  contract: 'lore.record/1',
  record: { type: 'adr', id: 'ADR-1', title: 'Ссылка на объект', status: 'ACCEPTED', version: null, updated_at: null, updated_by: null },
  schema: {
    type: 'adr', label: 'ADR', icon: 'scroll-quill',
    fields: [
      { key: 'components', label: 'Компоненты', kind: 'ref', required: false, editable: false, multi: true, group: 'props' },
      { key: 'date', label: 'Дата', kind: 'date', required: false, editable: false, group: 'props' },
      { key: 'tags', label: 'Теги', kind: 'text', required: false, editable: false, multi: true, group: 'props' },
      { key: 'context_md', label: 'Контекст', kind: 'md', required: false, editable: true, group: 'body' },
      { key: 'decision_md', label: 'Решение', kind: 'md', required: false, editable: true, group: 'body' },
    ] as LoreRecord1['schema']['fields'],
    tabs: [],
    relations: [
      { key: 'decisions', label: 'Решения', relation: 'composition', rel: 'DECIDED_IN', dir: 'in', count: 6, place: 'link_tab' },
      { key: 'tasks', label: 'Задачи', relation: 'attribute', rel: 'JUSTIFIED_BY', dir: 'in', count: 2, place: 'link_tab' },
      { key: 'components', label: 'Компоненты', relation: 'attribute', rel: 'TAGGED_WITH', dir: 'out', count: 2, place: 'prop' },
      { key: 'specs', label: 'Спеки', relation: 'attribute', rel: 'X', dir: 'in', count: 0, place: 'link_tab' },
    ] as LoreRecord1['schema']['relations'],
  },
  values: { components: ['OMILORE', 'FORSETI'], date: '2026-11-10', tags: [], context_md: '', decision_md: 'Первый.\n\nВторой.\n\nТретий.\n\nЧетвёртый.' },
  links: [], facts: null,
  perms: { can_edit: false, can_status: false, can_create: false, status_next: [], reason: null },
  meta: { loaded_at: '2026-11-11T00:00:00Z', facade: 'server', sources: [] },
  ...over,
});

describe('toPeekCard', () => {
  it('шапка: вид из схемы, ID, название; статус есть', () => {
    const c = toPeekCard(rec(), 'ru');
    expect([c.kind, c.id, c.title]).toEqual(['ADR', 'ADR-1', 'Ссылка на объект']);
    expect(c.status).toBeTruthy();
  });
  it('свойства по типу: компоненты через «·», дата; пустой массив — «не задано» (null)', () => {
    const c = toPeekCard(rec({ values: { ...rec().values, components: [] } }), 'ru');
    expect(c.props.map(p => p.label)).toEqual(['Компоненты', 'Дата']);
    expect(c.props[0].value).toBeNull();
    expect(toPeekCard(rec(), 'ru').props[0].value).toBe('OMILORE · FORSETI');
  });
  it('раздел тела — первый НЕПУСТОЙ по порядку схемы, абзацы по пустой строке', () => {
    const c = toPeekCard(rec(), 'ru');
    expect(c.section?.title).toBe('Решение');
    expect(c.section?.paras.slice(0, 2)).toEqual(['Первый.', 'Второй.']);
  });
  it('тела нет вовсе — section null («текста нет»)', () => {
    expect(toPeekCard(rec({ values: { ...rec().values, decision_md: null } }), 'ru').section).toBeNull();
  });
  it('счётчики — связи-вкладки с числом > 0; свойства (place=prop) не считаются', () => {
    expect(toPeekCard(rec(), 'ru').counters).toEqual([{ label: 'Решения', n: 6 }, { label: 'Задачи', n: 2 }]);
  });
  it('нет статуса — нет пилюли', () => {
    expect(toPeekCard(rec({ record: { ...rec().record, status: '' } }), 'ru').status).toBeUndefined();
  });
  it('адрес паспорта — по типу записи', () => {
    expect(toPeekCard(rec(), 'ru').href).toContain('open=ADR-1');
  });
  it('у типа нет ни одного свойства из списка — первые два заполненных из «Свойств»', () => {
    const r = rec({ record: { ...rec().record, type: 'weird' }, schema: { ...rec().schema, type: 'weird' } });
    expect(toPeekCard(r, 'ru').props.map(p => p.label)).toEqual(['Компоненты', 'Дата']);
  });
});

describe('loadPeek — состояния', () => {
  const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { 'content-type': 'application/json' } });
  it('запись есть — ok', async () => {
    const st = await loadPeek({ id: 'ADR-1', type: 'adr' }, 'ru', { fetchImpl: vi.fn(async () => json(rec())) as unknown as typeof fetch });
    expect(st.state).toBe('ok');
  });
  it('404 — «записи нет», а не сбой', async () => {
    const st = await loadPeek({ id: 'ADR-9', type: 'adr' }, 'ru', { fetchImpl: vi.fn(async () => json({ error: 'NOT_FOUND' }, 404)) as unknown as typeof fetch });
    expect(st.state).toBe('missing');
  });
  it('403 — «нет прав»', async () => {
    const st = await loadPeek({ id: 'ADR-1', type: 'adr' }, 'ru', { fetchImpl: vi.fn(async () => json({ error: 'FORBIDDEN' }, 403)) as unknown as typeof fetch });
    expect(st.state).toBe('forbidden');
  });
  it('сеть упала — сбой с причиной', async () => {
    const st = await loadPeek({ id: 'ADR-1', type: 'adr' }, 'ru', { fetchImpl: vi.fn(async () => { throw new Error('offline'); }) as unknown as typeof fetch });
    expect(st).toMatchObject({ state: 'error' });
    expect((st as { reason: string }).reason).toMatch(/offline/);
  });
  it('тип не задан и по форме ID не узнан — сказано, а не запрос наугад', async () => {
    const f = vi.fn();
    const st = await loadPeek({ id: 'UTF-8', type: null }, 'ru', { fetchImpl: f as unknown as typeof fetch });
    expect(st.state).toBe('error');
    expect(f).not.toHaveBeenCalled();
  });
});
