import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMartSlice } from '../../hooks/useMuninn';
import type { CapabilityRow, FactRow, RunRow } from '../../utils/muninnData';
import { buildCellSql, defaultRunId, f1CellBg, fmtF1, pivotMatrix } from '../../utils/muninnData';
import { MuninnSelect, Field, PanelMsg, ScreenTitle, SqlChip, SubstrateLink, ZerosBlock } from './shared';
import { MetricChip } from './NarrativeScreens';

export interface CasesPreset {
  run: string;
  substrate?: string;
  task?: string;
  hopKind?: string;
  caseId?: string;
}

/**
 * Screen 2 — cell matrix: substrate × task, avg(f1) for the selected run.
 * capability != 'none' rows form the averages; structural zeros are shown in
 * their own block below the table (anti-mixing rule). Cell click drills into
 * the Cases tab with the filters preset (number → cases → trace).
 */
export function MatrixScreen({ runs, subLabel, capabilities, onOpenCases }: {
  runs: RunRow[];
  subLabel: (id: string) => string;
  capabilities: CapabilityRow[] | null;
  onOpenCases?: (preset: CasesPreset) => void;
}) {
  const { t } = useTranslation();
  const [run, setRun] = useState(defaultRunId(runs));
  // raw facts, aggregated client-side (ArcadeDB multi-key GROUP BY is unreliable)
  const slice = useMartSlice<FactRow>('facts', run ? { run } : null);

  const runOptions = runs.map(r => ({
    value: r.run_id,
    label: `${r.run_id} (${r.model ?? '?'} · ${r.prompt ?? '?'})`,
  }));

  return (
    <div data-testid="bench-matrix">
      <ScreenTitle text={t('bench.secMatrix', 'Cell matrix — substrate × task, avg(F1)')}
                   hint={t('bench.secMatrixHint', 'click a cell to open its cases')} />
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 10, alignItems: 'center' }}>
        <Field label={t('bench.run', 'Run')}>
          <MuninnSelect value={run} onChange={setRun} options={runOptions} />
        </Field>
        {/* N2: the legend behind every number on this screen */}
        <MetricChip metric="exact_set" />
      </div>

      {slice.unavailable && <PanelMsg kind="info" text={t('bench.unavailable', 'Experiment mart is unavailable')} onRetry={slice.reload} />}
      {!slice.unavailable && slice.error && <PanelMsg kind="error" text={slice.error} onRetry={slice.reload} />}
      {!slice.unavailable && !slice.error && (slice.loading || !slice.rows) && (
        <PanelMsg kind="loading" text={t('bench.loading', 'Loading…')} />
      )}

      {!slice.unavailable && !slice.error && !slice.loading && slice.rows && (() => {
        const p = pivotMatrix(slice.rows);
        if (p.substrates.length === 0) return <PanelMsg kind="info" text={t('bench.noRows', 'No rows')} />;
        return (
          <>
            <div className="data-panel" style={{ overflowX: 'auto' }}>
              <table className="data-table" data-testid="bench-matrix-table">
                <thead>
                  <tr>
                    <th>{t('bench.substrate', 'Substrate')}</th>
                    {p.tasks.map(task => <th key={task} style={{ textAlign: 'right' }}>{task}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {p.substrates.map(sub => (
                    <tr key={sub}>
                      <td style={{ whiteSpace: 'nowrap' }}>
                        <SubstrateLink id={sub} label={subLabel(sub)} />
                        <span style={{ marginLeft: 6 }}>
                          <SqlChip sql={buildCellSql({ run, substrate: sub })}
                                   passport={`${sub} @ ${run} · metric=exact_set · S0 excluded`} />
                        </span>
                      </td>
                      {p.tasks.map(task => {
                        const cell = p.cells[sub]?.[task];
                        const zeroN = p.zeros.find(z => z.substrate_id === sub && z.key === task)?.n ?? 0;
                        const passport = cell
                          ? `n=${cell.n} · S0 excluded=${zeroN} · metric=exact_set`
                          : '';
                        return (
                          <td key={task}
                              style={{ textAlign: 'right', fontFamily: 'var(--mono)',
                                       background: f1CellBg(cell?.f1), whiteSpace: 'nowrap',
                                       cursor: cell && onOpenCases ? 'pointer' : undefined }}
                              title={passport}
                              onClick={cell && onOpenCases
                                ? () => onOpenCases({ run, substrate: sub, task })
                                : undefined}>
                            {fmtF1(cell?.f1)}
                            {cell && (
                              <span style={{ marginLeft: 4 }}>
                                <SqlChip sql={buildCellSql({ run, substrate: sub, task })} passport={passport} />
                              </span>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <ZerosBlock zeros={p.zeros} subLabel={subLabel} capabilities={capabilities} />
          </>
        );
      })()}
    </div>
  );
}
