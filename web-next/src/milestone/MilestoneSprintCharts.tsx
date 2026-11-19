// Графики вехи в паспорте (SPRINT_UXR_S13_KIT4/K4-CHARTS, вопрос 11 владелицы 19.11.2026: «графики по вехам были
// в v1» — перенести в v2 на графики kit). В v1 это Velocity и Burnup вкладки «Прогресс» с фильтром «Веха»
// (src/components/lore/LoreAnalytics.tsx); здесь — те же ряды по спринтам вехи, графиками kit BarChart и LineChart.
// Сгорание по задачам спринтов вехи (PU-27, MilestoneBurnLine) остаётся строкой над ними — оно про задачи,
// эти графики — про спринты.
// Честно: срез не прочитан — причина и «Повторить»; спринтов у вехи нет — словами; часть спринтов вехи не пришла
// или без даты — «показана часть N из M» у графиков.
import { useMemo, useState } from 'react';
import { BarChart, GameIcon, ICON_CANON, LineChart, rowsOf, useLoadState } from '@seidr/kit';
import { sliceFetcher } from '../api/loreSlice';
import { useAppT } from '../i18n';
import { milestoneSprintSeries, type MilestoneSprintRow } from './milestoneSprintSeries';

export type MilestoneChartsLoader = (slice: string, params: Record<string, string>, signal: AbortSignal) => Promise<unknown>;

export interface MilestoneSprintChartsProps {
  milestoneId: string;
  load?: MilestoneChartsLoader;
  fetchImpl?: typeof fetch;
  /** «Сегодня» (тесты). */
  now?: number;
  /**
   * Свёрнуто под вехой (телефон, «можно и на дорожную карту» 19.11): кнопка «Графики вехи», раскрытие — по нажатию.
   * До раскрытия срезы не грузятся.
   */
  fold?: boolean;
}

/** Спринты вехи из строки milestone_by_id: дыры (null) отбрасываются. */
function sprintIds(row: { direct_sprint_ids?: unknown } | undefined): string[] {
  const v = Array.isArray(row?.direct_sprint_ids) ? row!.direct_sprint_ids as unknown[] : [];
  return [...new Set(v.filter((x): x is string => typeof x === 'string' && x.trim() !== '').map(x => x.trim()))];
}

export function MilestoneSprintCharts({ fold, ...p }: MilestoneSprintChartsProps) {
  const t = useAppT();
  const [open, setOpen] = useState(false);
  if (!fold) return <ChartsBody {...p} />;
  return (
    <div className="ms-fold" data-testid="milestone-charts-fold">
      <button type="button" className="sk-btn ms-fold__btn" aria-expanded={open} onClick={() => setOpen(v => !v)}>
        <GameIcon slug={ICON_CANON.recAnalytics} size={14} />
        <span>{t('milestoneCharts.fold')}</span>
        <span aria-hidden="true">{open ? '▾' : '▸'}</span>
      </button>
      {open && <ChartsBody {...p} />}
    </div>
  );
}

function ChartsBody({ milestoneId, load, fetchImpl, now }: Omit<MilestoneSprintChartsProps, 'fold'>) {
  const t = useAppT();
  const fetcher = useMemo(() => sliceFetcher(fetchImpl ? { fetchImpl } : {}), [fetchImpl]);
  const get: MilestoneChartsLoader = load ?? ((s, p, signal) => fetcher(s, p, signal));
  const res = useLoadState(signal => Promise.all([
    get('milestone_by_id', { id: milestoneId, fields: 'milestone_id,direct_sprint_ids' }, signal),
    get('sprints', { fields: 'sprint_id,created_date,valid_from,done_date', limit: '1000' }, signal),
  ]), [milestoneId, load, fetcher]);
  const today = now ?? Date.now();

  const calc = useMemo(() => {
    if (!res.data) return null;
    const ids = sprintIds((rowsOf(res.data[0]) ?? [])[0] as { direct_sprint_ids?: unknown } | undefined);
    return { ids, s: milestoneSprintSeries(ids, (rowsOf(res.data[1]) ?? []) as MilestoneSprintRow[], today) };
  }, [res.data, today]);

  if (calc && calc.ids.length === 0) {
    return <p className="sprint-burn sprint-burn--empty" data-testid="milestone-charts-nosprints">{t('milestoneCharts.noSprints')}</p>;
  }
  const loading = res.state === 'loading';
  const error = res.state === 'error' || res.state === 'forbidden'
    ? t(res.state === 'forbidden' ? 'analytics.forbidden' : 'analytics.error', { reason: res.error instanceof Error ? res.error.message : String(res.error ?? '') })
    : undefined;
  const common = { loading, ...(error ? { error, onRetry: res.reload } : {}), ...(calc ? { shown: calc.s.shown, total: calc.s.total } : {}) };
  return (
    <section className="an-grid ms-charts" data-testid="milestone-charts" aria-label={t('milestoneCharts.title')}>
      <div className="an-block" data-block="ms-velocity">
        <BarChart {...common} title={t('milestoneCharts.velocity')} source="milestone_by_id · sprints"
          groups={[{ key: 'v', label: t('analytics.sprints') }]} data={calc?.s.velocity ?? []} />
      </div>
      <div className="an-block" data-block="ms-burnup">
        <LineChart {...common} title={t('milestoneCharts.burnup')} source="milestone_by_id · sprints" unit={t('analytics.sprints')}
          series={calc ? [{ key: 'scope', label: t('analytics.scope'), points: calc.s.burnup.scope }, { key: 'done', label: t('analytics.done'), points: calc.s.burnup.done }] : []} />
      </div>
    </section>
  );
}
