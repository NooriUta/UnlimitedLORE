// Паспорт читает `parts[]` фасада lore.record/1 (SPRINT_UXR_S4_UI_SHELL_LISTS/S4-36).
//
// Дефект прода v1.17.8, снятый соседней сессией с ЖИВОГО ответа
// /lore/record/sprint/SPRINT_AIDA_PREPROD_MIGRATION: «Задач нет» в паспорте
// спринта при 48 задачах в списке, «Задачи 0», «Фазы 0», «Проекты 0»,
// «Компоненты 0».
//
// ПРИЧИНА — КЛИЕНТ, сервер контракт соблюдает:
//  • задачи и фазы приходят в `parts[]` (rel PART_OF, dir in), а не в `links`;
//    в `schema.relations` у них `place: "part"`;
//  • проекты и компоненты — СВОЙСТВА: значения в `values`, в relations
//    `place: "prop"`;
//  • в `links` — только вкладки связей (`place: "link_tab"`, у спринта это
//    DEPENDS_ON out/in);
//  • итог задач сервер присылает сам: `facts.tasks {done, total, open}`.
// `fromLoreRecord` поля `parts` не знал вовсе: вкладки считал по `links`,
// факты — пересчётом рёбер. Отсюда нули при полном ответе.
//
// Форма ниже — не догадка: её подтвердила серверная сессия по коду
// (LoreRecordResource ~140–200, LoreRecordRegistry.partJson ~593,
// LoreRecordValues.taskItem ~157, item ~314). `state` у части — ровно три
// значения: ok · denied (нет разрешённых проектов) · error (сбой среза);
// состояния «обрезано» у частей нет, обрезку показывает meta.data_state.
import { describe, expect, it } from 'vitest';
import { recordFacts, type KitCtx } from '@seidr/kit';
import { fromLoreRecord, type LorePart, type LoreRecord1 } from './loreRecordContract';

const TASK_VALUES = {
  status: 'done', task_type: 'feature', code: 'CO-11', title: 'Первая',
  executor: 'arharaga', effort: 1, work_class: 'dev', author: 'arharaga',
  reviewer: null, actual: 1, realizes_uc: [], prs: [], phase_uid: 'PH-1', has_note: true,
};

const part = (over: Partial<LorePart>): LorePart => ({
  key: 'tasks', label: 'Задачи', type: 'task', rel: 'PART_OF', dir: 'in',
  owned: true, relation: 'composition', state: 'ok', count: 0, items: [],
  ...over,
});

const TASKS_PART = part({
  count: 3,
  items: [
    { id: 'SPRINT_X/CO-11', title: 'Первая', status: 'done', values: TASK_VALUES },
    { id: 'SPRINT_X/CO-12', title: 'Вторая', status: 'active', values: { ...TASK_VALUES, status: 'active', code: 'CO-12' } },
    { id: 'SPRINT_X/CO-13', title: 'Третья', status: 'planned', values: { ...TASK_VALUES, status: 'planned', code: 'CO-13' } },
  ],
});

const PHASES_PART = part({
  key: 'phases', label: 'Фазы', type: 'sprint_phase', count: 2,
  items: [
    { id: 'PH-1', title: 'Подготовка', status: 'done', values: { done: 2, total: 2 } },
    { id: 'PH-2', title: 'Выкатка', status: 'active', values: { done: 1, total: 3 } },
  ],
});

/** Ответ фасада в том виде, в каком его снял прод (урезанный до сути). */
function sprint(over: Partial<LoreRecord1> = {}): LoreRecord1 {
  return {
    contract: 'lore.record/1',
    record: { type: 'sprint', id: 'SPRINT_X', title: 'Спринт', status: 'active', version: '2026-11-09T10:00:00Z', updated_at: '2026-11-09T10:00:00Z', updated_by: 'arharaga' },
    schema: {
      type: 'sprint', label: 'Спринт', icon: 'sprint',
      fields: [
        { key: 'title', label: 'Название', kind: 'text', required: true, editable: true, group: 'head' },
        { key: 'context_md', label: 'Контекст', kind: 'md', required: false, editable: true, group: 'body' },
      ],
      tabs: [],
      relations: [
        { key: 'tasks', label: 'Задачи', relation: 'composition', rel: 'PART_OF', dir: 'in', count: 0, place: 'part', manageable: true },
        { key: 'phases', label: 'Фазы', relation: 'composition', rel: 'PART_OF', dir: 'in', count: 0, place: 'part', manageable: false },
        { key: 'projects', label: 'Проекты', relation: 'association', rel: 'IN_PROJECT', dir: 'out', count: 0, place: 'prop', manageable: true },
        { key: 'components', label: 'Компоненты', relation: 'association', rel: 'TOUCHES', dir: 'out', count: 0, place: 'prop', manageable: true },
        { key: 'dependsOn', label: 'Зависит от', relation: 'association', rel: 'DEPENDS_ON', dir: 'out', count: 1, place: 'link_tab', manageable: true },
      ],
    },
    values: { title: 'Спринт', projects: ['NooriUta/AIDA'], components: ['INFRA'], planned_end_date: '2026-11-30' },
    links: [{ rel: 'DEPENDS_ON', dir: 'out', id: 'SPRINT_Y', type: 'sprint', title: 'Соседний', status: 'done' }],
    parts: [TASKS_PART, PHASES_PART],
    facts: { tasks: { done: 48, total: 56, open: 7 }, due: '2026-11-30' },
    perms: { can_edit: true, can_status: true, can_create: false, status_next: ['done'], reason: null },
    meta: { loaded_at: '2026-11-09T12:00:00.000Z', facade: 'server', sources: [{ block: 'record', state: 'ok' }] },
    ...over,
  };
}

const load = (c: LoreRecord1) => fromLoreRecord(c, 'ru');

function tasksFactOf(c: LoreRecord1) {
  const l = load(c);
  const ctx = { data: l.data, config: l.config } as unknown as KitCtx;
  return recordFacts(l.record, ctx, { ...(l.facts ?? {}), now: '2026-11-09' }).tasks;
}

describe('S4-36 · части записи (parts) доходят до экрана', () => {
  it('положительный контроль: ответ разобран, запись и вид на месте', () => {
    const l = load(sprint());
    expect(l.record.id).toBe('SPRINT_X');
    expect(l.config.kinds.sprint).toBeDefined();
  });

  it('задачи из parts становятся записями и рёбрами — а не исчезают', () => {
    const l = load(sprint());
    const ids = l.data.records.map(r => r.id);
    expect(ids).toContain('SPRINT_X/CO-11');
    expect(ids).toContain('SPRINT_X/CO-13');
    const taskEdges = l.data.edges.filter(e => e.type === 'PART_OF' && e.to === 'SPRINT_X');
    expect(taskEdges.length).toBeGreaterThanOrEqual(3);
  });

  it('фазы — тоже части: их элементы на месте, а не «Фазы 0»', () => {
    const l = load(sprint());
    expect(l.data.records.map(r => r.id)).toContain('PH-2');
    const phase = l.data.records.find(r => r.id === 'PH-2');
    expect(phase?.kind).toBe('sprint_phase');
    expect(phase?.title).toBe('Выкатка');
  });

  it('итог задач берётся у сервера: 48/56, а не 1/3 по присланным элементам', () => {
    expect(tasksFactOf(sprint())).toMatchObject({ state: 'ok', done: 48, total: 56, open: 7 });
  });

  it('facts.tasks нет вовсе, а часть не прочиталась — «не смогли проверить», не ноль', () => {
    const c = sprint({
      facts: { due: '2026-11-30' },
      parts: [part({ state: 'error', count: null, error: 'tasks_of_sprint: 502 Bad Gateway', items: [] }), PHASES_PART],
    });
    const t = tasksFactOf(c);
    expect(t?.state).toBe('error');
    expect(t?.state === 'error' && t.reason).toContain('tasks_of_sprint');
  });

  it('нет разрешённых проектов (denied) — это про права, а не «Задач нет»', () => {
    const c = sprint({
      facts: { due: null },
      parts: [part({ state: 'denied', count: null, error: 'tasks_of_sprint: нет разрешённых проектов', items: [] })],
    });
    const t = tasksFactOf(c);
    expect(t?.state).toBe('error');
    expect(t?.state === 'error' && t.reason).toMatch(/прав|разрешённых/i);
    const meta = load(c).data.meta as unknown as { data_state?: { source: string; state: string; reason?: string }[] };
    const ds = meta.data_state?.find(x => x.source === 'tasks');
    expect(ds?.state).toBe('forbidden');
  });

  it('у спринта правда нет задач — проверенный ноль остаётся нулём', () => {
    const c = sprint({ facts: { tasks: { done: 0, total: 0 }, due: null }, parts: [part({ count: 0, items: [] })] });
    expect(tasksFactOf(c)?.state).toBe('none');
  });
});

describe('S4-36 · проекты и компоненты — свойства, а не связи с нулём', () => {
  it('значения из values показываются полями', () => {
    const l = load(sprint());
    const fields = l.config.kinds.sprint!.fields ?? [];
    expect(fields.map(f => f.key)).toContain('projects');
    expect(fields.map(f => f.key)).toContain('components');
    expect(l.record.fields.projects).toEqual(['NooriUta/AIDA']);
    expect(l.record.fields.components).toEqual(['INFRA']);
  });

  it('в блоке связей их нет: иначе человек видит «Проекты 0» при живом значении', () => {
    const rels = load(sprint()).config.kinds.sprint!.relations ?? [];
    expect(rels.map(r => r.key)).not.toContain('projects');
    expect(rels.map(r => r.key)).not.toContain('components');
  });

  it('части в блоке связей не дублируются — у них свои вкладки', () => {
    const l = load(sprint());
    const rels = l.config.kinds.sprint!.relations ?? [];
    expect(rels.map(r => r.key)).toEqual(['dependsOn']);
    const tabs = l.config.kinds.sprint!.tabs ?? [];
    expect(tabs.map(t => t.key)).toEqual(expect.arrayContaining(['tasks', 'phases']));
  });
});

// SPRINT_UXR_S4_UI_SHELL_LISTS/S4-09: итоги спринта в паспорте. Сервер кладёт
// их в `computed` (та же функция, что у среза sprint_totals), а клиент этот
// блок не читал вовсе — в паспорте не было «оценка Σ / факт Σ».
describe('S4-09 · итоги спринта из computed — полями паспорта', () => {
  const fieldsOf = (c: LoreRecord1) => load(c).config.kinds.sprint!.fields ?? [];

  it('оценка и факт — поля-суммы с охватом, как ячейки списка', () => {
    const c = sprint({ computed: { effort_days_total: { value: 12.5, known: 9, of: 14 }, actual_days_total: { value: null, known: 0, of: 14 } } });
    const l = load(c);
    expect(fieldsOf(c).filter(f => f.type === 'sum').map(f => f.key)).toEqual(['effort_total', 'actual_total']);
    expect(l.record.fields.effort_total).toEqual({ value: 12.5, known: 9, of: 14 });
    expect(l.record.fields.actual_total).toEqual({ value: null, known: 0, of: 14 });
  });

  it('ответ сервера без итогов у спринта — «не посчитали» с причиной, а не ноль', () => {
    const l = load(sprint({ computed: {} }));
    expect(l.record.fields.effort_total).toEqual({ error: expect.stringMatching(/не прислал/) });
  });

  it('положительный контроль: клиентская эмуляция без computed — полей итогов нет вовсе', () => {
    expect(fieldsOf(sprint()).some(f => f.type === 'sum')).toBe(false);
  });
});

// SPRINT_UXR_S9_SCALE_OPT/S9-05 «пришла не вся — сказано числом» переехала в
// partTabList.test.tsx: тело вкладки части стало списком kit (React), и
// проверяется рендером, а не строкой.

// S4-24 (владелица 11.11: «не сделано редактирование множественного выбора привязок
// (компоненты, проекты)»): связь-свойство с путём привязки получает своё ребро —
// kit рисует чипы с «Отвязать» и выбор с поиском. Без пути (manageable: false) — чтение.
describe('S4-24 · связь-свойство правится, если у сервера есть путь привязки', () => {
  it('компоненты и проекты — поле ref с ребром; без пути — без ребра', () => {
    const base = sprint();
    const rels = base.schema.relations.map(r => (r.key === 'projects' ? { ...r, manageable: false } : r));
    const l = load({ ...base, schema: { ...base.schema, relations: rels } });
    const f = (k: string) => l.config.kinds.sprint.fields?.find(x => x.key === k);
    expect(f('components')).toMatchObject({ type: 'ref', relation: { rel: 'TOUCHES', dir: 'out' } });
    expect(f('projects')?.relation).toBeUndefined();
  });
});
