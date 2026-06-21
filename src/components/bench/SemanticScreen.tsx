import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMartSlice } from '../../hooks/useBench';
import type { CapabilityRow, FactRow, RunRow } from '../../utils/benchData';
import { buildCellSql, defaultRunId, f1CellBg, fmtF1, pivotSemantic } from '../../utils/benchData';
import { BenchSelect, Field, PanelMsg, ScreenTitle, SqlChip, SubstrateLink, ZerosBlock } from './shared';
import { MetricChip } from './NarrativeScreens';
import type { CasesPreset } from './MatrixScreen';

/**
 * Screen 3 — the semantic matrix: substrate × (level · hop_kind), the main
 * analytical cut (e.g. C1 table·transitive_set = 1.000 vs column·direct = 0.813).
 */
export function SemanticScreen({ runs, subLabel, capabilities, onOpenCases }: {
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
    <div data-testid="bench-semantic">
      <ScreenTitle text={t('bench.secSemantic', 'Semantic matrix — substrate × (level · hop kind), avg(F1)')}
                   hint={t('bench.secSemanticHint', 'the main analytical cut; click a cell to open its cases')} />
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 10, alignItems: 'center' }}>
        <Field label={t('bench.run', 'Run')}>
          <BenchSelect value={run} onChange={setRun} options={runOptions} />
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
        const p = pivotSemantic(slice.rows);
        if (p.substrates.length === 0) return <PanelMsg kind="info" text={t('bench.noRows', 'No rows')} />;
        return (
          <>
            <div className="data-panel" style={{ overflowX: 'auto' }}>
              <table className="data-table" data-testid="bench-semantic-table">
                <thead>
                  <tr>
                    <th>{t('bench.substrate', 'Substrate')}</th>
                    {p.columns.map(col => (
                      <th key={col.key} style={{ textAlign: 'right' }}>
                        <div style={{ color: 'var(--t3)' }}>{col.level}</div>
                        <div>{col.hop}</div>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {p.substrates.map(sub => (
                    <tr key={sub}>
                      <td style={{ whiteSpace: 'nowrap' }}>
                        <SubstrateLink id={sub} label={subLabel(sub)} />
                        {/* RFC-3: reproducing SQL from the same pins */}
                        <span style={{ marginLeft: 6 }}>
                          <SqlChip sql={buildCellSql({ run, substrate: sub })}
                                   passport={`${sub} @ ${run} · level·hop клетки · metric=exact_set`} />
                        </span>
                      </td>
                      {p.columns.map(col => {
                        const cell = p.cells[sub]?.[col.key];
                        // RFC-3 passport: n · S0 excluded · metric pin
                        const zeroN = p.zeros.find(z => z.substrate_id === sub && z.key === col.key)?.n ?? 0;
                        const passport = cell
                          ? `n=${cell.n} · S0 excluded=${zeroN} · metric=exact_set`
                          : '';
                        return (
                          <td key={col.key}
                              style={{ textAlign: 'right', fontFamily: 'var(--mono)',
                                       background: f1CellBg(cell?.f1), whiteSpace: 'nowrap',
                                       cursor: cell && onOpenCases ? 'pointer' : undefined }}
                              title={passport}
                              onClick={cell && onOpenCases
                                ? () => onOpenCases({ run, substrate: sub, hopKind: col.hop })
                                : undefined}>
                            {fmtF1(cell?.f1)}
                            {cell && (
                              <span style={{ marginLeft: 4 }}>
                                <SqlChip sql={buildCellSql({ run, substrate: sub, level: col.level, hop: col.hop })}
                                         passport={passport} />
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
