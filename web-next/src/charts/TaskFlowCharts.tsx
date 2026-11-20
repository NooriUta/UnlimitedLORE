// Графики паспорта спринта и вехи (предложение 19.11.2026, «добавляй графики», первая пачка):
//   спринт — №2 накопительный поток (CFD) и №1 время цикла;
//   веха   — №7 прогноз (burnup + тренд до срока) и №2 CFD по задачам её спринтов.
// Одно правило свёрнутости для всех графиков паспорта (после #1632): на компьютере открыто сразу; на телефоне
// свёрнуто кнопкой «Графики ▸» — паспорт не начинается с графиков; раскрытие — в адресе (?pch=1).
// У вехи в том же блоке — Velocity и Burnup по спринтам вехи из #1632 (MilestoneSprintCharts), не дубль.
// Честно: сбой — причина и «Повторить»; данных мало — словами; срез неполный — «показана часть».
// Данные — срез task_status_versions (версии статуса SCD2), у вехи — по каждому её спринту отдельным
// запросом (фильтр sprint), а не вся история задач; прогноз — task_created_dates и task_done_dates.
import { useMemo, type ReactNode } from 'react';
import { GameIcon, ICON_CANON, LineChart, ScatterChart, rowsOf, useLoadState, useNarrow, useUrlParam } from '@seidr/kit';
import { useAppT, type AppKey } from '../i18n';
import { chartLoader, chartState, ddmm, isPartial, rowsOfBody, type ChartLoader } from './chartCommon';
import { cfdSeries, cycleTimes, FLOW_STACK, taskTimelines, type StatusVersionRow, type Timelines } from './flowModel';
import { milestoneForecast, TREND_WEEKS } from './forecastModel';
import { milestoneDue } from '../milestone/milestoneDue';
import { MilestoneSprintCharts } from '../milestone/MilestoneSprintCharts';
import type { TaskRow } from '../analytics/analyticsModel';

export const PCH_PARAM = 'pch';
/** Меньше стольких точек — о типичном времени цикла не судят. */
export const CYCLE_FEW = 5;

type T = ReturnType<typeof useAppT>;

/** Компьютер — графики сразу; телефон — кнопка «Графики ▸», раскрытие по адресу (?pch=1). narrow — тестам. */
export function Fold({ hint, narrow, children }: { hint: string; narrow?: boolean; children: () => ReactNode }) {
  const t = useAppT();
  const isNarrow = useNarrow(narrow);
  const [v, set] = useUrlParam(PCH_PARAM);
  if (!isNarrow) return <div className="pch" data-testid="pch">{children()}</div>;
  const open = v === '1';
  return (
    <div className="pch" data-testid="pch">
      <button type="button" className="sk-btn pch__toggle" aria-expanded={open} onClick={() => set(open ? null : '1', { replace: true })}>
        <GameIcon slug={ICON_CANON.recAnalytics} size={14} />
        <span>{t('charts.toggle')}</span> <span className="pch__hint">· {hint}</span>
        <span aria-hidden="true">{open ? '▾' : '▸'}</span>
      </button>
      {open && children()}
    </div>
  );
}

function CfdChart({ t, tl, today, common, partial }: { t: T; tl: Timelines | null; today: number; common: object; partial: boolean }) {
  const c = useMemo(() => (tl ? cfdSeries(tl, today) : null), [tl, today]);
  return (
    <div className="an-block" data-block="cfd">
      <LineChart {...common} title={t('charts.cfd.title')} source="task_status_versions" unit={t('analytics.tasksUnit')}
        {...(tl && tl.undated ? { shown: tl.tasks.size, total: tl.tasks.size + tl.undated } : {})}
        series={c ? [...FLOW_STACK].reverse().map(b => ({ key: b, label: t(`charts.band.${b}` as AppKey), points: c.x.map((x, i) => ({ x, y: c.stack[b][i] })) })) : []} />
      {c && c.x.length > 0 && <p className="an-note">{t('charts.cfd.note')} {t(c.step === 'day' ? 'charts.cfd.byDay' : 'charts.cfd.byWeek')}</p>}
      {partial && <p className="an-partial" role="status">{t('analytics.partial', { slices: 'task_status_versions' })}</p>}
    </div>
  );
}

function CycleChart({ t, tl, common }: { t: T; tl: Timelines | null; common: object }) {
  const c = useMemo(() => (tl ? cycleTimes(tl) : null), [tl]);
  return (
    <div className="an-block" data-block="cycle">
      <ScatterChart {...common} title={t('charts.cycle.title')} source="task_status_versions" unit={t('analytics.days')} xTitle={t('analytics.closed')}
        points={(c?.points ?? []).map(p => ({ x: p.x, y: p.y, label: p.id }))} />
      {c && c.points.length > 0 && c.points.length < CYCLE_FEW && <p className="an-note" data-testid="cycle-few">{t('charts.cycle.few', { n: c.points.length })}</p>}
      {c && c.skippedWork > 0 && <p className="an-note">{t('charts.cycle.skipped', { n: c.skippedWork })}</p>}
      {c && c.inWork > 0 && <p className="an-note">{t('charts.cycle.inWork', { n: c.inWork })}</p>}
    </div>
  );
}

export interface SprintChartsProps { sprintId: string; load?: ChartLoader; fetchImpl?: typeof fetch; now?: number; narrow?: boolean }

export function SprintCharts(p: SprintChartsProps) {
  const t = useAppT();
  return <Fold hint={t('charts.hint.sprint')} {...(p.narrow !== undefined ? { narrow: p.narrow } : {})}>{() => <SprintChartsBody {...p} />}</Fold>;
}

function SprintChartsBody({ sprintId, load, fetchImpl, now }: SprintChartsProps) {
  const t = useAppT();
  const get = useMemo(() => chartLoader(load, fetchImpl), [load, fetchImpl]);
  const res = useLoadState(signal => get('task_status_versions', { sprint: sprintId }, signal), [sprintId, get]);
  const today = now ?? Date.now();
  const tl = useMemo(() => (res.data ? taskTimelines(rowsOfBody<StatusVersionRow>(res.data), uid => uid.startsWith(`${sprintId}/`)) : null), [res.data, sprintId]);
  const common = chartState(t, res);
  const partial = res.data !== undefined && isPartial(res.data);
  return (
    <section className="an-grid pch__grid" data-testid="sprint-charts" aria-label={t('charts.toggle')}>
      <CfdChart t={t} tl={tl} today={today} common={common} partial={partial} />
      <CycleChart t={t} tl={tl} common={common} />
    </section>
  );
}

export interface MilestoneChartsProps { milestoneId: string; load?: ChartLoader; fetchImpl?: typeof fetch; now?: number; narrow?: boolean }

export function MilestoneCharts(p: MilestoneChartsProps) {
  const t = useAppT();
  return (
    <Fold hint={t('charts.hint.milestone')} {...(p.narrow !== undefined ? { narrow: p.narrow } : {})}>{() => (
      <>
        {/* #1632: Velocity и Burnup по спринтам вехи — первыми; ниже — прогноз и поток по задачам. */}
        <MilestoneSprintCharts milestoneId={p.milestoneId} {...(p.load ? { load: p.load } : {})} {...(p.fetchImpl ? { fetchImpl: p.fetchImpl } : {})} {...(p.now !== undefined ? { now: p.now } : {})} />
        <MilestoneChartsBody {...p} />
      </>
    )}</Fold>
  );
}

const sprintIds = (row: { direct_sprint_ids?: unknown } | undefined) => {
  const v = Array.isArray(row?.direct_sprint_ids) ? (row!.direct_sprint_ids as unknown[]) : [];
  return [...new Set(v.filter((x): x is string => typeof x === 'string' && x.trim() !== '').map(x => x.trim()))].sort();
};

function MilestoneChartsBody({ milestoneId, load, fetchImpl, now }: MilestoneChartsProps) {
  const t = useAppT();
  const get = useMemo(() => chartLoader(load, fetchImpl), [load, fetchImpl]);
  const today = now ?? Date.now();
  const res = useLoadState(async signal => {
    const ms = await get('milestone_by_id', { id: milestoneId, fields: 'milestone_id,date_display,direct_sprint_ids' }, signal);
    const row = (rowsOf(ms) ?? [])[0] as { direct_sprint_ids?: unknown; date_display?: unknown } | undefined;
    const ids = sprintIds(row);
    if (!ids.length) return { ids, when: '', versions: [] as unknown[], created: null, done: null };
    const [versions, created, done] = await Promise.all([
      Promise.all(ids.map(id => get('task_status_versions', { sprint: id }, signal))),
      get('task_created_dates', {}, signal),
      get('task_done_dates', {}, signal),
    ]);
    return { ids, when: typeof row?.date_display === 'string' ? row.date_display : '', versions, created, done };
  }, [milestoneId, get]);

  const calc = useMemo(() => {
    const d = res.data;
    if (!d || !d.ids.length) return null;
    const set = new Set(d.ids);
    const inScope = (uid: string) => set.has(uid.slice(0, uid.indexOf('/')));
    const tl = taskTimelines(d.versions.flatMap(b => rowsOfBody<StatusVersionRow>(b)), inScope);
    const { due, frozen } = milestoneDue(d.when);
    const fc = milestoneForecast({ created: rowsOfBody<TaskRow>(d.created), done: rowsOfBody<TaskRow>(d.done), inScope, today, due, frozen });
    const partial = [...d.versions, d.created, d.done].some(isPartial);
    return { tl, fc, due, partial };
  }, [res.data, today]);

  if (res.data && res.data.ids.length === 0) {
    return <p className="sprint-burn sprint-burn--empty" data-testid="pch-nosprints">{t('charts.noSprints')}</p>;
  }
  const common = chartState(t, res);
  const fc = calc?.fc;
  const rate = fc ? fc.rate.toFixed(1).replace('.', ',') : '';
  const verdict = !fc ? null : (() => {
    const v = fc.verdict;
    switch (v.kind) {
      case 'ok': return t('charts.forecast.ok', { rate, date: ddmm(v.finish!), weeks: v.weeks! });
      case 'late': return t('charts.forecast.late', { rate, date: ddmm(v.finish!), weeks: v.weeks!, due: calc!.due ? ddmm(Date.parse(`${calc!.due}T00:00:00Z`)) : '' });
      case 'nodue': return t('charts.forecast.nodue', { rate, date: ddmm(v.finish!) });
      case 'few': return t('charts.forecast.few', { n: TREND_WEEKS });
      default: return t(`charts.forecast.${v.kind}` as AppKey);
    }
  })();
  return (
    <section className="an-grid pch__grid" data-testid="milestone-flow-charts" aria-label={t('charts.toggle')}>
      <div className="an-block" data-block="forecast">
        <LineChart {...common} title={t('charts.forecast.title')} source="task_created_dates · task_done_dates" unit={t('analytics.tasksUnit')}
          series={fc ? [
            { key: 'scope', label: t('analytics.scope'), points: fc.scope },
            { key: 'done', label: t('analytics.done'), points: fc.done },
            ...(fc.trend.length ? [{ key: 'trend', label: t('charts.forecast.trend'), points: fc.trend, dashed: true }] : []),
            ...(fc.need.length ? [{ key: 'need', label: t('charts.forecast.need'), points: fc.need, dashed: true }] : []),
          ] : []} />
        {verdict && <p className="an-note pch__verdict" data-testid="forecast-verdict" data-kind={fc!.verdict.kind}>{verdict}</p>}
      </div>
      <CfdChart t={t} tl={calc?.tl ?? null} today={today} common={common} partial={calc?.partial ?? false} />
    </section>
  );
}
