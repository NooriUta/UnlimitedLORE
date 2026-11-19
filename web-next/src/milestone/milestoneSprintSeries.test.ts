// K4-CHARTS, владелица 19.11.2026 (вопрос 11): «графики по вехам были в v1» — перенести в v2 на графики kit.
// В v1 (src/components/lore/LoreAnalytics.tsx, вкладка «Прогресс», фильтр «Веха») по спринтам вехи
// (direct_sprint_ids) строились Velocity — спринтов закрыто за неделю, и Burnup — scope (спринт появился)
// против done (спринт закрыт), накопленно по неделям. Тест до кода: те же ряды по спринтам вехи.
import { describe, expect, it } from 'vitest';
import { milestoneSprintSeries, type MilestoneSprintRow } from './milestoneSprintSeries';

const TODAY = Date.parse('2026-11-19T12:00:00Z'); // чт; неделя с пн 16.11
const ROWS: MilestoneSprintRow[] = [
  { sprint_id: 'S1', created_date: '2026-10-26', done_date: '2026-11-03' },
  { sprint_id: 'S2', created_date: '2026-10-28', done_date: '2026-11-17' },
  { sprint_id: 'S3', created_date: '2026-11-10', done_date: null },
  { sprint_id: 'OTHER', created_date: '2026-10-01', done_date: '2026-10-02' },
];

describe('графики вехи по её спринтам (перенос из v1)', () => {
  it('окно — от недели первого спринта вехи до текущей; чужие спринты не в счёте', () => {
    const s = milestoneSprintSeries(['S1', 'S2', 'S3'], ROWS, TODAY);
    expect(s.velocity.map(w => w.category)).toEqual(['26.10', '02.11', '09.11', '16.11']);
  });

  it('Velocity — спринтов вехи закрыто за неделю; неделя без закрытий — честный 0', () => {
    const s = milestoneSprintSeries(['S1', 'S2', 'S3'], ROWS, TODAY);
    expect(s.velocity.map(w => w.values.v)).toEqual([0, 1, 0, 1]);
  });

  it('Burnup — объём (спринт появился) и сделано (закрыт), накопленно на конец недели', () => {
    const s = milestoneSprintSeries(['S1', 'S2', 'S3'], ROWS, TODAY);
    expect(s.burnup.scope.map(p => p.y)).toEqual([2, 2, 3, 3]);
    expect(s.burnup.done.map(p => p.y)).toEqual([0, 1, 1, 2]);
  });

  it('спринт без даты появления берётся по valid_from; без обеих — «показана часть», а не ноль', () => {
    const rows: MilestoneSprintRow[] = [...ROWS, { sprint_id: 'S4', valid_from: '2026-11-11T08:00:00Z' }, { sprint_id: 'S5' }];
    const s = milestoneSprintSeries(['S1', 'S2', 'S3', 'S4', 'S5'], rows, TODAY);
    expect(s.burnup.scope[s.burnup.scope.length - 1].y).toBe(4);
    expect({ shown: s.shown, total: s.total }).toEqual({ shown: 4, total: 5 });
  });

  it('спринт вехи не пришёл в срезе (скоуп, страница) — тоже «показана часть»', () => {
    const s = milestoneSprintSeries(['S1', 'S2', 'S3', 'HIDDEN'], ROWS, TODAY);
    expect({ shown: s.shown, total: s.total }).toEqual({ shown: 3, total: 4 });
  });

  it('длинная история — последние 26 недель, накопленное учитывает и то, что раньше окна', () => {
    const rows: MilestoneSprintRow[] = [{ sprint_id: 'OLD', created_date: '2025-01-06', done_date: '2025-02-03' }, ...ROWS];
    const s = milestoneSprintSeries(['OLD', 'S1'], rows, TODAY);
    expect(s.velocity).toHaveLength(26);
    expect(s.burnup.scope[0].y).toBe(1);
    expect(s.burnup.done[0].y).toBe(1);
  });

  it('у спринтов вехи нет ни одной даты — рядов нет (график скажет «пусто»)', () => {
    const s = milestoneSprintSeries(['S5'], [{ sprint_id: 'S5' }], TODAY);
    expect(s.velocity).toEqual([]);
    expect(s.burnup.scope).toEqual([]);
  });
});
