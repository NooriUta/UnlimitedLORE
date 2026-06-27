import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMartSlice } from '../../hooks/useHuginn';
import type { FactRow, RunRow } from '../../utils/huginnData';
import { defaultRunId, formatSeconds, formatTokens, formatUsd, paretoPoints } from '../../utils/huginnData';
import { HuginnSelect, Field, PanelMsg, ScatterSVG, ScreenTitle } from './shared';

/**
 * Screen 7 — Pareto: avg(f1) vs total tokens and vs total wall-clock time per
 * substrate (capability != 'none' only — structural zeros are not "cheap wins").
 */
export function ParetoScreen({ runs, subLabel }: {
  runs: RunRow[];
  subLabel: (id: string) => string;
}) {
  const { t } = useTranslation();
  const [run, setRun] = useState(defaultRunId(runs));
  // raw facts, aggregated client-side (ArcadeDB multi-key GROUP BY is unreliable)
  const slice = useMartSlice<FactRow>('facts', run ? { run } : null);

  return (
    <div data-testid="bench-pareto">
      <ScreenTitle text={t('bench.secPareto', 'Pareto — avg(F1) vs total cost per substrate (structural zeros excluded)')} />
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 10 }}>
        <Field label={t('bench.run', 'Run')}>
          <HuginnSelect value={run} onChange={setRun}
                       options={runs.map(r => ({ value: r.run_id, label: `${r.run_id} (${r.model ?? '?'} · ${r.prompt ?? '?'})` }))} />
        </Field>
      </div>

      {slice.unavailable && <PanelMsg kind="info" text={t('bench.unavailable', 'Experiment mart is unavailable')} onRetry={slice.reload} />}
      {!slice.unavailable && slice.error && <PanelMsg kind="error" text={slice.error} onRetry={slice.reload} />}
      {!slice.unavailable && !slice.error && (slice.loading || !slice.rows) && (
        <PanelMsg kind="loading" text={t('bench.loading', 'Loading…')} />
      )}

      {!slice.unavailable && !slice.error && !slice.loading && slice.rows && (() => {
        const toPts = (axis: 'tokens' | 'elapsed' | 'cost') => paretoPoints(slice.rows ?? [], axis)
          .map(p => ({ x: p.x, f1: p.f1, label: subLabel(p.substrate_id) }));
        const tokenPts = toPts('tokens');
        if (tokenPts.length === 0) return <PanelMsg kind="info" text={t('bench.noRows', 'No rows')} />;
        return (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16 }}>
            <div className="analytics-card">
              <ScatterSVG points={tokenPts} xFmt={x => formatTokens(Math.round(x))}
                          title={t('bench.paretoTokens', 'avg(F1) vs total tokens')} />
            </div>
            <div className="analytics-card">
              <ScatterSVG points={toPts('elapsed')} xFmt={x => formatSeconds(x)}
                          title={t('bench.paretoElapsed', 'avg(F1) vs total time')} />
            </div>
            <div className="analytics-card">
              <ScatterSVG points={toPts('cost')} xFmt={x => formatUsd(x)}
                          title={t('bench.paretoCost', 'avg(F1) vs cost (PRICING = estimate)')} />
            </div>
          </div>
        );
      })()}
    </div>
  );
}
