// №7 предложения 19.11.2026: прогноз вехи — burnup по задачам её спринтов и тренд до даты вехи
// («успеем или нет, на сколько недель»). Тест до кода.
import { describe, expect, it } from 'vitest';
import { milestoneForecast } from './forecastModel';

const TODAY = Date.parse('2026-11-19T12:00:00Z'); // чт, неделя с пн 16.11
const inM = (uid: string) => uid.startsWith('S1/') || uid.startsWith('S2/');
const created = [
  { task_uid: 'S1/A', valid_from: '2026-10-26' }, { task_uid: 'S1/B', valid_from: '2026-10-26' },
  { task_uid: 'S1/C', valid_from: '2026-10-27' }, { task_uid: 'S2/D', valid_from: '2026-11-02' },
  { task_uid: 'S2/E', valid_from: '2026-11-03' }, { task_uid: 'S2/F', valid_from: '2026-11-10' },
  { task_uid: 'OTHER/Z', valid_from: '2026-10-01' },
];
// закрыто по одной в неделю: 02.11, 09.11, 16.11 → темп 1 в неделю, остаток 3
const done = [
  { task_uid: 'S1/A', valid_from: '2026-11-03' }, { task_uid: 'S1/B', valid_from: '2026-11-10' },
  { task_uid: 'S1/C', valid_from: '2026-11-17' },
];

describe('№7 прогноз вехи', () => {
  it('burnup по неделям: объём и сделано накопленно; чужие задачи не в счёте', () => {
    const f = milestoneForecast({ created, done, inScope: inM, today: TODAY, due: '2026-12-31', frozen: false });
    expect(f.scope.map(p => p.y)).toEqual([3, 5, 6, 6]);
    expect(f.done.map(p => p.y)).toEqual([0, 1, 2, 3]);
  });

  it('тренд — от последней точки сделанного вперёд по темпу последних недель, до срока', () => {
    const f = milestoneForecast({ created, done, inScope: inM, today: TODAY, due: '2026-12-31', frozen: false });
    expect(f.rate).toBe(1);
    expect(f.trend[0]).toEqual({ x: f.done[3].x, y: 3 });
    expect(f.trend[f.trend.length - 1].y).toBe(6); // упирается в объём
    expect(f.verdict.kind).toBe('ok');
    expect(f.verdict.weeks).toBeGreaterThan(0); // запас недель
  });

  it('срок раньше конца по тренду — «не успеваем на N нед.»; линия «нужно к сроку» до объёма в срок', () => {
    const f = milestoneForecast({ created, done, inScope: inM, today: TODAY, due: '2026-11-30', frozen: false });
    expect(f.verdict.kind).toBe('late');
    expect(f.verdict.weeks).toBe(2);
    expect(f.need[f.need.length - 1]).toEqual({ x: Date.parse('2026-11-30T00:00:00Z'), y: 6 });
  });

  it('срока нет — тренд до конца по темпу, вердикт «срок не распознан»', () => {
    const f = milestoneForecast({ created, done, inScope: inM, today: TODAY, due: null, frozen: false });
    expect(f.verdict.kind).toBe('nodue');
    expect(f.need).toEqual([]);
    expect(f.trend.length).toBeGreaterThan(1);
  });

  it('закрытий меньше двух недель — тренда нет, словами «мало данных»', () => {
    const f = milestoneForecast({ created, done: done.slice(2), inScope: inM, today: TODAY, due: '2026-12-31', frozen: false });
    expect(f.verdict.kind).toBe('few');
    expect(f.trend).toEqual([]);
  });

  it('замороженная веха — без прогноза; всё закрыто — «готово»', () => {
    expect(milestoneForecast({ created, done, inScope: inM, today: TODAY, due: '2026-12-31', frozen: true }).verdict.kind).toBe('frozen');
    const all = created.filter(c => inM(c.task_uid)).map(c => ({ task_uid: c.task_uid, valid_from: '2026-11-18' }));
    expect(milestoneForecast({ created, done: all, inScope: inM, today: TODAY, due: '2026-12-31', frozen: false }).verdict.kind).toBe('done');
  });

  it('у спринтов вехи нет задач — рядов нет', () => {
    const f = milestoneForecast({ created: [], done: [], inScope: inM, today: TODAY, due: '2026-12-31', frozen: false });
    expect(f.scope).toEqual([]);
    expect(f.verdict.kind).toBe('empty');
  });
});
