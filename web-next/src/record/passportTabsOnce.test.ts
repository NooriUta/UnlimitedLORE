// Один раздел — одно место в паспорте (ревью 10.11.2026, B13 + просьба
// владелицы того же дня: «проверить, почему, например, в паспорте у спринтов
// дублирующиеся вкладки»).
//
// ПРИЧИНА, проверенная по коду слоя перевода:
//  • `recordFromServer` (api/liveRecord.ts, `tabsOf`) строит `schema.tabs` из
//    связей с `place: "link_tab"` — так было до того, как kit научился рисовать
//    вкладки связей сам;
//  • `fromLoreRecord` отдаёт kit ТЕ ЖЕ связи в `relations`
//    (`(place ?? 'link_tab') === 'link_tab'`), и kit делает из них вкладки — со
//    счётчиком и значком вида UML.
// Одна связь проходила двумя путями, и в ряду появлялись ДВЕ вкладки «Зависит
// от»: одна со счётчиком, другая без. Отсюда же «счётчики то есть, то нет» из
// ревью: у вкладки-двойника счётчика не было вовсе.
//
// ПРАВИЛО: вкладку связи рисует kit. Приложение не отдаёт своей вкладки на тот
// же ключ — иначе один раздел занимает два места в ряду.
import { describe, expect, it } from 'vitest';
import { fromLoreRecord, type LoreRecord1 } from './loreRecordContract';

/** Ответ фасада со связью-вкладкой: ровно то, что отдаёт прод для спринта. */
function sprint(over: Partial<LoreRecord1['schema']> = {}): LoreRecord1 {
  return {
    contract: 'lore.record/1',
    record: { type: 'sprint', id: 'SPRINT_X', title: 'Спринт', status: 'active', version: '2026-11-10T10:00:00Z', updated_at: null, updated_by: null },
    schema: {
      type: 'sprint', label: 'Спринт', icon: 'sprint',
      fields: [
        { key: 'title', label: 'Название', kind: 'text', required: true, editable: true, group: 'head' },
        { key: 'context_md', label: 'Контекст', kind: 'md', required: false, editable: true, group: 'body' },
      ],
      // Вкладки, как их строит слой перевода живого ответа: по связям link_tab.
      tabs: [
        { key: 'dependsOn', label: 'Зависит от', zone: 'record', rel: 'DEPENDS_ON', dir: 'out' },
        { key: 'blocks', label: 'Блокирует', zone: 'record', rel: 'DEPENDS_ON', dir: 'in' },
      ],
      relations: [
        { key: 'tasks', label: 'Задачи', relation: 'composition', rel: 'PART_OF', dir: 'in', count: 0, place: 'part', manageable: true },
        { key: 'dependsOn', label: 'Зависит от', relation: 'association', rel: 'DEPENDS_ON', dir: 'out', count: 1, place: 'link_tab', manageable: true },
        { key: 'blocks', label: 'Блокирует', relation: 'association', rel: 'DEPENDS_ON', dir: 'in', count: 0, place: 'link_tab', manageable: true },
      ],
      ...over,
    },
    values: { title: 'Спринт', context_md: 'Текст' },
    links: [{ rel: 'DEPENDS_ON', dir: 'out', id: 'SPRINT_Y', type: 'sprint', title: 'Соседний', status: 'done' }],
    parts: [{ key: 'tasks', label: 'Задачи', type: 'task', rel: 'PART_OF', dir: 'in', owned: true, relation: 'composition', state: 'ok', count: 1, items: [{ id: 'SPRINT_X/CO-1', title: 'Первая', status: 'done' }] }],
    facts: { tasks: { done: 1, total: 1 }, due: null },
    perms: { can_edit: true, can_status: false, can_create: false, status_next: [], reason: null },
    meta: { loaded_at: '2026-11-10T12:00:00.000Z', facade: 'server', sources: [{ block: 'record', state: 'ok' }] },
  };
}

const kindOf = (c: LoreRecord1) => fromLoreRecord(c, 'ru').config.kinds.sprint!;

describe('B13 · дублирующихся вкладок в паспорте нет', () => {
  it('положительный контроль: вид разобран, связи и вкладки на месте', () => {
    const k = kindOf(sprint());
    expect((k.relations ?? []).map(r => r.key)).toContain('dependsOn');
    expect((k.tabs ?? []).map(t => t.key)).toContain('tasks');
  });

  it('ключ не встречается и во вкладках вида, и в связях: один раздел — одно место', () => {
    const k = kindOf(sprint());
    const tabKeys = (k.tabs ?? []).map(t => t.key);
    const relKeys = (k.relations ?? []).map(r => r.key);
    expect(tabKeys.filter(x => relKeys.includes(x))).toEqual([]);
  });

  it('вкладку связи рисует kit — со счётчиком и видом UML, а не вкладка-двойник без числа', () => {
    const k = kindOf(sprint());
    expect((k.tabs ?? []).map(t => t.key)).not.toContain('dependsOn');
    expect((k.relations ?? []).find(r => r.key === 'dependsOn')?.relation).toBe('association');
  });

  it('связь без своей вкладки у kit не теряется: части остаются вкладками приложения', () => {
    const k = kindOf(sprint());
    expect((k.tabs ?? []).map(t => t.key)).toEqual(['tasks']);
  });

  it('связь, которую kit НЕ рисует (place: prop), вкладку приложения сохраняет', () => {
    const c = sprint();
    c.schema.relations = [{ key: 'projects', label: 'Проекты', relation: 'association', rel: 'IN_PROJECT', dir: 'out', count: 0, place: 'prop' }];
    c.schema.tabs = [{ key: 'projects', label: 'Проекты', zone: 'record', rel: 'IN_PROJECT', dir: 'out' }];
    const k = kindOf(c);
    expect((k.relations ?? []).map(r => r.key)).not.toContain('projects');
    expect((k.tabs ?? []).map(t => t.key)).toContain('projects');
  });
});
