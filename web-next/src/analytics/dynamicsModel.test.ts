// K4-CHARTS, решение владелицы 19.11.2026 «10 → а3»: мини-ряды «Новостей» остаются в ленте, полные графики тех же
// рядов — в «Аналитике». Тест до кода: данные полных графиков берутся из тех же ответов, что и мини-ряды
// (GET /lore/news/v2/dynamics и tasks.days из GET /lore/news/v2), без пересчёта на клиенте.
import { describe, expect, it } from 'vitest';
import { NEWS_DYNAMICS_FIXTURE, type NewsDynamicsResponse } from '../news/feed/dynamics';
import { NEWS_FIXTURE } from '../news/feed/fixture';
import type { NewsResponse } from '../news/feed/types';
import { burnByDay, dynamicsBlocks, DYNAMICS_BLOCKS } from './dynamicsModel';

const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v));

describe('ряды «Динамики» → полные графики', () => {
  it('блок на каждый ряд мини-карточек, в порядке ленты', () => {
    expect(dynamicsBlocks(NEWS_DYNAMICS_FIXTURE).map(b => b.id)).toEqual([...DYNAMICS_BLOCKS]);
  });

  it('столбик = значение ряда за период, подпись — метка периода сервера', () => {
    const b = dynamicsBlocks(NEWS_DYNAMICS_FIXTURE).find(x => x.id === 'tasks_created')!;
    expect(b.state).toBe('ok');
    expect(b.groups.map(g => g.key)).toEqual(['v']);
    expect(b.data.map(d => d.category)).toEqual(NEWS_DYNAMICS_FIXTURE.buckets.map(x => x.label));
    expect(b.data.map(d => d.values.v)).toEqual([9, 6, 8, 12, 10, 7, 15, 11, 9, 10, 12, 9]);
    expect(b.current).toBe('W46');
  });

  it('«Принято» — раскладка по типу двумя группами (ADR, решения)', () => {
    const b = dynamicsBlocks(NEWS_DYNAMICS_FIXTURE).find(x => x.id === 'accepted')!;
    expect(b.groups.map(g => g.key)).toEqual(['adr', 'decision']);
    expect(b.data[4].values).toEqual({ adr: 1, decision: 3 });
  });

  it('ряд короче периодов — недостающие периоды «нет данных» (null), а не 0', () => {
    const r = clone(NEWS_DYNAMICS_FIXTURE);
    r.metrics[0].series = [1, 2];
    const b = dynamicsBlocks(r).find(x => x.id === 'tasks_closed')!;
    expect(b.data[0].values.v).toBe(1);
    expect(b.data[5].values.v).toBeNull();
  });

  it('«не смогли посчитать» — состояние с причиной, а не пустой ряд', () => {
    const r: NewsDynamicsResponse = clone(NEWS_DYNAMICS_FIXTURE);
    r.metrics[3] = { id: 'releases', state: 'unavailable', value: null, series: null, reason: 'нет среза релизов', forbidden: true };
    const b = dynamicsBlocks(r).find(x => x.id === 'releases')!;
    expect(b.state).toBe('unavailable');
    expect(b.reason).toBe('нет среза релизов');
    expect(b.forbidden).toBe(true);
    expect(b.data).toEqual([]);
  });

  it('сервер не прислал ряд — блок всё равно есть и говорит «не смогли посчитать»', () => {
    const r = clone(NEWS_DYNAMICS_FIXTURE);
    r.metrics = r.metrics.filter(m => m.id !== 'sprints_closed');
    expect(dynamicsBlocks(r).find(x => x.id === 'sprints_closed')!.state).toBe('unavailable');
  });
});

describe('мини-график сгорания ленты → полный график по дням', () => {
  it('точка на каждый день периода; значение — burn дня из tasks.days', () => {
    const data = NEWS_FIXTURE as NewsResponse;
    const r = burnByDay(data);
    expect(r.state).toBe('ok');
    if (data.metrics.tasks.available) {
      const d0 = data.metrics.tasks.days[0];
      expect(r.points.find(p => p.x === Date.parse(`${d0.day_local}T00:00:00Z`))!.y).toBe(d0.burn);
    }
    const xs = r.points.map(p => p.x);
    expect([...xs].sort((a, b) => a - b)).toEqual(xs);
  });

  it('день без строки tasks.days — «нет данных» (null), не 0', () => {
    const data = clone(NEWS_FIXTURE) as NewsResponse;
    if (!data.metrics.tasks.available) throw new Error('фикстура без задач');
    const gone = data.metrics.tasks.days[1].day_local;
    data.metrics.tasks.days.splice(1, 1);
    data.matrix = { ...(data.matrix ?? { cols: [], rows: [] }), rows: [...(data.matrix?.rows ?? []), { day: gone } as never] } as NewsResponse['matrix'];
    const p = burnByDay(data).points.find(q => q.x === Date.parse(`${gone}T00:00:00Z`));
    expect(p?.y).toBeNull();
  });

  it('задачи не измеримы — состояние с причиной сервера', () => {
    const data = clone(NEWS_FIXTURE) as NewsResponse;
    data.metrics.tasks = { available: false, reason: 'нет истории задач' };
    expect(burnByDay(data)).toEqual({ state: 'unavailable', reason: 'нет истории задач', points: [] });
  });
});
