// SPRINT_UXR_S10_SEIDR_KIT/K-07 — модель палитры Ctrl+K и поиска «/»:
// записи и команды, без запроса — недавние.
import { describe, expect, it } from 'vitest';
import { createSafeStorage } from '../resilience/safeStorage';
import { createRecentList, normalizeQuery, searchPalette } from './paletteModel';
import { fixtureConfig, fixtureData } from './fixtures.test-helper';

const data = fixtureData();
const config = fixtureConfig();

function memStorage() {
  return createSafeStorage(() => null);
}

describe('K-07 · normalizeQuery', () => {
  it('регистр, ё→е и лишние пробелы не влияют', () => {
    expect(normalizeQuery('  Ёлка   ПЛАН ')).toBe('елка план');
  });
});

describe('K-07 · поиск по записям и командам', () => {
  it('положительный контроль: фикстура не пустая', () => {
    expect(data.records.length).toBeGreaterThan(3);
    expect(config.palette?.commands?.length).toBeGreaterThan(0);
  });

  it('находит запись по подстроке заголовка без учёта регистра и ё', () => {
    const r = searchPalette({ query: 'ЁЛКУ', data, config, mode: 'all', recent: [] });
    expect(r.section).toBe('results');
    expect(r.items.map(i => i.id)).toContain('T-3');
  });

  it('точное совпадение кода выше совпадения в заголовке', () => {
    const r = searchPalette({ query: 'adr-1', data, config, mode: 'all', recent: [] });
    expect(r.items[0]).toMatchObject({ type: 'record', id: 'ADR-1' });
  });

  it('несколько слов — каждое обязано найтись (И, а не ИЛИ)', () => {
    const r = searchPalette({ query: 'план релиза', data, config, mode: 'all', recent: [] });
    expect(r.items.map(i => i.id)).toEqual(['T-1']);
  });

  it('Ctrl+K (all) ищет и команды, «/» (records) — только записи', () => {
    const all = searchPalette({ query: 'созд', data, config, mode: 'all', recent: [] });
    expect(all.items.some(i => i.type === 'command' && i.id === 'new-task')).toBe(true);
    const rec = searchPalette({ query: 'созд', data, config, mode: 'records', recent: [] });
    expect(rec.items.every(i => i.type === 'record')).toBe(true);
  });

  it('у записи — заголовок и иконка вида из config.kinds', () => {
    const r = searchPalette({ query: 'T-1', data, config, mode: 'records', recent: [] });
    expect(r.items[0]).toMatchObject({ type: 'record', id: 'T-1', kindTitle: 'Задача', icon: 'scroll-unfurled' });
  });

  it('неизвестный вид записи не роняет поиск: заголовок вида = код вида', () => {
    const d = { ...data, records: [...data.records, { id: 'X-1', kind: 'alien', title: 'Чужак', status: 'todo', fields: {} }] };
    const r = searchPalette({ query: 'чужак', data: d, config, mode: 'records', recent: [] });
    expect(r.items[0]).toMatchObject({ id: 'X-1', kindTitle: 'alien' });
  });

  it('порядок детерминирован: равный вес — порядок данных', () => {
    const a = searchPalette({ query: 'задача', data, config, mode: 'records', recent: [] }).items.map(i => i.id);
    const b = searchPalette({ query: 'задача', data, config, mode: 'records', recent: [] }).items.map(i => i.id);
    expect(a).toEqual(b);
  });

  it('limit режет выдачу и честно сообщает, сколько найдено всего', () => {
    const r = searchPalette({ query: 'а', data, config, mode: 'all', recent: [], limit: 2 });
    expect(r.items).toHaveLength(2);
    expect(r.total).toBeGreaterThan(2);
  });

  it('ничего не найдено — пустой список с section=results (не «недавние»)', () => {
    const r = searchPalette({ query: 'zzzqqq', data, config, mode: 'all', recent: ['record:T-1'] });
    expect(r).toMatchObject({ section: 'results', items: [], total: 0 });
  });
});

describe('K-07 · без запроса — недавние', () => {
  it('пустой запрос отдаёт недавние в порядке свежести', () => {
    const r = searchPalette({ query: '  ', data, config, mode: 'all', recent: ['record:T-3', 'command:new-task', 'record:ADR-1'] });
    expect(r.section).toBe('recent');
    expect(r.items.map(i => `${i.type}:${i.id}`)).toEqual(['record:T-3', 'command:new-task', 'record:ADR-1']);
  });

  it('в режиме «/» недавние команды не показываются', () => {
    const r = searchPalette({ query: '', data, config, mode: 'records', recent: ['command:new-task', 'record:T-1'] });
    expect(r.items.map(i => i.id)).toEqual(['T-1']);
  });

  // Было: такой пункт молча пропускался. Из-за этого палитра выглядела
  // пустой у человека, который точно открывал записи — просто на другом
  // экране, и в выгрузке ЭТОГО экрана их нет (находка P1 аудита 08.11, вторая
  // половина: «Недавних пока нет»). Теперь пункт остаётся: виден код, а
  // origin: 'recent-only' говорит, что больше о записи ничего не известно.
  // Пропускать — значит прятать то, что человек делал.
  it('недавняя запись вне выгрузки остаётся, с пометкой «известен только код»', () => {
    const r = searchPalette({ query: '', data, config, mode: 'all', recent: ['record:GONE', 'record:T-1'] });
    expect(r.items.map(i => i.id)).toEqual(['GONE', 'T-1']);
    const gone = r.items.find(i => i.id === 'GONE');
    expect(gone && gone.type === 'record' ? gone.origin : null).toBe('recent-only');
    expect(gone && gone.type === 'record' ? gone.kindTitle : 'x').toBe('');
  });
});

describe('K-07 · список недавних в хранилище', () => {
  it('push кладёт в начало, без дублей, с пределом max', () => {
    const list = createRecentList(memStorage(), { max: 3 });
    list.push({ type: 'record', id: 'A' });
    list.push({ type: 'record', id: 'B' });
    list.push({ type: 'command', id: 'C' });
    list.push({ type: 'record', id: 'A' });
    list.push({ type: 'record', id: 'D' });
    expect(list.list()).toEqual(['record:D', 'record:A', 'command:C']);
  });

  it('переживает пересоздание поверх того же хранилища', () => {
    const s = memStorage();
    createRecentList(s).push({ type: 'record', id: 'T-1' });
    expect(createRecentList(s).list()).toEqual(['record:T-1']);
  });

  it('мусор в хранилище не роняет — пустой список', () => {
    const s = memStorage();
    s.set('seidr.kit.palette.recent', '{not json');
    expect(createRecentList(s).list()).toEqual([]);
    s.set('seidr.kit.palette.recent', JSON.stringify([1, 'record:T-1', null, 'bad']));
    expect(createRecentList(s).list()).toEqual(['record:T-1']);
  });
});
