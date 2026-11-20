// «Аналитика» → «Поток»: №1 время цикла (графики 19.11.2026, «добавляй графики»). Дней от первого входа
// задачи в работу до первого «к выкатке» или «сделано» — по версиям статуса SCD2 (task_status_versions),
// точки — задачи, закрытые за окно «Аналитики». Своя загрузка: «Прогресс» версии статуса не тянет.
import { useMemo } from 'react';
import { ScatterChart, useLoadState } from '@seidr/kit';
import { useAppT } from '../i18n';
import { chartLoader, chartState, isPartial, rowsOfBody, type ChartLoader } from '../charts/chartCommon';
import { cycleTimes, taskTimelines, type StatusVersionRow } from '../charts/flowModel';
import { lastWeeks } from './analyticsModel';
import { CYCLE_FEW } from '../charts/TaskFlowCharts';

export function CycleBlock({ load, weeks, now }: { load?: ChartLoader; weeks: number; now: number }) {
  const t = useAppT();
  const get = useMemo(() => chartLoader(load), [load]);
  const res = useLoadState(signal => get('task_status_versions', {}, signal), [get]);
  const from = lastWeeks(weeks, now)[0];
  const c = useMemo(() => (res.data ? cycleTimes(taskTimelines(rowsOfBody<StatusVersionRow>(res.data)), from) : null), [res.data, from]);
  return (
    <>
      <ScatterChart {...chartState(t, res)} title={t('charts.cycle.title')} source="task_status_versions" unit={t('analytics.days')} xTitle={t('analytics.closed')}
        points={(c?.points ?? []).map(p => ({ x: p.x, y: p.y, label: p.id }))} />
      {res.data !== undefined && isPartial(res.data) && <p className="an-partial" role="status">{t('analytics.partial', { slices: 'task_status_versions' })}</p>}
      {c && c.points.length > 0 && c.points.length < CYCLE_FEW && <p className="an-note">{t('charts.cycle.few', { n: c.points.length })}</p>}
      {c && c.skippedWork > 0 && <p className="an-note">{t('charts.cycle.skipped', { n: c.skippedWork })}</p>}
    </>
  );
}
