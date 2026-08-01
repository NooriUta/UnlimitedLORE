import { describe, expect, it } from 'vitest';
import { investShares, mergeActorLoad, vpFit } from './analyticsProduct';
import type { LoreActorLoadRow, LoreInvestProfileRow, LoreVpAnalyticsRow } from '../../api/lore';

const vpRow = (over: Partial<LoreVpAnalyticsRow>): LoreVpAnalyticsRow => ({
  uc_id: 'FEAT-X', title: null, status: null, shipped_at: null, goal_level: 'cloud',
  milestone_id: null,
  claimed_job_ids: [], claimed_pain_ids: [], claimed_gain_ids: [],
  performed_job_ids: [], relieved_pain_ids: [], delivered_gain_ids: [],
  delivered_measured_gain_ids: [], shipped_job_ids: [], actor_ids: [],
  ...over,
});

describe('vpFit', () => {
  it('считает fit 5/6 как у FEAT-GITCYCLE из прототипа: выгода без метрики не замыкает', () => {
    const f = vpFit(vpRow({
      claimed_job_ids: ['J1', 'J2'], performed_job_ids: ['J1', 'J2'],
      claimed_pain_ids: ['P1', 'P2', 'P3'], relieved_pain_ids: ['P1', 'P2', 'P3'],
      claimed_gain_ids: ['G1', 'G2'],
      delivered_gain_ids: ['G1', 'G2'], delivered_measured_gain_ids: ['G1'],
    }));
    expect(f.closed).toBe(6);
    expect(f.total).toBe(7);
    expect(f.missing).toEqual(['выгода G2 — доставлена, но без метрики']);
  });

  it('различает «не доставлена» и «доставлена без метрики»', () => {
    const f = vpFit(vpRow({ claimed_gain_ids: ['G1'], delivered_gain_ids: [], delivered_measured_gain_ids: [] }));
    expect(f.missing).toEqual(['выгода G1 — не доставлена (DELIVERS)']);
  });

  it('«ценность доехала» — только jobs shipped-сценариев (D17)', () => {
    const f = vpFit(vpRow({ claimed_job_ids: ['J1', 'J2'], performed_job_ids: ['J1', 'J2'], shipped_job_ids: ['J1'] }));
    expect(f.shippedJobs).toBe(1);
    expect(f.claimedJobs).toBe(2);
  });

  it('null-элементы графовых траверсов отфильтровываются, пустой корень — fit 0/0', () => {
    const f = vpFit(vpRow({ claimed_job_ids: [null], performed_job_ids: null }));
    expect(f.total).toBe(0);
    expect(f.missing).toEqual([]);
  });
});

describe('mergeActorLoad', () => {
  const row = (actor_id: string, uc_count: number): LoreActorLoadRow => ({
    actor_id, name: actor_id, kind: 'human-role', projects: [], uc_ids: [],
    uc_count, primary_count: null, supporting_count: null,
  });

  it('дедуп по actor_id (актор двух проектов возвращается из обоих вызовов один раз)', () => {
    const merged = mergeActorLoad([[row('A', 3)], [row('A', 3), row('B', 0)]]);
    expect(merged.map(r => r.actor_id)).toEqual(['A', 'B']);
  });

  it('сортирует по убыванию нагрузки — мёртвые роли (0 UC) оказываются внизу', () => {
    const merged = mergeActorLoad([[row('dead', 0), row('busy', 5)]]);
    expect(merged[0].actor_id).toBe('busy');
  });
});

describe('investShares', () => {
  const task = (over: Partial<LoreInvestProfileRow>): LoreInvestProfileRow => ({
    task_uid: 'S/T1', work_class: 'uc', task_type: 'dev', sprint_id: 'S',
    status_raw: null, effort_days: 1, release_ids: ['v1.0.0'], ...over,
  });

  it('делит по effort_days, когда он есть у всех задач релиза', () => {
    const [share] = investShares([
      task({ task_uid: 'S/T1', work_class: 'uc', effort_days: 3 }),
      task({ task_uid: 'S/T2', work_class: 'jtd', effort_days: 1 }),
    ]);
    expect(share.uc).toBeCloseTo(0.75);
    expect(share.jtd).toBeCloseTo(0.25);
    expect(share.byCount).toBe(false);
  });

  it('фолбэк на счёт по штукам для ВСЕГО релиза, если у части задач effort нет — с честным флагом', () => {
    const [share] = investShares([
      task({ task_uid: 'S/T1', work_class: 'uc', effort_days: 10 }),
      task({ task_uid: 'S/T2', work_class: 'enb', effort_days: null }),
    ]);
    expect(share.byCount).toBe(true);
    expect(share.uc).toBeCloseTo(0.5);
    expect(share.enb).toBeCloseTo(0.5);
  });

  it('work_class=null — легальная доля none (неклассифицированное тоже сигнал)', () => {
    const [share] = investShares([task({ work_class: null })]);
    expect(share.none).toBe(1);
  });

  it('задача двух релизов входит в долю каждого; сортировка — свежие релизы сверху', () => {
    const shares = investShares([
      task({ release_ids: ['v1.0.9', 'v1.0.10'] }),
      task({ task_uid: 'S/T2', release_ids: ['v1.0.10'] }),
    ]);
    expect(shares.map(s => s.release)).toEqual(['v1.0.10', 'v1.0.9']);
    expect(shares[0].tasks).toBe(2);
    expect(shares[1].tasks).toBe(1);
  });
});
