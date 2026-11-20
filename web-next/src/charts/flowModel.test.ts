// Графики потока задач (предложение 19.11.2026, «добавляй графики»): №2 — накопительный поток (CFD),
// №1 — время цикла. Данные — версии статуса SCD2 (срез task_status_versions): у каждой версии начало
// и конец. Тест до кода.
import { describe, expect, it } from 'vitest';
import { bandOf, cfdSeries, cycleTimes, taskTimelines, type StatusVersionRow } from './flowModel';
import { planStatusOf } from '../sprints/taskStatus';

const D = (s: string) => Date.parse(`${s}T00:00:00Z`);
const ROWS: StatusVersionRow[] = [
  // A: todo 01.11 → в работе 03.11 → RFD 06.11 → done 08.11
  { task_uid: 'S/A', status_raw: '⬜ TODO', valid_from: '2026-11-01T09:00:00Z', valid_to: '2026-11-03T09:00:00Z' },
  { task_uid: 'S/A', status_raw: '🔄 IN PROGRESS', valid_from: '2026-11-03T09:00:00Z', valid_to: '2026-11-06T09:00:00Z' },
  { task_uid: 'S/A', status_raw: '🚀 READY', valid_from: '2026-11-06T09:00:00Z', valid_to: '2026-11-08T09:00:00Z' },
  { task_uid: 'S/A', status_raw: '✅ DONE', valid_from: '2026-11-08T09:00:00Z', valid_to: null },
  // B: todo 02.11 → в работе 04.11 → заблокирована 05.11 (правка текста 06.11 — статус тот же), открыта
  { task_uid: 'S/B', status_raw: '⬜ TODO', valid_from: '2026-11-02T09:00:00Z', valid_to: '2026-11-04T09:00:00Z' },
  { task_uid: 'S/B', status_raw: '🔄 IN PROGRESS', valid_from: '2026-11-04T09:00:00Z', valid_to: '2026-11-05T09:00:00Z' },
  { task_uid: 'S/B', status_raw: '🔴 BLOCKED', valid_from: '2026-11-05T09:00:00Z', valid_to: '2026-11-06T09:00:00Z' },
  { task_uid: 'S/B', status_raw: '🔴 BLOCKED', valid_from: '2026-11-06T09:00:00Z', valid_to: null, version_kind: 'text' },
  // C: заведена сразу закрытой 07.11 — в «в работе» не была
  { task_uid: 'S/C', status_raw: '✅ DONE', valid_from: '2026-11-07T09:00:00Z', valid_to: null },
  // D: отменена — в поток не входит
  { task_uid: 'S/D', status_raw: '🚫 CANCELLED', valid_from: '2026-11-02T09:00:00Z', valid_to: null },
  // без даты — не считается, но учитывается как «показана часть»
  { task_uid: 'S/E', status_raw: '⬜ TODO', valid_from: null, valid_to: null },
  // чужой спринт
  { task_uid: 'OTHER/X', status_raw: '⬜ TODO', valid_from: '2026-11-01T09:00:00Z', valid_to: null },
];
const inS = (uid: string) => uid.startsWith('S/');
const TODAY = D('2026-11-09') + 12 * 3600e3;

describe('полосы статуса', () => {
  it('todo/в работе/заблокировано/к выкатке/сделано; отменённое и нераспознанное — вне потока', () => {
    expect(bandOf(planStatusOf('📋 PLANNED'))).toBe('todo');
    expect(bandOf(planStatusOf('🔍 REVIEW'))).toBe('active');
    expect(bandOf(planStatusOf('🔴 BLOCKED'))).toBe('blocked');
    expect(bandOf(planStatusOf('🧪 UAT'))).toBe('rfd');
    expect(bandOf(planStatusOf('✅ MERGED'))).toBe('done');
    expect(bandOf(planStatusOf('🚫 CANCELLED'))).toBeNull();
    expect(bandOf(planStatusOf('что-то'))).toBeNull();
  });
});

describe('линии задач из версий SCD2', () => {
  it('отбор по охвату, версии по времени; строки без даты — в счёт «без даты»', () => {
    const tl = taskTimelines(ROWS, inS);
    expect([...tl.tasks.keys()].sort()).toEqual(['S/A', 'S/B', 'S/C', 'S/D']);
    expect(tl.undated).toBe(1);
    expect(tl.tasks.get('S/A')!.map(s => s.band)).toEqual(['todo', 'active', 'rfd', 'done']);
  });
});

describe('№2 CFD — накопительный поток', () => {
  it('короткий охват — по дням; полосы сложены снизу вверх: сделано, к выкатке, заблокировано, в работе, todo', () => {
    const c = cfdSeries(taskTimelines(ROWS, inS), TODAY);
    expect(c.step).toBe('day');
    expect(c.x.map(x => new Date(x).toISOString().slice(0, 10))).toEqual([
      '2026-11-01', '2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06', '2026-11-07', '2026-11-08', '2026-11-09']);
    // конец 05.11: A в работе, B заблокирована → done 0, rfd 0, blocked 1, active 2, todo 2
    const i = 4;
    expect([c.stack.done[i], c.stack.rfd[i], c.stack.blocked[i], c.stack.active[i], c.stack.todo[i]]).toEqual([0, 0, 1, 2, 2]);
    // последняя точка (сегодня): A done, C done, B blocked
    const l = c.x.length - 1;
    expect([c.stack.done[l], c.stack.rfd[l], c.stack.blocked[l], c.stack.active[l], c.stack.todo[l]]).toEqual([2, 2, 3, 3, 3]);
  });

  it('длинный охват — по неделям, не больше 26', () => {
    const rows: StatusVersionRow[] = [{ task_uid: 'S/OLD', status_raw: '⬜ TODO', valid_from: '2025-01-06T00:00:00Z', valid_to: null }];
    const c = cfdSeries(taskTimelines(rows, inS), TODAY);
    expect(c.step).toBe('week');
    expect(c.x).toHaveLength(26);
  });

  it('ни одной задачи с датой — рядов нет (график скажет «пусто»)', () => {
    const c = cfdSeries(taskTimelines([{ task_uid: 'S/E', status_raw: '⬜ TODO' }], inS), TODAY);
    expect(c.x).toEqual([]);
  });
});

describe('№1 время цикла', () => {
  it('дни от первого входа в работу до первого «к выкатке» или «сделано»', () => {
    const c = cycleTimes(taskTimelines(ROWS, inS));
    expect(c.points).toEqual([{ id: 'S/A', x: Date.parse('2026-11-06T09:00:00Z'), y: 3 }]);
  });

  it('закрытые мимо «в работе» — не точка, а счёт словами; незакрытые — тоже счёт', () => {
    const c = cycleTimes(taskTimelines(ROWS, inS));
    expect(c.skippedWork).toBe(1); // C
    expect(c.inWork).toBe(1); // B
  });

  it('окно: только закрытые не раньше from', () => {
    const c = cycleTimes(taskTimelines(ROWS, inS), D('2026-11-07'));
    expect(c.points).toEqual([]);
  });
});
