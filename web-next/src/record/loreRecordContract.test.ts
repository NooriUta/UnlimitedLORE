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

const TASK = { task_uid: 'SPRINT_A/A-1', task_id: 'A-1', sprint_id: 'SPRINT_A', title: 'Задача', status_raw: 'IN_PROGRESS', note_md: 'тело', effort_days: 2, component_ids: ['LORE'] };
const SPRINT = { sprint_id: 'SPRINT_A', name: 'Спринт А', status_raw: 'IN_PROGRESS', planned_end_date: '2026-11-12', valid_from: NOW, context_md: 'контекст', git_projects: ['NooriUta/UnlimitedLORE'] };

async function contractOf(type: 'task' | 'sprint', id: string, rows: Rows): Promise<LoreRecord1> {
  return toLoreRecord(await loadPassport(type, id, 'ru', fake(rows), NOW), NOW);
}

describe('lore.record/1 — из слайсов', () => {
  it('объект сериализуем: в нём нет функций, только данные', async () => {
    const c = await contractOf('task', TASK.task_uid, { tasks_by_uids: [TASK] });
    expect(JSON.parse(JSON.stringify(c))).toEqual(c);
    expect(c.contract).toBe('lore.record/1');
    expect(c.record).toMatchObject({ type: 'task', id: 'SPRINT_A/A-1', title: 'Задача', status: 'in_progress' });
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
    expect(c.schema.tabs.find(t => t.key === 'tasks')).toMatchObject({ zone: 'record', rel: 'HAS_TASK', count: 1 });
    expect(c.facts).toEqual({ tasks: { done: 1, total: 1 }, due: '2026-11-12' });
  });

  it('упавший блок — в meta.sources как error с причиной, факты — {error}, не ноль', async () => {
    const c = await contractOf('sprint', 'SPRINT_A', { sprints: [SPRINT], tasks_of_sprint: new Error('SNAPSHOT_MISS: нет в снимке') });
    expect(c.meta.sources).toContainEqual({ block: 'tasks', state: 'error', reason: 'SNAPSHOT_MISS: нет в снимке' });
    expect(c.facts?.tasks).toEqual({ error: 'SNAPSHOT_MISS: нет в снимке' });
    expect(c.meta.facade).toBe('client-emulated');
    expect(c.perms.can_edit).toBe(false);
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
    expect(k.config.kinds.sprint.tabs?.map(t => t.key)).toEqual(['tasks']);
    expect(k.data.edges).toContainEqual({ from: 'SPRINT_A', to: 'SPRINT_A/A-1', type: 'HAS_TASK' });
    expect(k.data.records.find(r => r.id === 'SPRINT_A/A-1')?.status).toBe('done');
    expect(k.facts).toBeDefined();
  });

  it('ошибка блока доходит до kit как meta.errors', async () => {
    const c = await contractOf('sprint', 'SPRINT_A', { sprints: [SPRINT], tasks_of_sprint: new Error('boom') });
    expect(fromLoreRecord(c, 'ru').data.meta.errors).toEqual([{ block: 'tasks', reason: 'boom' }]);
  });
});
