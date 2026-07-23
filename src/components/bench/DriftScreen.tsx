import { Fragment, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMartSlice } from '../../hooks/useMuninn';
import type { DriftRow, RunRow, SnapshotRow, SubstrateRevAllRow, SubstrateRow, TaskRow } from '../../utils/muninnData';
import {
  REV_SERIES_SEP, buildCellSql, dedupe, f1CellBg, filterRevAtRunTime, fmtF1, groupRevChains,
  pivotDrift, short, splitRevSeries,
} from '../../utils/muninnData';
import { MuninnSelect, Field, PanelMsg, ScreenTitle, SqlChip, SubstrateLink } from './shared';

function shortSnapshot(id: string): string {
  // DALI_vCANONICAL_2026-06-10_2120 → vCANONICAL 06-10
  const m = /^DALI_(v\w+)_\d{4}-(\d{2}-\d{2})/.exec(id);
  return m ? `${m[1]} ${m[2]}` : id;
}

/**
 * Screen 4 — drift: substrate × task across snapshots (one column per snapshot).
 * The slice REQUIRES model+prompt pins — without them the four Round2 cells mix
 * (reading rule). Defaults are taken from the latest run.
 */
const EMPTY_REVS_PARAMS: Record<string, string> = {};

export function DriftScreen({ runs, snapshots, subLabel }: {
  runs: RunRow[];
  snapshots: SnapshotRow[];
  /** kept for call-site compat; the SCD2 register is the revision source now */
  substrates?: SubstrateRow[];
  subLabel: (id: string) => string;
}) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  // role labels (group headers) — task_id IS the role (role:r1, role:r2, …)
  const taskSlice = useMartSlice<TaskRow>('tasks', EMPTY_REVS_PARAMS);
  const roleLabel = useMemo(() => {
    const m = new Map<string, string>();
    for (const tk of taskSlice.rows ?? []) {
      m.set(tk.task_id, lang === 'en' ? (tk.label_en ?? tk.task_id) : (tk.label_ru ?? tk.task_id));
    }
    return m;
  }, [taskSlice.rows, lang]);
  const models = dedupe(runs.map(r => r.model ?? '').filter(Boolean));
  const prompts = dedupe(runs.map(r => r.prompt ?? '').filter(Boolean));
  const [model, setModel] = useState(runs[0]?.model ?? models[0] ?? '');
  const [prompt, setPrompt] = useState(runs[0]?.prompt ?? prompts[0] ?? '');

  const pinned = model !== '' && prompt !== '';
  const slice = useMartSlice<DriftRow>('drift', pinned ? { model, prompt } : null);
  const snapshotOrder = snapshots.map(s => s.snapshot_id);

  // I3 (Д-2): a fact is honest for the revision valid AT ITS RUN's moment —
  // comparing against the CURRENT revision hid the honest 562 r1 tierA facts
  // the moment the actor was promoted to r2-neg
  const revsAll = useMartSlice<SubstrateRevAllRow>('substrate_revs_all', EMPTY_REVS_PARAMS);
  const chains = useMemo(() => groupRevChains(revsAll.rows ?? []), [revsAll.rows]);
  const runStarts = useMemo(
    () => new Map(runs.map(r => [r.run_id, r.started_ts])),
    [runs],
  );
  const filtered = useMemo(
    () => filterRevAtRunTime(slice.rows ?? [], runStarts, chains),
    [slice.rows, runStarts, chains],
  );
  // Д-3: revision change is a legitimate axis — split multi-epoch actors
  // into separate series instead of collapsing the epochs into one row
  const seriesRows = useMemo(
    () => splitRevSeries(filtered.kept, filtered.keptRev),
    [filtered],
  );

  return (
    <div data-testid="bench-drift">
      <ScreenTitle text={t('bench.secDrift', 'Drift — substrate × task across parse snapshots')}
                   hint={t('bench.secDriftHint', '▲ gain / ▼ drop vs previous snapshot (Δ in tooltip); — = not measured under these pins')} />
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 10, alignItems: 'center' }}>
        <Field label={t('bench.model', 'Model')}>
          <MuninnSelect value={model} onChange={setModel}
                       options={models.map(m => ({ value: m, label: m }))} />
        </Field>
        <Field label={t('bench.prompt', 'Prompt')}>
          <MuninnSelect value={prompt} onChange={setPrompt}
                       options={prompts.map(p => ({ value: p, label: p }))} />
        </Field>
        <span style={{ fontSize: 'var(--fs-sm)', color: 'var(--t3)' }}>
          {t('bench.pickPins', 'Pick model and prompt — the drift slice must pin both')}
        </span>
      </div>

      {!pinned && <PanelMsg kind="info" text={t('bench.pickPins', 'Pick model and prompt')} />}
      {pinned && slice.unavailable && <PanelMsg kind="info" text={t('bench.unavailable', 'Experiment mart is unavailable')} onRetry={slice.reload} />}
      {pinned && !slice.unavailable && slice.error && <PanelMsg kind="error" text={slice.error} onRetry={slice.reload} />}
      {pinned && !slice.unavailable && !slice.error && (slice.loading || !slice.rows) && (
        <PanelMsg kind="loading" text={t('bench.loading', 'Loading…')} />
      )}

      {pinned && !slice.unavailable && !slice.error && !slice.loading && slice.rows && (() => {
        const p = pivotDrift(seriesRows, snapshotOrder);
        if (p.rows.length === 0) return <PanelMsg kind="info" text={t('bench.noRows', 'No rows')} />;
        // group by Role (task_id); within a role the pivot's substrate sort holds
        const byRole = new Map<string, typeof p.rows>();
        for (const row of p.rows) {
          if (!byRole.has(row.task_id)) byRole.set(row.task_id, []);
          byRole.get(row.task_id)!.push(row);
        }
        const roleOrder = [...byRole.keys()].sort((a, b) => a.localeCompare(b));
        return (
          <>
          {(filtered.staleExcluded > 0 || filtered.unresolvedExcluded > 0) && (
            <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--t3)', marginBottom: 6 }}
                 title={filtered.detail.join('\n')}>
              {t('bench.staleRevExcluded', 'excluded (I3): fact label ≠ revision valid at the run')}: {filtered.staleExcluded}
              {filtered.unresolvedExcluded > 0 && (
                <> · {t('bench.unresolvedRevExcluded', 'unresolvable (run w/o started_ts, Д-1)')}: {filtered.unresolvedExcluded}</>
              )}
              {' — '}{filtered.detail.join(' · ')}
            </div>
          )}
          <div className="data-panel" style={{ overflowX: 'auto' }}>
            <table className="data-table" data-testid="bench-drift-table">
              <thead>
                <tr>
                  {/* sticky: long drift scrolls must not lose the config from view */}
                  <th style={{ position: 'sticky', left: 0, zIndex: 1, background: 'var(--bg2)' }}>
                    {t('bench.substrate', 'Configuration')}
                  </th>
                  {p.snapshots.map(s => (
                    <th key={s} style={{ textAlign: 'right' }} title={s}>{shortSnapshot(s)}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {/* grouped by Role (task), configurations (substrates) within */}
                {roleOrder.map(role => (
                  <Fragment key={role}>
                    <tr data-testid={`drift-role-${role}`}>
                      <td colSpan={1 + p.snapshots.length}
                          style={{ position: 'sticky', left: 0, background: 'var(--bg3)', fontWeight: 600,
                                   padding: '6px 10px', borderTop: '2px solid var(--bd)' }}>
                        <span className="scope-tag" style={{ marginRight: 6, fontFamily: 'var(--mono)' }}>{short(role)}</span>
                        {roleLabel.get(role) ?? role}
                      </td>
                    </tr>
                    {(byRole.get(role) ?? []).map(row => {
                      // Д-3: series id is `substrate¦rev` when the actor has
                      // facts from more than one honest revision
                      const [baseId, rev] = row.substrate_id.split(REV_SERIES_SEP);
                      return (
                      <tr key={row.key}>
                        <td style={{ position: 'sticky', left: 0, zIndex: 1, background: 'var(--bg1)',
                                     whiteSpace: 'nowrap', paddingLeft: 20 }}>
                          <SubstrateLink id={baseId} label={subLabel(baseId)} />
                          {rev && <span className="scope-tag" style={{ marginLeft: 4 }}>{rev}</span>}
                          {/* RFC-3 row-level: whole-row SQL; rev pinned so an epoch
                              series reproduces its own epoch, not the blend */}
                          <span style={{ marginLeft: 4 }}>
                            <SqlChip sql={buildCellSql({ model, prompt, substrate: baseId, task: row.task_id, rev })}
                                     passport={`${baseId}${rev ? `·${rev}` : ''} · ${row.task_id} @ ${model}·${prompt} · I3=rev@run`} />
                          </span>
                        </td>
                        {p.snapshots.map((snap, i) => {
                          const cell = p.cells[row.key]?.[snap];
                          const prev = i > 0 ? p.cells[row.key]?.[p.snapshots[i - 1]] : undefined;
                          const delta = cell && prev ? cell.f1 - prev.f1 : undefined;
                          // RFC-3 passport: the rev pin keeps the I3 epoch honest
                          const passport = cell
                            ? `n=${cell.n} · metric=exact_set · I3: ревизия момента рана${rev ? ` (config_rev=${rev})` : ''}`
                            : '';
                          return (
                            <td key={snap} style={{ textAlign: 'right', fontFamily: 'var(--mono)',
                                                     background: f1CellBg(cell?.f1), whiteSpace: 'nowrap' }}
                                title={cell ? passport : t('bench.driftNoCell', 'not measured on this snapshot under these pins')}>
                              {fmtF1(cell?.f1)}
                              {delta !== undefined && Math.abs(delta) >= 0.0005 && (
                                <span style={{ fontSize: 'var(--fs-xs)', marginLeft: 4,
                                               color: delta > 0 ? 'var(--suc)' : 'var(--danger)' }}
                                      title={`Δ ${delta > 0 ? '+' : ''}${delta.toFixed(3)}`}>
                                  {delta > 0 ? '▲' : '▼'}
                                </span>
                              )}
                              {cell && (
                                <span style={{ marginLeft: 4 }}>
                                  <SqlChip sql={buildCellSql({ model, prompt, substrate: baseId,
                                                               task: row.task_id, snapshot: snap, rev })}
                                           passport={passport} />
                                </span>
                              )}
                            </td>
                          );
                        })}
                      </tr>
                      );
                    })}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
          </>
        );
      })()}
    </div>
  );
}
