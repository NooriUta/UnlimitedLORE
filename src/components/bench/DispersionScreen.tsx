import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMartSlice } from '../../hooks/useMuninn';
import type { DispersionRow, SnapshotRow, TaskRow } from '../../utils/muninnData';
import { buildCellSql, fmtF1, groupDispersion } from '../../utils/muninnData';
import { MuninnSelect, DotStrip, Field, PanelMsg, ScreenTitle, SqlChip, SubstrateLink } from './shared';

/**
 * Screen 5 — replication dispersion: avg(f1) per run at a fixed snapshot+task.
 * The widest spread sorts first (e.g. C1 jumping 0.150↔0.550 on r1star while
 * C2/C3 stay put).
 */
export function DispersionScreen({ snapshots, tasks, subLabel, preset, onPinsChange }: {
  snapshots: SnapshotRow[];
  tasks: TaskRow[];
  subLabel: (id: string) => string;
  /** Д-6: пины приходят из URL (deep-link на конкретный срез) и пишутся обратно при смене */
  preset?: { snapshot?: string; task?: string };
  onPinsChange?: (pins: { snapshot: string; task: string }) => void;
}) {
  const { t } = useTranslation();
  const defaultSnapshot = snapshots.length > 0 ? snapshots[snapshots.length - 1].snapshot_id : '';
  const [snapshot, setSnapshot] = useState(preset?.snapshot ?? defaultSnapshot);
  const [task, setTask] = useState(
    preset?.task ?? (tasks.some(x => x.task_id === 'r1star') ? 'r1star' : (tasks[0]?.task_id ?? '')));
  const pickSnapshot = (v: string) => { setSnapshot(v); onPinsChange?.({ snapshot: v, task }); };
  const pickTask = (v: string) => { setTask(v); onPinsChange?.({ snapshot, task: v }); };

  const picked = snapshot !== '' && task !== '';
  const slice = useMartSlice<DispersionRow>('dispersion', picked ? { snapshot, task } : null);

  return (
    <div data-testid="bench-dispersion">
      <ScreenTitle text={t('bench.secDispersion', 'Replication dispersion — one point per run (mean F1), spread between runs')} />
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 10 }}>
        <Field label={t('bench.snapshot', 'Snapshot')}>
          <MuninnSelect value={snapshot} onChange={pickSnapshot}
                       options={snapshots.map(s => ({ value: s.snapshot_id, label: s.snapshot_id }))} />
        </Field>
        <Field label={t('bench.task', 'Task')}>
          <MuninnSelect value={task} onChange={pickTask}
                       options={tasks.map(x => ({ value: x.task_id, label: x.task_id }))} />
        </Field>
      </div>

      {!picked && <PanelMsg kind="info" text={t('bench.pickSnapshotTask', 'Pick snapshot and task')} />}
      {picked && slice.unavailable && <PanelMsg kind="info" text={t('bench.unavailable', 'Experiment mart is unavailable')} onRetry={slice.reload} />}
      {picked && !slice.unavailable && slice.error && <PanelMsg kind="error" text={slice.error} onRetry={slice.reload} />}
      {picked && !slice.unavailable && !slice.error && (slice.loading || !slice.rows) && (
        <PanelMsg kind="loading" text={t('bench.loading', 'Loading…')} />
      )}

      {picked && !slice.unavailable && !slice.error && !slice.loading && slice.rows && (() => {
        const groups = groupDispersion(slice.rows);
        if (groups.length === 0) return <PanelMsg kind="info" text={t('bench.noRows', 'No rows')} />;
        return (
          <div className="data-panel">
            <table className="data-table" data-testid="bench-dispersion-table">
              <thead>
                <tr>
                  <th>{t('bench.substrate', 'Substrate')}</th>
                  <th>F1 0…1</th>
                  <th style={{ textAlign: 'right' }}>min</th>
                  <th style={{ textAlign: 'right' }}>max</th>
                  <th style={{ textAlign: 'right' }}>spread</th>
                  <th>{t('bench.campaignRuns', 'Runs (cycles)')}</th>
                </tr>
              </thead>
              <tbody>
                {groups.map(g => (
                  <tr key={g.substrate_id}>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      <SubstrateLink id={g.substrate_id} label={subLabel(g.substrate_id)} />
                      {/* RFC-3: reproducing SQL from the same pins (I1: точка = ран) */}
                      <span style={{ marginLeft: 6 }}>
                        <SqlChip sql={buildCellSql({ snapshot, task, substrate: g.substrate_id })}
                                 passport={`${g.substrate_id} @ ${snapshot} · ${task} · I1: средний F1 на ран, spread = max−min`} />
                      </span>
                    </td>
                    <td><DotStrip points={g.points.map(p => ({ f1: p.f1, label: `${p.run_id} (n=${p.n})` }))} /></td>
                    <td style={{ textAlign: 'right', fontFamily: 'var(--mono)' }}>{fmtF1(g.min)}</td>
                    <td style={{ textAlign: 'right', fontFamily: 'var(--mono)' }}>{fmtF1(g.max)}</td>
                    <td style={{ textAlign: 'right', fontFamily: 'var(--mono)',
                                 color: g.spread > 0.1 ? 'var(--wrn)' : 'var(--t2)' }}>
                      {g.spread.toFixed(3)}
                    </td>
                    <td>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, alignItems: 'center' }}>
                        {g.points.map(p => (
                          <span key={p.run_id} style={{ whiteSpace: 'nowrap' }}>
                            <span className="scope-tag" title={`n=${p.n}`}>
                              {p.run_id}: {fmtF1(p.f1)}
                            </span>
                            {/* RFC-3: a point = one run's mean — the SQL reproduces it (I1) */}
                            <SqlChip sql={buildCellSql({ run: p.run_id, substrate: g.substrate_id, snapshot, task })}
                                     passport={`точка = avg(f1) одного рана (I1) · n=${p.n} · metric=exact_set`} />
                          </span>
                        ))}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      })()}
    </div>
  );
}
