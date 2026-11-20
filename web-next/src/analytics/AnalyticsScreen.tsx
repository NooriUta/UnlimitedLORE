// Раздел «Аналитика» v2 (SPRINT_UXR_S13_KIT4/K4-CHARTS, первая поставка). Владелица 16.11.2026: «ок по графикам»
// на прототип analytics-my-summary.html — каждый график это блок с кодом; блоки стоят во вкладках раздела
// и в «Моей сводке» (блоки разных вкладок на одном экране). Первая поставка — «Прогресс», «Поток» и
// «Моя сводка» с набором по умолчанию; правка набора человеком — вторая поставка. Вкладка — в адресе (?atab=).
import { useMemo } from 'react';
import {
  BarChart, LineChart, ScatterChart, Tabs, completeness, metaOf, rowsOf, useKitLang, useLoadState, useUrlParam,

} from '@seidr/kit';
import { sliceFetcher } from '../api/loreSlice';
import { appT, type AppKey } from '../i18n';
import { CycleBlock } from './CycleBlock';
import type { NewsSource } from '../news/feed/source';
import { newsSource as appNewsSource } from '../news/source';
import { AnalyticsDynamics } from './AnalyticsDynamics';
import { burnup, lastWeeks, leadTime, throughput, velocity, type DoneRow, type TaskRow } from './analyticsModel';

/** Срезы v1, из которых считаются блоки первой поставки. */
export const ANALYTICS_SLICES = ['sprint_done_dates', 'task_created_dates', 'task_done_dates'] as const;
const WEEKS = 12;

export type BlockId = 'velocity' | 'burnup' | 'throughput' | 'lead' | 'cycle';
type TabId = 'progress' | 'flow' | 'dynamics' | 'mine';
const TABS: TabId[] = ['progress', 'flow', 'dynamics', 'mine'];

/** Какие блоки во вкладке. «Моя сводка» по умолчанию — блоки обеих вкладок. */
export const TAB_BLOCKS: Record<Exclude<TabId, 'dynamics'>, BlockId[]> = {
  progress: ['velocity', 'burnup'],
  flow: ['throughput', 'lead', 'cycle'],
  mine: ['velocity', 'throughput', 'burnup', 'lead', 'cycle'],
};
const BLOCK_TAB: Record<BlockId, 'progress' | 'flow'> = { velocity: 'progress', burnup: 'progress', throughput: 'flow', lead: 'flow', cycle: 'flow' };
const isTab = (v: string | null): v is TabId => (TABS as (string | null)[]).includes(v);

export type AnalyticsLoader = (slice: string, signal: AbortSignal) => Promise<unknown>;

export interface AnalyticsScreenProps {
  /** Загрузка среза; не задана — /lore/slice приложения. */
  load?: AnalyticsLoader;
  /** «Сегодня» (тесты). */
  now?: number;
  /** Источник рядов «Новостей» для вкладки «Динамика»; не задан — тот же, что у экрана «Новости». */
  news?: NewsSource;
}

export function AnalyticsScreen({ load, now, news }: AnalyticsScreenProps) {
  const lang = useKitLang();
  const t = (k: AppKey, p?: Record<string, string | number>) => appT(lang, k, p);
  const [raw, setTab] = useUrlParam('atab');
  const tab: TabId = isTab(raw) ? raw : 'progress';
  const fetcher = useMemo(() => sliceFetcher(), []);
  const newsSource = news ?? appNewsSource;
  const loader: AnalyticsLoader = load ?? ((slice, signal) => fetcher(slice, {}, signal));
  const res = useLoadState(signal => Promise.all(ANALYTICS_SLICES.map(s => loader(s, signal))), [load]);
  const today = now ?? Date.now();

  const calc = useMemo(() => {
    if (!res.data) return null;
    const [sd, tc, td] = res.data;
    const sprintDone = (rowsOf(sd) ?? []) as DoneRow[];
    const created = (rowsOf(tc) ?? []) as TaskRow[];
    const done = (rowsOf(td) ?? []) as TaskRow[];
    const weeks = lastWeeks(WEEKS, today);
    const partial = ANALYTICS_SLICES.filter((_, i) => completeness(metaOf(res.data![i]), (rowsOf(res.data![i]) ?? []).length).kind !== 'complete');
    return { velocity: velocity(sprintDone, weeks), throughput: throughput(done, weeks), burnup: burnup(created, done, weeks), lead: leadTime(created, done, weeks), partial };
  }, [res.data, today]);

  const loading = res.state === 'loading';
  const error = res.state === 'error' || res.state === 'forbidden'
    ? t(res.state === 'forbidden' ? 'analytics.forbidden' : 'analytics.error', { reason: res.error instanceof Error ? res.error.message : String(res.error ?? '') })
    : undefined;
  const common = { loading, ...(error ? { error, onRetry: res.reload } : {}) };

  const block = (id: BlockId, showTab: boolean) => {
    const head = showTab ? <span className="an-block__src">{t(`analytics.tab.${BLOCK_TAB[id]}` as AppKey)}</span> : null;
    const body = (() => {
      switch (id) {
        case 'velocity': return <BarChart {...common} title={t('analytics.velocity')} source="sprint_done_dates" groups={[{ key: 'v', label: t('analytics.sprints') }]} data={calc?.velocity ?? []} />;
        case 'throughput': return <BarChart {...common} title={t('analytics.throughput')} source="task_done_dates" groups={[{ key: 't', label: t('analytics.tasks') }]} data={calc?.throughput ?? []} />;
        case 'burnup': return <LineChart {...common} title={t('analytics.burnup')} source="task_created_dates · task_done_dates" unit={t('analytics.tasksUnit')}
          series={calc ? [{ key: 'scope', label: t('analytics.scope'), points: calc.burnup.scope }, { key: 'done', label: t('analytics.done'), points: calc.burnup.done }] : []} />;
        case 'lead': return <ScatterChart {...common} title={t('analytics.lead')} source="task_created_dates · task_done_dates" unit={t('analytics.days')} xTitle={t('analytics.closed')}
          points={(calc?.lead ?? []).map(p => ({ x: p.x, y: p.y, label: p.id, id: p.id }))} />;
        // №1 (графики 19.11.2026): время цикла по версиям статуса — своя загрузка, только когда блок на экране.
        case 'cycle': return <CycleBlock {...(load ? { load: (sl: string, _p: Record<string, string>, sg: AbortSignal) => load(sl, sg) } : {})} weeks={WEEKS} now={today} />;
      }
    })();
    return <div key={id} className="an-block" data-block={id}>{head}{body}</div>;
  };

  return (
    <section className="an" aria-label={t('analytics.title')}>
      <Tabs variant="underline" label={t('analytics.title')} value={tab} onChange={v => setTab(v === 'progress' ? null : v)}
        items={TABS.map(id => ({ id, label: t(`analytics.tab.${id}` as AppKey) }))} />
      {tab === 'dynamics' ? <AnalyticsDynamics source={newsSource} /> : (
        <>
          <p className="an-lead">{t(tab === 'mine' ? 'analytics.mineLead' : 'analytics.lead12', { n: WEEKS })}</p>
          {calc && calc.partial.length > 0 && <p className="an-partial" role="status">{t('analytics.partial', { slices: calc.partial.join(', ') })}</p>}
          <div className="an-grid">{TAB_BLOCKS[tab].map(id => block(id, tab === 'mine'))}</div>
        </>
      )}
    </section>
  );
}

export default AnalyticsScreen;
