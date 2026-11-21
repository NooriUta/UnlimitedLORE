// Графики второй пачки (предложение 19.11.2026, «добавляй графики»): 3, 4, 5, 6, 8, 9, 11, 16 — блоки.
// Каждый блок сам грузит свой срез и говорит честно: сбой — причина и «Повторить»; то, что не стало
// точкой (нет даты, PR не довязаны, бэкфилл), — счётом словами; срез неполный — «показана часть».
import { useMemo } from 'react';
import { BarChart, HeatChart, LineChart, ScatterChart, useLoadState } from '@seidr/kit';
import { useAppT, type AppKey } from '../i18n';
import { chartLoader, chartState, ddmm, isPartial, rowsOfBody, type ChartLoader } from './chartCommon';
import { taskTimelines, type StatusVersionRow } from './flowModel';
import { Fold } from './TaskFlowCharts';
import { lastWeeks } from '../analytics/analyticsModel';
import {
  DECISION_FLOW, blockedWeekly, decisionFlow, gatePassShare, gatesHeat, mergeToProd, openAgeHistogram, releaseRhythm, wipByExecutor,
  type DecisionVersionRow, type GateRunRow, type ReleaseRow, type ShipRow, type WipRow,
} from './batch2Model';

export const B2_WEEKS = 12;

export interface BlockProps { load?: ChartLoader; fetchImpl?: typeof fetch; now?: number }

function useSlice(p: BlockProps, slice: string, params: Record<string, string> = {}) {
  const get = useMemo(() => chartLoader(p.load, p.fetchImpl), [p.load, p.fetchImpl]);
  const key = JSON.stringify(params);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const res = useLoadState(signal => get(slice, params, signal), [slice, key, get]);
  return { res, partial: res.data !== undefined && isPartial(res.data) };
}

function Partial({ on, slice }: { on: boolean; slice: string }) {
  const t = useAppT();
  return on ? <p className="an-partial" role="status">{t('analytics.partial', { slices: slice })}</p> : null;
}

const Note = ({ show, children }: { show: boolean; children: string }) => (show ? <p className="an-note">{children}</p> : null);

/** №3 — «Аналитика» → «Люди и агенты». */
export function WipBlock(p: BlockProps) {
  const t = useAppT();
  const { res, partial } = useSlice(p, 'all_tasks', { fields: 'task_uid,status_raw,executor_agent' });
  const w = useMemo(() => (res.data ? wipByExecutor(rowsOfBody<WipRow>(res.data), t('charts.wip.none'), t('charts.rest')) : null), [res.data, t]);
  return (
    <>
      <BarChart {...chartState(t, res)} title={t('charts.wip.title')} source="all_tasks · executor"
        groups={[{ key: 'active', label: t('charts.wip.active') }, { key: 'blocked', label: t('charts.wip.blocked') }]}
        data={w?.data ?? []} />
      <Partial on={partial} slice="all_tasks" />
      <Note show={!!w}>{t('charts.wip.note', { n: w?.total ?? 0, people: w?.people ?? 0 })}</Note>
    </>
  );
}

/** №5 — «Аналитика» → «Поток» и главная админки. */
export function BlockedBlock(p: BlockProps) {
  const t = useAppT();
  const { res, partial } = useSlice(p, 'task_status_versions');
  const today = p.now ?? Date.now();
  const b = useMemo(() => (res.data ? blockedWeekly(taskTimelines(rowsOfBody<StatusVersionRow>(res.data)), today, B2_WEEKS) : null), [res.data, today]);
  const none = b !== null && b.count.every(x => x.y === 0);
  return (
    <>
      {none
        ? <p className="adm-note" data-tone="inf" role="status" data-testid="blocked-none">{t('charts.blocked.none', { n: B2_WEEKS })}</p>
        : <LineChart {...chartState(t, res)} title={t('charts.blocked.title')} source="task_status_versions"
            series={b ? [{ key: 'count', label: t('charts.blocked.count'), points: b.count }, { key: 'days', label: t('charts.blocked.days'), points: b.meanDays, dashed: true }] : []} />}
      <Partial on={partial} slice="task_status_versions" />
      <Note show={!!b && !none}>{t('charts.blocked.note')}</Note>
    </>
  );
}

/** №4 — паспорт проекта. */
export function OpenAgeBlock(p: BlockProps & { project: string }) {
  const t = useAppT();
  const { res, partial } = useSlice(p, 'task_status_versions', { project: p.project });
  const today = p.now ?? Date.now();
  const h = useMemo(() => (res.data ? openAgeHistogram(taskTimelines(rowsOfBody<StatusVersionRow>(res.data)), today) : null), [res.data, today]);
  return (
    <>
      {h && h.open === 0
        ? <p className="an-note" role="status" data-testid="age-none">{t('charts.age.none')}</p>
        : <BarChart {...chartState(t, res)} title={t('charts.age.title')} source="task_status_versions" unit={t('analytics.tasksUnit')}
            groups={[{ key: 'n', label: t('analytics.tasks') }]}
            data={(h?.data ?? []).map(d => ({ category: t(`charts.age.${d.category}` as AppKey), values: d.values }))} />}
      <Partial on={partial} slice="task_status_versions" />
      <Note show={!!h && h.open > 0}>{t('charts.age.note', { open: h?.open ?? 0, old: h?.olderThanMonth ?? 0 })}</Note>
    </>
  );
}

/** №8 — лента релизов, паспорт проекта, «Аналитика» → «Релизы». */
export function ReleaseRhythmBlock(p: BlockProps & { project?: string }) {
  const t = useAppT();
  const { res, partial } = useSlice(p, 'releases', { fields: 'release_uid,git_tag,release_id,release_date,pr_count', ...(p.project ? { project: p.project } : {}) });
  const r = useMemo(() => (res.data ? releaseRhythm(rowsOfBody<ReleaseRow>(res.data)) : null), [res.data]);
  return (
    <>
      <ScatterChart {...chartState(t, res)} title={t('charts.rhythm.title')} source="releases · pr_count" unit={t('charts.rhythm.unit')} xTitle={t('charts.rhythm.x')} xLabel={ddmm}
        points={(r?.points ?? []).map(q => ({ x: q.x, y: q.y, label: q.label }))} />
      <Partial on={partial} slice="releases" />
      <Note show={!!r && r.medianGapDays !== null}>{t('charts.rhythm.gap', { d: r?.medianGapDays ?? 0 })}</Note>
      <Note show={!!r && r.noPrs > 0}>{t('charts.rhythm.noPrs', { n: r?.noPrs ?? 0 })}</Note>
      <Note show={!!r && r.undated > 0}>{t('charts.rhythm.undated', { n: r?.undated ?? 0 })}</Note>
    </>
  );
}

/** №9 — «Аналитика» → «Релизы». */
export function MergeToProdBlock(p: BlockProps) {
  const t = useAppT();
  const { res, partial } = useSlice(p, 'pr_ship_lag');
  const m = useMemo(() => (res.data ? mergeToProd(rowsOfBody<ShipRow>(res.data)) : null), [res.data]);
  return (
    <>
      <ScatterChart {...chartState(t, res)} title={t('charts.ship.title')} source="pr_ship_lag" unit={t('analytics.days')} xTitle={t('charts.rhythm.x')} xLabel={ddmm}
        points={(m?.points ?? []).map(q => ({ x: q.x, y: q.y, label: q.label }))} />
      <Partial on={partial} slice="pr_ship_lag" />
      <Note show={!!m && m.median !== null}>{t('charts.ship.median', { d: m?.median ?? 0 })}</Note>
      <Note show={!!m && m.noMerge > 0}>{t('charts.ship.noMerge', { n: m?.noMerge ?? 0 })}</Note>
      <Note show={!!m && m.mergedAfter > 0}>{t('charts.ship.after', { n: m?.mergedAfter ?? 0 })}</Note>
      <Note show={!!m && m.noRelease > 0}>{t('charts.ship.noRelease', { n: m?.noRelease ?? 0 })}</Note>
    </>
  );
}

/** №11 — «Аналитика» → «Архитектура». */
export function DecisionFlowBlock(p: BlockProps) {
  const t = useAppT();
  const { res, partial } = useSlice(p, 'decision_status_versions');
  const today = p.now ?? Date.now();
  const f = useMemo(() => (res.data ? decisionFlow(rowsOfBody<DecisionVersionRow>(res.data), today, B2_WEEKS) : null), [res.data, today]);
  return (
    <>
      <BarChart {...chartState(t, res)} title={t('charts.decisions.title')} source="decision_status_versions"
        groups={DECISION_FLOW.map(k => ({ key: k, label: t(`charts.decisions.${k}` as AppKey) }))} data={f?.data ?? []} />
      <Partial on={partial} slice="decision_status_versions" />
      <Note show={!!f && f.backfilled > 0}>{t('charts.decisions.backfilled', { n: f?.backfilled ?? 0 })}</Note>
    </>
  );
}

const sinceOf = (now: number, weeks: number) => new Date(lastWeeks(weeks, now)[0]).toISOString().slice(0, 10);

/** №16 — «Аналитика» → «Качество»: матрица гейт × неделя. */
export function GatesHeatBlock(p: BlockProps) {
  const t = useAppT();
  const today = p.now ?? Date.now();
  const { res, partial } = useSlice(p, 'qg_run_outcomes', { since: sinceOf(today, B2_WEEKS) });
  const h = useMemo(() => (res.data ? gatesHeat(rowsOfBody<GateRunRow>(res.data), today, B2_WEEKS) : null), [res.data, today]);
  return (
    <>
      <HeatChart {...chartState(t, res)} title={t('charts.gates.title')} source="qg_run_outcomes" unit="%"
        rows={h?.rows ?? []} cols={h?.cols ?? []} values={h?.values ?? []} />
      <Partial on={partial} slice="qg_run_outcomes" />
      <Note show={!!h}>{t('charts.gates.note')}</Note>
      <Note show={!!h && h.undated > 0}>{t('charts.undatedRows', { n: h?.undated ?? 0 })}</Note>
    </>
  );
}

/** №16 — паспорт гейта: доля PASS по неделям; рутина гейта — его код в нижнем регистре (QG-X → qg-x). */
export function GatePassBlock(p: BlockProps & { qgId: string }) {
  const t = useAppT();
  const today = p.now ?? Date.now();
  const routine = p.qgId.trim().toLowerCase();
  const { res, partial } = useSlice(p, 'qg_run_outcomes', { since: sinceOf(today, B2_WEEKS) });
  const g = useMemo(() => (res.data ? gatePassShare(rowsOfBody<GateRunRow>(res.data), routine, today, B2_WEEKS) : null), [res.data, routine, today]);
  return (
    <>
      {g && g.runs === 0
        ? <p className="an-note" role="status" data-testid="gate-pass-none">{t('charts.gates.noRuns', { routine, n: B2_WEEKS })}</p>
        : <LineChart {...chartState(t, res)} title={t('charts.gates.passTitle')} source={`qg_run_outcomes · ${routine}`} unit="%"
            series={g ? [{ key: 'pass', label: t('charts.gates.pass'), points: g.points }] : []} />}
      <Partial on={partial} slice="qg_run_outcomes" />
    </>
  );
}

/** Паспорт проекта: №4 возраст открытых задач и №8 ритм релизов, свёрнуто строкой. */
export function ProjectCharts(p: BlockProps & { slug: string }) {
  const t = useAppT();
  return (
    <Fold hint={t('charts.hint.project')}>{() => (
      <section className="an-grid pch__grid" data-testid="project-charts" aria-label={t('charts.toggle')}>
        <div className="an-block" data-block="age"><OpenAgeBlock {...p} project={p.slug} /></div>
        <div className="an-block" data-block="rhythm"><ReleaseRhythmBlock {...p} project={p.slug} /></div>
      </section>
    )}</Fold>
  );
}

/** Паспорт гейта: №16, свёрнуто строкой. */
export function GateCharts(p: BlockProps & { qgId: string }) {
  const t = useAppT();
  return (
    <Fold hint={t('charts.hint.gate')}>{() => (
      <section className="an-grid pch__grid" data-testid="gate-charts" aria-label={t('charts.toggle')}><div className="an-block" data-block="gate-pass"><GatePassBlock {...p} /></div></section>
    )}</Fold>
  );
}

/** Лента релизов: №8, свёрнуто строкой. */
export function ReleasesCharts(p: BlockProps) {
  const t = useAppT();
  return (
    <Fold hint={t('charts.hint.releases')}>{() => (
      <section className="an-grid pch__grid" data-testid="releases-charts" aria-label={t('charts.toggle')}><div className="an-block" data-block="rhythm"><ReleaseRhythmBlock {...p} /></div></section>
    )}</Fold>
  );
}
