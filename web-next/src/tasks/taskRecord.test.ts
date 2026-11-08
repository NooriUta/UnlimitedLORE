// SPRINT_UXR_S5_RECORD_TASKS/S5-04 · модель чтения задачи: паспорт в URL,
// статус из status_raw, строка слайса tasks_of_sprint → запись kit,
// история (history_task) → журнал.
import { describe, expect, it } from 'vitest';
import {
  buildTaskData, historyToJournal, parseTaskPassport, sortSprintTasks, taskPassport,
  taskStatusCode, taskToRecord, taskConfig, type SprintTaskRow,
} from './taskRecord';
import { TASK_READ_DICTS } from './taskRead.i18n';

const row = (over: Partial<SprintTaskRow> = {}): SprintTaskRow => ({
  task_uid: 'u-1', task_id: 'S5-04', title: 'Чтение задачи', order_index: 4, status_raw: '🔄 IN_PROGRESS',
  effort_days: 2, note_md: '## Что\n\nтекст', component_ids: ['FORSETI'], realizes_uc: ['UC-7'],
  executor_agent: 'fleet-s5', reviewer_agent: 'owner', author_agent: null, task_type: 'feature', work_class: 'uc',
  ...over,
});

describe('S5-04 · паспорт задачи в URL — всегда пара «спринт/код»', () => {
  it('разбирает SPRINT/CODE по первому «/»', () => {
    expect(parseTaskPassport('SPRINT_UXR_S5_RECORD_TASKS/S5-04')).toEqual({ sprintId: 'SPRINT_UXR_S5_RECORD_TASKS', taskId: 'S5-04' });
  });
  it('одинокий код без спринта — не паспорт (один код у многих спринтов)', () => {
    expect(parseTaskPassport('S5-04')).toBeNull();
    expect(parseTaskPassport('/S5-04')).toBeNull();
    expect(parseTaskPassport('SPRINT_X/')).toBeNull();
    expect(parseTaskPassport(null)).toBeNull();
  });
  it('собирает обратно', () => {
    expect(taskPassport('SPRINT_X', 'T-1')).toBe('SPRINT_X/T-1');
  });
});

describe('S5-04 · статус из status_raw', () => {
  it.each([
    ['✅ DONE', 'done'], ['DONE', 'done'], ['закрыто', 'done'], ['🔄 IN_PROGRESS', 'in_progress'], ['WIP', 'in_progress'],
    ['🔴 BLOCKED', 'blocked'], ['🚫 CANCELLED', 'cancelled'], ['⬜ TODO', 'todo'], ['🟣 BACKLOG', 'backlog'],
    ['📋 PLANNED', 'planned'], ['🟡 PARTIAL', 'partial'], ['🚀 READY_FOR_DEPLOY', 'ready_for_deploy'],
    ['⏸ DEFERRED', 'deferred'], ['🔬 DESIGN', 'design'], ['in_progress', 'in_progress'],
  ])('%s → %s', (raw, code) => { expect(taskStatusCode(raw)).toBe(code); });
  it('пусто — «к работе»: у задачи без строки состояния статус ещё не ставили', () => {
    expect(taskStatusCode(null)).toBe('todo');
    expect(taskStatusCode('  ')).toBe('todo');
  });
  it('нераспознанное — как есть, чтобы шапка честно сказала «статус не описан», а не выдумала todo', () => {
    expect(taskStatusCode('🦄 ВОЛШЕБНО')).toBe('🦄 волшебно');
  });
  it('каждый код из распознаваемых описан в конфиге статусов', () => {
    const codes = taskConfig('ru').statuses.items.map(s => s.code);
    for (const raw of ['DONE', 'WIP', 'BLOCKED', 'CANCEL', 'TODO', 'BACKLOG', 'PLANNED', 'PARTIAL', 'RFD', 'DEFER', 'DESIGN']) {
      expect(codes).toContain(taskStatusCode(raw));
    }
  });
});

describe('S5-04 · строка tasks_of_sprint → запись kit', () => {
  it('id — паспорт, тело — note_md, свойства — в fields', () => {
    const r = taskToRecord(row(), 'SPRINT_A');
    expect(r).toMatchObject({
      id: 'SPRINT_A/S5-04', kind: 'task', title: 'Чтение задачи', status: 'in_progress', body_md: '## Что\n\nтекст',
    });
    expect(r.fields).toMatchObject({ sprint_id: 'SPRINT_A', task_id: 'S5-04', effort_days: 2, executor_agent: 'fleet-s5', component_ids: ['FORSETI'] });
  });
  it('без заголовка — код задачи, а не пустая шапка', () => {
    expect(taskToRecord(row({ title: null }), 'S').title).toBe('S5-04');
  });
  it('порядок задач — order_index, затем код (как в спринте)', () => {
    const rows = sortSprintTasks([row({ task_id: 'B', order_index: 2 }), row({ task_id: 'A', order_index: 2 }), row({ task_id: 'Z', order_index: 1 })]);
    expect(rows.map(r => r.task_id)).toEqual(['Z', 'A', 'B']);
  });
});

describe('S5-04 · история → журнал', () => {
  it('смены статуса/оценки/текста между соседними состояниями — записи журнала', () => {
    const j = historyToJournal('S/T-1', [
      { valid_from: '2026-11-01T10:00:00', status_raw: '⬜ TODO', effort_days: 1, note_md: 'a', source_commit: null },
      { valid_from: '2026-11-02T10:00:00', status_raw: '🔄 IN_PROGRESS', effort_days: 1, note_md: 'a', source_commit: 'abc1234' },
      { valid_from: '2026-11-03T10:00:00', status_raw: '🔄 IN_PROGRESS', effort_days: 3, note_md: 'b', source_commit: null },
    ]);
    expect(j.map(e => [e.at, e.field, e.from, e.to])).toEqual([
      ['2026-11-01T10:00:00', 'status', null, 'todo'],
      ['2026-11-02T10:00:00', 'status', 'todo', 'in_progress'],
      ['2026-11-03T10:00:00', 'effort_days', 1, 3],
      ['2026-11-03T10:00:00', 'note_md', 'a', 'b'],
    ]);
    expect(j.every(e => e.record_id === 'S/T-1')).toBe(true);
    expect(j[1].who).toBe('abc1234');
    expect(j[0].who).toBe('—');
  });
});

describe('S5-04 · KitData задачи: рёбра из полей, честные ошибки блоков', () => {
  it('рёбра: задача → спринт, компоненты, сценарии', () => {
    const d = buildTaskData('SPRINT_A', [row()], { journal: [] });
    expect(d.edges).toEqual(expect.arrayContaining([
      { from: 'SPRINT_A/S5-04', to: 'SPRINT_A', type: 'PART_OF' },
      { from: 'SPRINT_A/S5-04', to: 'FORSETI', type: 'TAGGED_WITH' },
      { from: 'SPRINT_A/S5-04', to: 'UC-7', type: 'REALIZES' },
    ]));
    expect(d.meta.errors ?? []).toEqual([]);
  });
  it('история не загрузилась — ошибка блока journal, а не «журнал пуст»', () => {
    const d = buildTaskData('SPRINT_A', [row()], { journalError: '500 boom' });
    expect(d.meta.errors).toEqual([{ block: 'journal', reason: '500 boom' }]);
  });
});

describe('S5-04 · локали чтения задачи', () => {
  it('ru и en совпадают по ключам и плейсхолдерам', () => {
    const ph = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort();
    expect(Object.keys(TASK_READ_DICTS.en).sort()).toEqual(Object.keys(TASK_READ_DICTS.ru).sort());
    for (const k of Object.keys(TASK_READ_DICTS.ru) as (keyof typeof TASK_READ_DICTS.ru)[]) {
      expect(ph(TASK_READ_DICTS.en[k]), k).toEqual(ph(TASK_READ_DICTS.ru[k]));
    }
  });
});
