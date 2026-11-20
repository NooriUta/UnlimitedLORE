// Графики второй пачки (предложение 19.11.2026, «добавляй графики»: 3, 4, 5, 6, 8, 9, 11, 16) —
// подготовка данных каждого графика. Тест до кода.
import { describe, expect, it } from 'vitest';
import { taskTimelines, type StatusVersionRow } from './flowModel';
import {
  blockedWeekly, decisionFlow, gatePassShare, gatesHeat, mergeToProd, openAgeHistogram, releaseRhythm, tasksClosedWeekly, wipByExecutor,
} from './batch2Model';

const TODAY = Date.parse('2026-11-19T12:00:00Z'); // чт, неделя с пн 16.11
const DAY = 864e5;

describe('№3 WIP по исполнителям', () => {
  const rows = [
    { task_uid: 'S/A', status_raw: '🔄 IN PROGRESS', executor_agent: 'Claude (full)' },
    { task_uid: 'S/B', status_raw: '🔴 BLOCKED', executor_agent: 'Claude (full)' },
    { task_uid: 'S/C', status_raw: '🔍 REVIEW', executor_agent: 'Ирина' },
    { task_uid: 'S/D', status_raw: '🔄 IN PROGRESS', executor_agent: null },
    { task_uid: 'S/E', status_raw: '✅ DONE', executor_agent: 'Ирина' },
    { task_uid: 'S/F', status_raw: '⬜ TODO', executor_agent: 'Ирина' },
  ];
  it('в работе и заблокировано — по исполнителю; без исполнителя — своей строкой; закрытое и не начатое — нет', () => {
    const w = wipByExecutor(rows, '(нет)');
    expect(w.data.map(d => [d.category, d.values.active, d.values.blocked])).toEqual([
      ['Claude (full)', 1, 1], ['(нет)', 1, 0], ['Ирина', 1, 0]]);
    expect(w.total).toBe(4);
  });
});

describe('№4 возраст открытых задач', () => {
  const rows: StatusVersionRow[] = [
    { task_uid: 'S/A', status_raw: '⬜ TODO', valid_from: new Date(TODAY - 3 * DAY).toISOString() },
    { task_uid: 'S/B', status_raw: '🔄 IN PROGRESS', valid_from: new Date(TODAY - 40 * DAY).toISOString(), valid_to: new Date(TODAY - 30 * DAY).toISOString() },
    { task_uid: 'S/B', status_raw: '🔴 BLOCKED', valid_from: new Date(TODAY - 30 * DAY).toISOString() },
    { task_uid: 'S/C', status_raw: '✅ DONE', valid_from: new Date(TODAY - 100 * DAY).toISOString() },
    { task_uid: 'S/D', status_raw: '⬜ TODO', valid_from: new Date(TODAY - 120 * DAY).toISOString() },
  ];
  it('возраст — от первой версии; закрытые не в счёте; корзины по неделям и месяцам', () => {
    const h = openAgeHistogram(taskTimelines(rows), TODAY);
    expect(h.data.map(d => d.values.n)).toEqual([1, 0, 0, 1, 0, 1]);
    expect(h.open).toBe(3);
    expect(h.olderThanMonth).toBe(2);
  });
});

describe('№5 блокировки во времени', () => {
  const rows: StatusVersionRow[] = [
    { task_uid: 'S/A', status_raw: '🔴 BLOCKED', valid_from: '2026-11-03T00:00:00Z', valid_to: '2026-11-12T00:00:00Z' },
    { task_uid: 'S/A', status_raw: '🔄 IN PROGRESS', valid_from: '2026-11-12T00:00:00Z' },
    { task_uid: 'S/B', status_raw: '🔴 BLOCKED', valid_from: '2026-11-17T00:00:00Z' },
  ];
  it('на конец недели: сколько в блоке и сколько дней в среднем в текущем блоке; без блоков — пропуск, а не ноль дней', () => {
    const b = blockedWeekly(taskTimelines(rows), TODAY, 4);
    expect(b.count.map(p => p.y)).toEqual([0, 1, 0, 1]);
    expect(b.meanDays.map(p => p.y)).toEqual([null, 6, null, 2.5]);
  });
});

describe('№6 velocity по задачам вехи', () => {
  it('закрыто задач вехи за неделю; задача — по первому закрытию; чужие не в счёте', () => {
    const done = [
      { task_uid: 'S1/A', valid_from: '2026-11-03' }, { task_uid: 'S1/B', valid_from: '2026-11-04' },
      { task_uid: 'S1/C', valid_from: '2026-11-17' }, { task_uid: 'X/Z', valid_from: '2026-11-17' },
    ];
    const v = tasksClosedWeekly(done, u => u.startsWith('S1/'), TODAY, 3);
    expect(v.map(w => [w.category, w.values.t])).toEqual([['02.11', 2], ['09.11', 0], ['16.11', 1]]);
  });
});

describe('№8 ритм релизов', () => {
  const rows = [
    { release_uid: 'p#v1', git_tag: 'v1', release_date: '2026-10-01', pr_count: 5 },
    { release_uid: 'p#v2', git_tag: 'v2', release_date: '2026-10-15', pr_count: 0 },
    { release_uid: 'p#v3', git_tag: 'v3', release_date: '2026-11-01', pr_count: 12 },
    { release_uid: 'p#v4', git_tag: 'v4', release_date: null, pr_count: 3 },
  ];
  it('точка — релиз на оси времени, высота — число PR; без PR и без даты — не точки, а счёт словами', () => {
    const r = releaseRhythm(rows);
    expect(r.points.map(p => [p.label, p.y])).toEqual([['v1', 5], ['v3', 12]]);
    expect(r.noPrs).toBe(1);
    expect(r.undated).toBe(1);
    expect(r.medianGapDays).toBe(15.5);
  });
});

describe('№9 от мержа до прода', () => {
  const rows = [
    { pr_uid: 'p#1', merged_at: '2026-11-01T10:00:00Z', release_date: '2026-11-05', release_id: 'v3' },
    { pr_uid: 'p#2', merged_at: '2026-11-04T00:00:00Z', release_date: '2026-11-05', release_id: 'v3' },
    { pr_uid: 'p#3', merged_at: null, release_date: '2026-11-05', release_id: 'v3' },
    { pr_uid: 'p#4', merged_at: '2026-11-10T00:00:00Z', release_date: '2026-11-05', release_id: 'v3' },
  ];
  it('дней от merged_at до даты релиза; без merged_at и «мерж позже релиза» — счёт словами', () => {
    const m = mergeToProd(rows);
    expect(m.points.map(p => [p.label, p.y])).toEqual([['p#1', 3.6], ['p#2', 1]]);
    expect(m.noMerge).toBe(1);
    expect(m.mergedAfter).toBe(1);
    expect(m.median).toBe(2.3);
  });
});

describe('№11 поток решений', () => {
  const rows = [
    { decision_id: 'D1', status_raw: 'proposed', valid_from: '2026-11-02T10:00:00Z' },
    { decision_id: 'D1', status_raw: 'accepted', valid_from: '2026-11-04T10:00:00Z' },
    { decision_id: 'D1', status_raw: 'accepted', valid_from: '2026-11-05T10:00:00Z' }, // правка текста — не переход
    { decision_id: 'D2', status_raw: 'proposed', valid_from: '2026-11-10T10:00:00Z' },
    { decision_id: 'D2', status_raw: 'deferred', valid_from: '2026-11-17T10:00:00Z' },
    { decision_id: 'D3', status_raw: 'accepted', valid_from: '2026-11-17T10:00:00Z', status_backfilled: true },
    { decision_id: 'D4', status_raw: 'superseded', valid_from: '2026-11-18T10:00:00Z' },
  ];
  it('переходы по неделям; первая версия — «предложено» (появилось); бэкфилл — не переход, счёт словами', () => {
    const f = decisionFlow(rows, TODAY, 3);
    expect(f.data.map(w => [w.category, w.values.proposed, w.values.accepted, w.values.deferred, w.values.superseded])).toEqual([
      ['02.11', 1, 1, 0, 0], ['09.11', 1, 0, 0, 0], ['16.11', 0, 0, 1, 1]]);
    expect(f.backfilled).toBe(1);
  });
});

describe('№16 гейты', () => {
  const runs = [
    { routine_name: 'qg-a', run_date: '2026-11-03', status: 'PASS' },
    { routine_name: 'qg-a', run_date: '2026-11-04', status: 'WARN' },
    { routine_name: 'qg-a', run_date: '2026-11-17', status: 'PASS' },
    { routine_name: 'qg-b', run_date: '2026-11-17', status: 'FAIL' },
    { routine_name: 'qg-b', run_date: null, status: 'FAIL' },
  ];
  it('доля PASS по неделям у одного гейта; неделя без прогонов — пропуск, а не 0 %', () => {
    const g = gatePassShare(runs, 'qg-a', TODAY, 3);
    expect(g.points.map(p => p.y)).toEqual([50, null, 100]);
    expect(g.runs).toBe(3);
  });
  it('матрица гейт × неделя, проценты; без прогонов — «—»', () => {
    const h = gatesHeat(runs, TODAY, 3);
    expect(h.rows).toEqual(['qg-a', 'qg-b']);
    expect(h.cols).toEqual(['02.11', '09.11', '16.11']);
    expect(h.values).toEqual([[50, null, 100], [null, null, 0]]);
    expect(h.undated).toBe(1);
  });
});
