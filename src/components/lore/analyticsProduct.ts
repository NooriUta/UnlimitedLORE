// AN-10 (ADR-LORE-030): чистые агрегации вкладки «Аналитика → Продуктовый слой».
// Вынесены из компонента, потому что каждая — правило подсчёта, а не рендер:
// расхождение здесь искажает цифры молча, поэтому каждая покрыта юнит-тестом.
import type { LoreActorLoadRow, LoreInvestProfileRow, LoreVpAnalyticsRow } from '../../api/lore';

const ids = (xs: (string | null)[] | null | undefined): string[] =>
  (xs ?? []).filter((x): x is string => Boolean(x));

export interface VpFit {
  /** замкнутые клеймы (по рёбрам, не по тексту — D5) */
  closed: number;
  /** все клеймы корня (jobs + pains + gains) */
  total: number;
  /** человекочитаемые причины незамкнутости — раскрытие по клику на fit */
  missing: string[];
  /** «ценность доехала»: jobs, выполняемые shipped-сценариями (D17) */
  shippedJobs: number;
  claimedJobs: number;
}

/**
 * Fit корня = сколько заявленных jobs/pains/gains замкнуто сценариями.
 * Выгоду замыкает ТОЛЬКО измеримая доставка (delivered_measured_gain_ids,
 * ADR-032 §2): доставка без метрики в missing, не в closed.
 */
export function vpFit(r: LoreVpAnalyticsRow): VpFit {
  const cJobs = ids(r.claimed_job_ids), pJobs = new Set(ids(r.performed_job_ids));
  const cPains = ids(r.claimed_pain_ids), rPains = new Set(ids(r.relieved_pain_ids));
  const cGains = ids(r.claimed_gain_ids);
  const dGains = new Set(ids(r.delivered_gain_ids));
  const mGains = new Set(ids(r.delivered_measured_gain_ids));
  const missing: string[] = [];
  let closed = 0;
  for (const j of cJobs) { if (pJobs.has(j)) closed++; else missing.push(`работа ${j} — нет сценария (PERFORMS)`); }
  for (const p of cPains) { if (rPains.has(p)) closed++; else missing.push(`боль ${p} — не снята (RELIEVES)`); }
  for (const g of cGains) {
    if (mGains.has(g)) closed++;
    else if (dGains.has(g)) missing.push(`выгода ${g} — доставлена, но без метрики`);
    else missing.push(`выгода ${g} — не доставлена (DELIVERS)`);
  }
  const shippedSet = new Set(ids(r.shipped_job_ids));
  return {
    closed,
    total: cJobs.length + cPains.length + cGains.length,
    missing,
    shippedJobs: cJobs.filter(j => shippedSet.has(j)).length,
    claimedJobs: cJobs.length,
  };
}

/**
 * Слияние actor_load из нескольких проектных вызовов (режим «все проекты»).
 * Акторы проектные (D18) — одноимённые роли РАЗНЫХ проектов не склеиваются,
 * дедуп только по actor_id (один актор может вернуться дважды, если его
 * BELONGS_TO_PROJECT указывает на несколько проектов сразу).
 */
export function mergeActorLoad(perProject: LoreActorLoadRow[][]): LoreActorLoadRow[] {
  const seen = new Map<string, LoreActorLoadRow>();
  for (const rows of perProject) for (const r of rows) if (!seen.has(r.actor_id)) seen.set(r.actor_id, r);
  return [...seen.values()].sort((a, b) => (b.uc_count ?? 0) - (a.uc_count ?? 0));
}

export interface InvestShare {
  release: string;
  /** доли по классам, сумма = 1 (или 0 при пустом релизе) */
  uc: number; jtd: number; enb: number; none: number;
  /** true — считали по ШТУКАМ (у части задач effort_days нет), пометить честно */
  byCount: boolean;
  tasks: number;
}

/**
 * Инвестиционный профиль по релизам (срез D): доли uc/jtd/enb по effort_days;
 * если хоть у одной задачи релиза effort нет — фолбэк на счёт по штукам для
 * ВСЕГО релиза (смешивать веса и штуки в одной доле нельзя) с флагом byCount.
 */
export function investShares(rows: LoreInvestProfileRow[]): InvestShare[] {
  const byRelease = new Map<string, LoreInvestProfileRow[]>();
  for (const r of rows) {
    for (const rel of ids(r.release_ids)) {
      if (!byRelease.has(rel)) byRelease.set(rel, []);
      byRelease.get(rel)!.push(r);
    }
  }
  const out: InvestShare[] = [];
  for (const [release, tasks] of byRelease) {
    const byCount = tasks.some(tk => tk.effort_days == null);
    const weight = (tk: LoreInvestProfileRow) => (byCount ? 1 : (tk.effort_days ?? 0));
    const sum = { uc: 0, jtd: 0, enb: 0, none: 0 };
    for (const tk of tasks) {
      const cls = tk.work_class === 'uc' || tk.work_class === 'jtd' || tk.work_class === 'enb' ? tk.work_class : 'none';
      sum[cls] += weight(tk);
    }
    const total = sum.uc + sum.jtd + sum.enb + sum.none;
    out.push({
      release,
      uc: total ? sum.uc / total : 0,
      jtd: total ? sum.jtd / total : 0,
      enb: total ? sum.enb / total : 0,
      none: total ? sum.none / total : 0,
      byCount,
      tasks: tasks.length,
    });
  }
  // Свежие релизы сверху — semver-подобная сортировка по числовым сегментам.
  return out.sort((a, b) => {
    const num = (s: string) => s.replace(/^v/, '').split('.').map(n => parseInt(n, 10) || 0);
    const [x, y] = [num(a.release), num(b.release)];
    for (let i = 0; i < Math.max(x.length, y.length); i++) {
      const d = (y[i] ?? 0) - (x[i] ?? 0);
      if (d !== 0) return d;
    }
    return 0;
  });
}
