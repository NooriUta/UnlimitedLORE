// SPRINT_UXR_S4_UI_SHELL_LISTS/S4-08 — модель сохранённых видов списка:
// вид = строка запроса (фильтры, группировка, порядок) + имя + раздел +
// видимость (D-2026-UXR-VIEWS-SERVER). «Изменён» — сравнение канонических
// строк; «Сбросить» — к сохранённому состоянию вида, а без правок — к
// командному виду по умолчанию; хранение — заглушка по контракту S2.
import { describe, expect, it } from 'vitest';
import { DEFAULT_LIST_STATE } from '../../list/listModel';
import type { ListState } from '../../list/listModel';
import {
  createMemoryViewStore, isViewDirty, listStateToQuery, queryToListState, resetTarget,
  startView, teamDefault, viewCanSave,
} from './savedViews';
import type { KitSavedListView } from './savedViews';

const st = (p: Partial<ListState>): ListState => ({ ...DEFAULT_LIST_STATE, ...p });

const team: KitSavedListView = {
  id: 'team-active', name: 'Активные', section: 'sprints', owner: null, visibility: 'all', team_default: true,
  query: listStateToQuery(st({ filters: { status: ['active'] }, sort: { key: 'updated_at', dir: 'desc' } })),
};
const mine: KitSavedListView = {
  id: 'v1', name: 'Мои по статусу', section: 'sprints', owner: 'u-1', visibility: 'me',
  query: listStateToQuery(st({ group: 'status' })),
};

describe('строка запроса вида', () => {
  it('туда-обратно без потерь: фильтры, группировка, порядок, вид', () => {
    const s = st({ view: 'board', quick: 'done', group: 'status', sort: { key: 'title', dir: 'desc' }, filters: { status: ['a', 'b'] } });
    expect(queryToListState(listStateToQuery(s))).toEqual(s);
  });
  it('каноническая: порядок ключей фильтра не делает вид «изменённым»', () => {
    const a = st({ filters: { a: ['1'], b: ['2'] } });
    const b = st({ filters: { b: ['2'], a: ['1'] } });
    expect(listStateToQuery(a)).toBe(listStateToQuery(b));
  });
  it('пустой фильтр не попадает в строку; состояние по умолчанию — пустая строка', () => {
    expect(listStateToQuery(st({ filters: { a: [] } }))).toBe('');
  });
  it('битая строка — состояние по умолчанию, а не падение', () => {
    expect(queryToListState('lf=%7Bbroken')).toEqual(DEFAULT_LIST_STATE);
  });
});

describe('«изменён»', () => {
  it('совпадает с видом — не изменён; иначе — изменён', () => {
    expect(isViewDirty(team, queryToListState(team.query))).toBe(false);
    expect(isViewDirty(team, st({}))).toBe(true);
  });
  it('без активного вида изменено всё, что отличается от состояния по умолчанию', () => {
    expect(isViewDirty(null, st({}))).toBe(false);
    expect(isViewDirty(null, st({ group: 'status' }))).toBe(true);
  });
});

describe('командный вид по умолчанию и старт', () => {
  it('teamDefault — вид раздела с team_default', () => {
    expect(teamDefault([mine, team], 'sprints')?.id).toBe('team-active');
    expect(teamDefault([mine, team], 'adrs')).toBeNull();
  });
  it('личный вид по умолчанию переопределяет командный', () => {
    const myDefault = { ...mine, personal_default: true };
    expect(startView([team, myDefault], 'sprints', null)?.id).toBe('v1');
  });
  it('id из URL важнее умолчаний; неизвестный id — к умолчанию', () => {
    expect(startView([team, mine], 'sprints', 'v1')?.id).toBe('v1');
    expect(startView([team, mine], 'sprints', 'nope')?.id).toBe('team-active');
  });
});

describe('«Сбросить»', () => {
  it('изменённый вид — к его сохранённому состоянию', () => {
    expect(resetTarget([team, mine], 'sprints', mine, st({}))?.id).toBe('v1');
  });
  it('неизменённый личный — к командному по умолчанию', () => {
    expect(resetTarget([team, mine], 'sprints', mine, queryToListState(mine.query))?.id).toBe('team-active');
  });
  it('на командном без правок сбрасывать некуда', () => {
    expect(resetTarget([team, mine], 'sprints', team, queryToListState(team.query))).toBeNull();
  });
});

describe('«Сохранить» — только в свой вид', () => {
  it('свой — можно; командный и чужой — нет (только «Сохранить как»)', () => {
    expect(viewCanSave(mine, 'u-1')).toBe(true);
    expect(viewCanSave(team, 'u-1')).toBe(false);
    expect(viewCanSave(mine, 'u-2')).toBe(false);
    expect(viewCanSave(null, 'u-1')).toBe(false);
  });
});

describe('заглушка хранилища по контракту S2', () => {
  it('командные виды видны сразу; создать / обновить / удалить свой', async () => {
    const store = createMemoryViewStore({ user: 'u-1', teamViews: [team] });
    expect((await store.list('sprints')).map(v => v.id)).toEqual(['team-active']);
    const created = await store.create({ name: 'Мой', section: 'sprints', query: 'lg=status', visibility: 'me' });
    expect(created.owner).toBe('u-1');
    expect(created.id).not.toBe('team-active');
    const upd = await store.update(created.id, { query: 'lg=kind' });
    expect(upd.query).toBe('lg=kind');
    expect((await store.list('sprints')).map(v => v.id)).toEqual(['team-active', created.id]);
    await store.remove(created.id);
    expect((await store.list('sprints')).map(v => v.id)).toEqual(['team-active']);
  });
  it('раздел изолирован: виды спринтов не видны в ADR', async () => {
    const store = createMemoryViewStore({ user: 'u-1', teamViews: [team] });
    await store.create({ name: 'Мой', section: 'sprints', query: '', visibility: 'me' });
    expect(await store.list('adrs')).toEqual([]);
  });
  it('командный вид менять нельзя — 403, как ответит сервер', async () => {
    const store = createMemoryViewStore({ user: 'u-1', teamViews: [team] });
    await expect(store.update('team-active', { query: '' })).rejects.toMatchObject({ status: 403 });
    await expect(store.remove('team-active')).rejects.toMatchObject({ status: 403 });
  });
  it('неизвестный id — 404', async () => {
    const store = createMemoryViewStore({ user: 'u-1' });
    await expect(store.update('x', { query: '' })).rejects.toMatchObject({ status: 404 });
  });
  it('пишет в переданное хранилище и читает его при старте', async () => {
    const mem = new Map<string, string>();
    const backing = { get: (k: string) => mem.get(k) ?? null, set: (k: string, v: string) => { mem.set(k, v); } };
    const a = createMemoryViewStore({ user: 'u-1', persist: backing, key: 'views' });
    const v = await a.create({ name: 'Мой', section: 'sprints', query: 'lg=status', visibility: 'me' });
    const b = createMemoryViewStore({ user: 'u-1', persist: backing, key: 'views' });
    expect((await b.list('sprints')).map(x => x.id)).toEqual([v.id]);
  });
  it('битое содержимое хранилища — пусто, а не падение', async () => {
    const backing = { get: () => '{not json', set: () => {} };
    const s = createMemoryViewStore({ user: 'u-1', persist: backing, key: 'views' });
    expect(await s.list('sprints')).toEqual([]);
  });
});
