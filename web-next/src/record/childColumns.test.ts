// SPRINT_UXR_S9_SCALE_OPT/S9-05, решение владелицы D14 (14.11.2026) «колонки по типу ребёнка»:
// в паспортах родителей (веха, компонент, человек, агент, релиз, проект) таблица детей
// показывает колонки по типу ребёнка — у задач исполнитель, оценка, класс работы; у спринтов
// прогресс x/y и даты плана. Значения приходят с фасада в связи ключом `values`.
//
// Правило: колонки добавляются только связи, чьи элементы ПРИНЕСЛИ значения. Связь без
// `values` (те же задачи по другому ребру) — прежние общие колонки: пустой столбец «—»
// читался бы как «исполнителя нет», хотя его просто не читали.
import { describe, expect, it } from 'vitest';
import { recordFromServer } from '../api/liveRecord';
import { fromLoreRecord, type LoreRecord1 } from './loreRecordContract';

const body = (type: string, id: string, relations: unknown[], links: unknown[]) => ({
  contract: 'lore.record/1',
  record: { type, id, title: id, status: '', version: null, updated_at: null, updated_by: null },
  schema: { type, label: type, icon: type, fields: [], tabs: [], relations },
  values: { title: id },
  links,
  perms: { can_edit: false, can_status: false, can_create: false, status_next: [], reason: null },
  meta: { data_state: [] },
});
const rel = (key: string, rel: string, target: string) =>
  ({ key, label: key, relation: 'association', rel, dir: 'in', place: 'link_tab', target_type: target });

const component = (): LoreRecord1 => recordFromServer(body('component', 'C1',
  [rel('tasks', 'TAGGED_WITH', 'task'), rel('sprints', 'BELONGS_TO', 'sprint'), rel('adrs', 'BELONGS_TO', 'adr')],
  [
    { rel: 'TAGGED_WITH', dir: 'in', id: 'S/T-1', type: 'task', title: 'Задача', status: 'active',
      values: { executor: 'claude', effort: 1.5, work_class: 'enb' } },
    { rel: 'BELONGS_TO', dir: 'in', id: 'SPRINT_X', type: 'sprint', title: 'Спринт', status: 'active',
      values: { progress: { done: 6, total: 12 }, planned_start: '2026-11-01', planned_end: '2026-11-20' } },
    { rel: 'BELONGS_TO', dir: 'in', id: 'ADR-1', type: 'adr', title: 'ADR', status: 'accepted' },
  ]), '2026-11-14T00:00:00Z');

describe('S9-05 / D14 · фасад → значения связи', () => {
  it('values связи доходят до контракта клиента', () => {
    const c = component();
    expect(c.links.find(l => l.id === 'S/T-1')?.values).toEqual({ executor: 'claude', effort: 1.5, work_class: 'enb' });
    expect(c.links.find(l => l.id === 'ADR-1')?.values).toBeUndefined();
  });

  it('значения ребёнка — поля его записи в данных паспорта', () => {
    const { data } = fromLoreRecord(component(), 'ru');
    expect(data.records.find(r => r.id === 'S/T-1')?.fields).toMatchObject({ executor: 'claude', effort: 1.5, work_class: 'enb' });
    expect(data.records.find(r => r.id === 'SPRINT_X')?.fields).toMatchObject({ progress: { done: 6, total: 12 }, planned_end: '2026-11-20' });
  });
});

describe('S9-05 / D14 · колонки таблицы детей по типу ребёнка', () => {
  const rels = () => fromLoreRecord(component(), 'ru').config.kinds.component.relations ?? [];

  it('задачи: исполнитель, оценка, класс работы — после общих колонок', () => {
    const cols = rels().find(r => r.key === 'tasks')?.columns ?? [];
    expect(cols.slice(0, 4)).toEqual(['status', 'kind', 'id', 'title']);
    expect(cols).toEqual(expect.arrayContaining(['fields.executor', 'fields.effort', 'fields.work_class']));
  });

  it('спринты: прогресс x/y и даты плана', () => {
    const cols = rels().find(r => r.key === 'sprints')?.columns ?? [];
    expect(cols).toEqual(expect.arrayContaining(['progress:progress', 'fields.planned_start', 'fields.planned_end']));
  });

  it('связь без значений — общие колонки (не назначены)', () => {
    expect(rels().find(r => r.key === 'adrs')?.columns).toBeUndefined();
  });

  it('у колонок есть подписи: вид ребёнка объявлен с полями', () => {
    const kinds = fromLoreRecord(component(), 'ru').config.kinds;
    expect(kinds.task?.fields?.map(f => f.title)).toEqual(expect.arrayContaining(['Исполнитель', 'Класс работы']));
    expect(kinds.sprint?.fields?.map(f => f.title)).toEqual(expect.arrayContaining(['Прогресс', 'Начало по плану', 'Конец по плану']));
  });

  for (const [type, relKey, edge, target] of [
    ['milestone', 'sprints', 'TARGETS_MILESTONE', 'sprint'],
    ['user', 'tasks', 'ROLE_HELD_BY', 'task'],
    ['agent', 'tasks', 'ROLE_HELD_BY', 'task'],
  ] as const) {
    it(`${type}: таблица детей (${relKey}) — колонки по типу ребёнка`, () => {
      const values = target === 'task' ? { executor: 'x', effort: 1, work_class: 'uc' } : { progress: { done: 1, total: 2 }, planned_start: null, planned_end: null };
      const c = recordFromServer(body(type, 'P', [rel(relKey, edge, target)],
        [{ rel: edge, dir: 'in', id: 'CH-1', type: target, title: 'ребёнок', status: '', values }]), '2026-11-14T00:00:00Z');
      const cols = fromLoreRecord(c, 'ru').config.kinds[type].relations?.find(r => r.key === relKey)?.columns ?? [];
      expect(cols).toContain(target === 'task' ? 'fields.executor' : 'progress:progress');
    });
  }
});
