// №13 «действия агентов по дням» (админка → Журнал) и №14 «отказы MCP по кодам» (админка → MCP),
// предложение 19.11.2026 «добавляй графики». Срез agent_action_points (админский, как журнал) за период.
// Период (?adm-chp=7|30|90, по умолчанию 30) и разрез №13 (?adm-chby=caller|client) — в адресе, общие
// для обоих экранов. Честно: нет прав / сбой — словами и «Повторить»; строк нет — словами;
// выдача обрезана потолком — «показана часть»; строки без момента — счётом.
import { useMemo } from 'react';
import { BarChart, LineChart, useLoadState, useUrlParam } from '@seidr/kit';
import { useAppT, type AppKey } from '../i18n';
import { chartLoader, chartState, isPartial, rowsOfBody, type ChartLoader } from './chartCommon';
import { actionsOverTime, failuresByCode, parseActionPoints, periodBuckets, REST } from './agentModel';

export const PERIODS = ['7', '30', '90'] as const;
const DEFAULT_PERIOD = '30';

export interface AgentChartProps { load?: ChartLoader; fetchImpl?: typeof fetch; now?: number }

function usePeriod(): [number, (v: string) => void] {
  const [raw, set] = useUrlParam('adm-chp');
  const p = (PERIODS as readonly string[]).includes(raw ?? '') ? raw! : DEFAULT_PERIOD;
  return [Number(p), v => set(v === DEFAULT_PERIOD ? null : v, { replace: true })];
}

function useAgentPoints({ load, fetchImpl, now }: AgentChartProps, days: number) {
  const get = useMemo(() => chartLoader(load, fetchImpl), [load, fetchImpl]);
  const today = now ?? Date.now();
  const since = new Date(periodBuckets(days, today).starts[0]).toISOString().slice(0, 10);
  const res = useLoadState(signal => get('agent_action_points', { since }, signal), [since, get]);
  const parsed = useMemo(() => (res.data ? parseActionPoints(rowsOfBody<Record<string, unknown>>(res.data)) : null), [res.data]);
  return { res, parsed, today, partial: res.data !== undefined && isPartial(res.data) };
}

function Chips<V extends string>({ label, items, value, onPick }: { label: string; items: { v: V; text: string }[]; value: V; onPick: (v: V) => void }) {
  return (
    <div className="adm-chips" role="group" aria-label={label}>
      {items.map(i => (
        <button key={i.v} type="button" className="adm-chip" aria-pressed={i.v === value} onClick={() => onPick(i.v)}>{i.text}</button>
      ))}
    </div>
  );
}

function PeriodChips({ days, set }: { days: number; set: (v: string) => void }) {
  const t = useAppT();
  return <Chips label={t('charts.period')} value={String(days)} onPick={set}
    items={PERIODS.map(p => ({ v: p as string, text: t(`charts.period.${p}` as AppKey) }))} />;
}

export function AgentActionsChart(props: AgentChartProps) {
  const t = useAppT();
  const [days, setDays] = usePeriod();
  const [byRaw, setBy] = useUrlParam('adm-chby');
  const by = byRaw === 'client' ? 'client' : 'caller';
  const { res, parsed, today, partial } = useAgentPoints(props, days);
  const s = useMemo(() => (parsed ? actionsOverTime(parsed.points, days, today, by) : null), [parsed, days, today, by]);
  const common = chartState(t, res);
  return (
    <div className="an-block adm-chart" data-testid="adm-actions-chart">
      <div className="adm-chart__bar">
        <PeriodChips days={days} set={setDays} />
        <Chips label={t('charts.by')} value={by} onPick={v => setBy(v === 'caller' ? null : v, { replace: true })}
          items={[{ v: 'caller', text: t('charts.by.caller') }, { v: 'client', text: t('charts.by.client') }]} />
      </div>
      {s && s.total === 0 && !common.error
        ? <p className="adm-note" data-tone="inf" role="status" data-testid="adm-actions-none">{t('charts.actions.none')}</p>
        : <LineChart {...common} title={t(s?.buckets.step === 'week' ? 'charts.actions.titleWeek' : 'charts.actions.title')} source="agent_action_points"
            series={(s?.series ?? []).map(x => ({ key: x.key, label: x.key === REST ? t('charts.rest') : x.key, points: x.points }))} />}
      {partial && <p className="an-partial" role="status">{t('analytics.partial', { slices: 'agent_action_points' })}</p>}
      <p className="an-note">{t('charts.actions.note')}</p>
      {parsed && parsed.undated > 0 && <p className="an-note">{t('charts.undatedRows', { n: parsed.undated })}</p>}
    </div>
  );
}

export function McpFailureCodesChart(props: AgentChartProps) {
  const t = useAppT();
  const [days, setDays] = usePeriod();
  const { res, parsed, today, partial } = useAgentPoints(props, days);
  const f = useMemo(() => (parsed ? failuresByCode(parsed.points, days, today) : null), [parsed, days, today]);
  const common = chartState(t, res);
  return (
    <div className="an-block adm-chart" data-testid="adm-mcp-codes-chart">
      <div className="adm-chart__bar"><PeriodChips days={days} set={setDays} /></div>
      {f && f.total === 0 && !common.error
        ? <p className="adm-note" data-tone="inf" role="status" data-testid="adm-mcp-codes-none">{t('charts.fails.none')}</p>
        : <BarChart {...common} title={t('charts.fails.title')} source="agent_action_points"
            groups={(f?.codes ?? []).map(c => ({ key: c, label: c === REST ? t('charts.rest') : c }))} data={f?.data ?? []} />}
      {partial && <p className="an-partial" role="status">{t('analytics.partial', { slices: 'agent_action_points' })}</p>}
      <p className="an-note">{t('charts.fails.note')}</p>
    </div>
  );
}
