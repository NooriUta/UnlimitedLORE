// Слой контракта lore.record/1 (SPRINT_UXR_S4_UI_SHELL_LISTS/S4-33, ADR-LORE-047):
// существующие слайсы → объект контракта → kit. Kit рисует ТОЛЬКО из объекта контракта.
import { describe, expect, it } from 'vitest';
import type { SliceBody } from '../api/loreSlice';
import { loadPassport } from './passportAdapters';
import { fromLoreRecord, toLoreRecord, type LoreRecord1 } from './loreRecordContract';

const NOW = '2026-11-08T12:00:00.000Z';
type Rows = Record<string, Record<string, unknown>[] | Error>;
const fake = (rows: Rows) => async <T,>(name: string): Promise<SliceBody<T>> => {
  const r = rows[name];
  if (r instanceof Error) throw r;
  return { rows: (r ?? []) as T[] };
};

const TASK = { task_uid: 'SPRINT_A/A-1', task_id: 'A-1', sprint_id: 'SPRINT_A', title: 'Задача', status_raw: '🔄 IN PROGRESS', note_md: 'тело', effort_days: 2, component_ids: ['LORE'] };
const SPRINT = { sprint_id: 'SPRINT_A', name: 'Спринт А', status_raw: 'IN_PROGRESS', planned_end_date: '2026-11-12', valid_from: NOW, context_md: 'контекст', git_projects: ['NooriUta/UnlimitedLORE'] };

async function contractOf(type: 'task' | 'sprint', id: string, rows: Rows): Promise<LoreRecord1> {
  return toLoreRecord(await loadPassport(type, id, 'ru', fake(rows), NOW), NOW);
}

describe('lore.record/1 — из слайсов', () => {
  it('объект сериализуем: в нём нет функций, только данные', async () => {
    const c = await contractOf('task', TASK.task_uid, { tasks_by_uids: [TASK] });
    expect(JSON.parse(JSON.stringify(c))).toEqual(c);
    expect(c.contract).toBe('lore.record/1');
    expect(c.record).toMatchObject({ type: 'task', id: 'SPRINT_A/A-1', title: 'Задача', status: 'active' }); // канон словаря (planStatusOf, #900)
  });

  it('обязательные свойства — первыми; у задачи без спринта не сохранить', async () => {
    const c = await contractOf('task', TASK.task_uid, { tasks_by_uids: [TASK] });
    const props = c.schema.fields.filter(f => f.group === 'props');
    expect(props[0]).toMatchObject({ key: 'sprint', required: true, kind: 'ref' });
    expect(c.schema.fields.find(f => f.key === 'title')).toMatchObject({ group: 'head', required: true });
    expect(c.values.body_md).toBe('тело');
  });

  it('связи — списком links с направлением, вкладка задач спринта считает их', async () => {
    const c = await contractOf('sprint', 'SPRINT_A', { sprints: [SPRINT], tasks_of_sprint: [{ task_id: 'A-1', title: 'Задача', status_raw: 'DONE', order_index: 1 }] });
    expect(c.links).toContainEqual({ rel: 'HAS_TASK', dir: 'out', id: 'SPRINT_A/A-1', type: 'Task', title: 'Задача', status: 'done' });
    // Задачи спринта — композиция (дочки), по виду UML; вкладку рисует kit (D-2026-LORE-RECORD-RELATION-UML).
    expect(c.schema.relations.find(r => r.key === 'tasks')).toMatchObject({ relation: 'composition', rel: 'HAS_TASK', dir: 'out', count: 1 });
    expect(c.facts).toEqual({ tasks: { done: 1, total: 1 }, due: '2026-11-12' });
  });

  it('упавший блок — в meta.sources как error с причиной, факты — {error}, не ноль', async () => {
    const c = await contractOf('sprint', 'SPRINT_A', { sprints: [SPRINT], tasks_of_sprint: new Error('SNAPSHOT_MISS: нет в снимке') });
    expect(c.meta.sources).toContainEqual({ block: 'tasks', state: 'error', reason: 'SNAPSHOT_MISS: нет в снимке' });
    expect(c.facts?.tasks).toEqual({ error: 'SNAPSHOT_MISS: нет в снимке' });
    expect(c.meta.facade).toBe('client-emulated');
    expect(c.perms.can_edit).toBe(true); // S4-24: текст спринта правится на месте (ADR-LORE-047 п. 14.1)
    expect(c.perms.reason).toBeTruthy();
  });
});

describe('lore.record/1 → kit', () => {
  it('kit получает поля, вкладки и связи только из объекта — после JSON-перехода', async () => {
    const c = await contractOf('sprint', 'SPRINT_A', { sprints: [SPRINT], tasks_of_sprint: [{ task_id: 'A-1', title: 'Задача', status_raw: 'DONE', order_index: 1 }] });
    const k = fromLoreRecord(JSON.parse(JSON.stringify(c)) as LoreRecord1, 'ru');
    expect(k.record).toMatchObject({ id: 'SPRINT_A', kind: 'sprint', title: 'Спринт А', body_md: 'контекст' });
    expect(k.record.fields.planned_end_date).toBe('2026-11-12');
    expect(k.config.kinds.sprint.fields?.map(f => f.key)).toEqual(c.schema.fields.filter(f => f.group === 'props').map(f => f.key));
    expect(k.config.kinds.sprint.relations?.find(r => r.key === 'tasks')?.relation).toBe('composition');
    expect(k.data.edges).toContainEqual({ from: 'SPRINT_A', to: 'SPRINT_A/A-1', type: 'HAS_TASK' });
    expect(k.data.records.find(r => r.id === 'SPRINT_A/A-1')?.status).toBe('done');
    expect(k.facts).toBeDefined();
  });

  it('ошибка блока доходит до kit как meta.errors', async () => {
    const c = await contractOf('sprint', 'SPRINT_A', { sprints: [SPRINT], tasks_of_sprint: new Error('boom') });
    expect(fromLoreRecord(c, 'ru').data.meta.errors).toEqual([{ block: 'tasks', reason: 'boom' }]);
  });
});

describe('S4-36: паспорт спринта — разделы «Планирование» и «Модули», как в v1', () => {
  it('поля спринта несут раздел, раздел проходит через объект контракта до kit', async () => {
    const row = { ...SPRINT, created_date: '2026-11-07', milestone_ids: ['M1'], planned_start_date: '2026-11-08', no_release_required: true, components: ['LORE'] };
    const c = await contractOf('sprint', 'SPRINT_A', { sprints: [row], tasks_of_sprint: [] });
    const sec = (k: string) => c.schema.fields.find(f => f.key === k)?.section;
    expect(sec('created')).toBe('Планирование');
    expect(sec('milestones')).toBe('Планирование');
    expect(sec('planned_end_date')).toBe('Планирование');
    expect(sec('no_release')).toBe('Планирование');
    expect(sec('components')).toBe('Модули');
    expect(c.values.created).toBe('2026-11-07');
    expect(c.values.no_release).toBe('да');
    const k = fromLoreRecord(JSON.parse(JSON.stringify(c)) as LoreRecord1, 'ru');
    expect(k.config.kinds.sprint.fields?.find(f => f.key === 'created')?.section).toBe('Планирование');
  });
});

describe('ADR — разделы как в v1: «Контекст», «Решение», «Следствия» отдельными блоками с подписью', () => {
  const ADR = { adr_id: 'ADR-1', name: 'А', status: 'ACCEPTED', context_md: '## Проблема\nк', decision_md: 'р', consequences_md: '', components: [], git_projects: [], depends_on_ids: [], supersedes_ids: [], superseded_by_ids: [], justified_task_uids: [], tags: [] };
  it('в объекте — три поля текста группы body, а не одно склеенное с «## Контекст»', async () => {
    const c = toLoreRecord(await loadPassport('adr', 'ADR-1', 'ru', fake({ adr: [ADR], decisions_of_adr: [] }), NOW), NOW);
    const body = c.schema.fields.filter(f => f.group === 'body').map(f => [f.key, f.label]);
    expect(body).toEqual([['context_md', 'Контекст'], ['decision_md', 'Решение'], ['consequences_md', 'Следствия']]);
    expect(c.values.context_md).toBe('## Проблема\nк');
    expect(c.values.body_md ?? null).toBeNull();
    expect(c.schema.fields.filter(f => f.group === 'props').map(f => f.key)).not.toContain('context_md');
  });
  it('kit рисует непустые разделы по порядку, каждый со своей подписью', async () => {
    const c = toLoreRecord(await loadPassport('adr', 'ADR-1', 'ru', fake({ adr: [ADR], decisions_of_adr: [] }), NOW), NOW);
    const k = fromLoreRecord(JSON.parse(JSON.stringify(c)) as LoreRecord1, 'ru');
    // 09.11.2026: разделы приходят ДАННЫМИ, а не функцией рисования. Прежнее
    // утверждение («overview — функция») закрепляло ту самую причину, из-за
    // которой у разделов не было ✎: kit отдавал весь обзор чужой функции и
    // редактор до текста не доходил (дефект прода v1.17.7).
    expect(k.config.kinds.adr.overview).toBeUndefined();
    expect(k.config.kinds.adr.bodySections?.map(s => s.key)).toEqual(['context_md', 'decision_md', 'consequences_md']);
    expect(k.config.kinds.adr.fields?.map(f => f.key)).not.toContain('decision_md');
  });
});

describe('ADR — связи по видам UML (слова владелицы 08.11)', () => {
  it('решения — агрегация; «зависит от / блокирует» и «заменяет / заменён» — ассоциация; JUSTIFIED_BY — реализация', async () => {
    const ADR = { adr_id: 'ADR-1', name: 'А', status: 'ACCEPTED', context_md: 'к', components: [], git_projects: [], depends_on_ids: ['ADR-2'], supersedes_ids: ['ADR-0'], superseded_by_ids: [], justified_task_uids: ['S/T-1'], tags: [] };
    const c = toLoreRecord(await loadPassport('adr', 'ADR-1', 'ru', fake({ adr: [ADR], decisions_of_adr: [{ decision_id: 'D-1', title: 'Р', status: 'accepted' }] }), NOW), NOW);
    const rel = (k: string) => c.schema.relations.find(r => r.key === k);
    expect(rel('decisions')).toMatchObject({ relation: 'aggregation', rel: 'DECIDED_IN', dir: 'in', count: 1 });
    expect(rel('dependsOn')).toMatchObject({ relation: 'association', count: 1 });
    expect(rel('supersedes')).toMatchObject({ relation: 'association', rel: 'SUPERSEDES', count: 1 });
    expect(rel('justifies')).toMatchObject({ relation: 'realization', count: 1 });
    expect(c.schema.relations.some(r => r.relation === 'generalization')).toBe(false);
  });
});

// Прод v1.17.13, 11.11.2026, владелица: «паспорт сломался». У решения вкладка
// «Контент» пустая, хотя тело в LORE есть. Корень на стыке: сервер отдаёт у
// решения ДВА поля группы body — `body_md` (само решение, заполнено) и
// `rationale_md` (обоснование, пусто). Приложение выкидывало `body_md` из
// разделов, считая его копией (так у задачи: `body_md` — копия `note_md`), а
// kit, видя разделы, тело отдельным блоком не рисует. Оставался один пустой
// раздел только для чтения — и он скрыт. Правило: `body_md` — копия, только
// если совпадает с другим разделом тела; иначе это настоящее тело и первый раздел.
describe('тело записи: body_md — раздел, если он не копия другого раздела', () => {
  async function asType(type: string, fields: { key: string; label: string; editable?: boolean }[], values: Record<string, unknown>): Promise<LoreRecord1> {
    const c = await contractOf('task', TASK.task_uid, { tasks_by_uids: [TASK] });
    const head = c.schema.fields.filter(f => f.group !== 'body');
    return {
      ...c,
      record: { ...c.record, type },
      schema: {
        ...c.schema, type,
        fields: [...head, ...fields.map(f => ({ key: f.key, label: f.label, kind: 'md' as const, required: false, editable: f.editable ?? false, group: 'body' as const }))],
      },
      values: { ...c.values, ...values },
    };
  }

  it('решение: body_md заполнено, rationale_md пусто — «Решение» первым разделом с текстом', async () => {
    const c = await asType('decision', [{ key: 'body_md', label: 'Решение' }, { key: 'rationale_md', label: 'Обоснование' }], { body_md: 'текст решения', rationale_md: null });
    const k = fromLoreRecord(JSON.parse(JSON.stringify(c)) as LoreRecord1, 'ru');
    expect(k.config.kinds.decision.bodySections?.map(s => s.key)).toEqual(['body_md', 'rationale_md']);
    expect(k.record.fields.body_md).toBe('текст решения');
  });

  it('задача: body_md — копия заметки — вторым разделом не дублируется', async () => {
    const c = await asType('task', [{ key: 'note_md', label: 'Заметка', editable: true }, { key: 'body_md', label: 'Текст' }], { body_md: 'тело', note_md: 'тело' });
    const k = fromLoreRecord(JSON.parse(JSON.stringify(c)) as LoreRecord1, 'ru');
    expect(k.config.kinds.task.bodySections?.map(s => s.key)).toEqual(['note_md']);
  });
});
