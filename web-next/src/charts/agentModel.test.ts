// №13 «действия агентов по дням» и №14 «отказы MCP по кодам» (предложение 19.11.2026).
// Данные — срез agent_action_points: точки ряда AgentActionLog (момент, профиль, клиент, код ответа). Тест до кода.
import { describe, expect, it } from 'vitest';
import { actionsOverTime, failuresByCode, parseActionPoints, periodBuckets } from './agentModel';

const TODAY = Date.parse('2026-11-19T15:00:00Z');
const rows = [
  { ts: '2026-11-19T10:00:00Z', caller: 'full', client: 'c-full', status: 200 },
  { ts: '2026-11-19T11:00:00Z', caller: 'full', client: 'c-full', status: 409 },
  { ts: '2026-11-18T10:00:00Z', caller: 'pm', client: 'c-pm', status: 200 },
  { ts: '2026-11-18T12:00:00Z', caller: 'full', client: 'c-full2', status: 401 },
  { ts: '2026-11-17T09:00:00Z', caller: 'full', client: 'c-full', status: 422 },
  { ts: '2026-11-17T09:30:00Z', caller: 'tester', client: 'c-t', status: 500 },
  { ts: 'мусор', caller: 'full', client: 'c', status: 200 },
  { ts: '2026-10-01T00:00:00Z', caller: 'full', client: 'c', status: 200 }, // вне периода
];

describe('точки действий', () => {
  it('без момента — не точка, а счёт словами', () => {
    const p = parseActionPoints(rows);
    expect(p.points).toHaveLength(7);
    expect(p.undated).toBe(1);
  });
});

describe('корзины периода', () => {
  it('до месяца — по дням, дольше — по неделям', () => {
    expect(periodBuckets(7, TODAY).step).toBe('day');
    expect(periodBuckets(7, TODAY).starts).toHaveLength(7);
    expect(periodBuckets(90, TODAY).step).toBe('week');
  });
});

describe('№13 действия агентов по дням', () => {
  it('линия на профиль, сверху самые частые; вне периода не в счёте', () => {
    const s = actionsOverTime(parseActionPoints(rows).points, 3, TODAY, 'caller');
    expect(s.series.map(x => x.key)).toEqual(['full', 'pm', 'tester']);
    expect(s.series[0].points.map(p => p.y)).toEqual([1, 1, 2]);
    expect(s.total).toBe(6);
  });

  it('по клиенту — разрез по client_id', () => {
    const s = actionsOverTime(parseActionPoints(rows).points, 3, TODAY, 'client');
    expect(s.series[0].key).toBe('c-full');
  });

  it('больше пяти — остальные одной линией «прочие»', () => {
    const many = Array.from({ length: 8 }, (_, i) => ({ ts: '2026-11-19T10:00:00Z', caller: `a${i}`, client: 'c', status: 200 }));
    const s = actionsOverTime(parseActionPoints(many).points, 3, TODAY, 'caller');
    expect(s.series).toHaveLength(6);
    expect(s.series[5].key).toBe('__rest');
    expect(s.series[5].points[2].y).toBe(3);
  });
});

describe('№14 отказы MCP по кодам', () => {
  it('только коды ≥ 400; столбик — день, группа — код; коды по частоте', () => {
    const f = failuresByCode(parseActionPoints(rows).points, 3, TODAY);
    expect(f.codes).toEqual(['401', '409', '422', '500']);
    expect(f.data.map(d => d.values['409'])).toEqual([0, 0, 1]);
    expect(f.total).toBe(4);
  });

  it('за 30 дней — по неделям: столбики по дням на телефоне не читаются', () => {
    expect(failuresByCode(parseActionPoints(rows).points, 30, TODAY).buckets.step).toBe('week');
    expect(failuresByCode(parseActionPoints(rows).points, 14, TODAY).buckets.step).toBe('day');
  });

  it('отказов нет — total 0 (график скажет словами), а не пустой ряд', () => {
    const f = failuresByCode(parseActionPoints(rows.filter(r => r.status === 200)).points, 3, TODAY);
    expect(f.total).toBe(0);
  });
});
