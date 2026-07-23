import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMartSlice } from '../../hooks/useMuninn';
import type { CaseRow, FactRow, RunRow, SubstrateRow } from '../../utils/muninnData';
import { defaultRunId, fmtF1, short, substrateSortKey, winLoss } from '../../utils/muninnData';
import { CaseDetails } from './CasesScreen';
import { MuninnSelect, Field, PanelMsg, ScreenTitle } from './shared';

// categorical register B (NOT the F1 scale A): A — accent, B — violet
const A_COLOR = 'var(--acc)';
const B_COLOR = '#a78bfa';

function CountBar({ aWins, ties, bWins }: { aWins: number; ties: number; bWins: number }) {
  const total = Math.max(1, aWins + ties + bWins);
  const w = (n: number) => `${(n / total) * 100}%`;
  return (
    <div style={{ display: 'flex', height: 10, borderRadius: 5, overflow: 'hidden', minWidth: 160 }}>
      <div style={{ width: w(aWins), background: A_COLOR }} />
      <div style={{ width: w(ties), background: 'var(--bg3)' }} />
      <div style={{ width: w(bWins), background: B_COLOR }} />
    </div>
  );
}

/**
 * RFC-2 win/loss of a substrate pair (UC-3): per-case comparison on one run —
 * who wins in which level·hop cell, then the divergence list with a
 * side-by-side drill (both predicted sets with diff chips, both traces).
 * Answers «WHY does C3 beat C1 on column·direct» from the data.
 */
export function WinLossScreen({ runs, substrates, subLabel }: {
  runs: RunRow[];
  substrates: SubstrateRow[];
  subLabel: (id: string) => string;
}) {
  const { t } = useTranslation();
  const [run, setRun] = useState(defaultRunId(runs));
  const [subA, setSubA] = useState('');
  const [subB, setSubB] = useState('');
  const [open, setOpen] = useState<string | null>(null);

  // only offer substrates that are ACTUALLY measured in the chosen run —
  // blind pair-picking over the full dim yields empty joins (owner feedback)
  const runFacts = useMartSlice<FactRow>('facts', run ? { run } : null);
  const measured = useMemo(() => {
    const m = new Map<string, number>();
    for (const f of runFacts.rows ?? []) {
      if (f.capability === 'cap:none') continue;
      m.set(f.substrate_id, (m.get(f.substrate_id) ?? 0) + 1);
    }
    return m;
  }, [runFacts.rows]);
  const labelOf = useMemo(
    () => new Map(substrates.map(s => [s.substrate_id, s.short_name ?? s.substrate_id])),
    [substrates],
  );
  const subOptions = [...measured.keys()]
    .sort((x, y) => substrateSortKey(x).localeCompare(substrateSortKey(y)))
    .map(id => ({ value: id, label: `${labelOf.get(id) ?? id} (${measured.get(id)})` }));
  // self-heal the pair when the run changes / first load: prefer graph(edges)
  // vs rag(sql) as the default hero contrast (post-migration substrate ids)
  const effA = measured.has(subA) ? subA
    : (measured.has('Sub:graph(edges)') ? 'Sub:graph(edges)' : subOptions[0]?.value ?? '');
  const effB = measured.has(subB) && subB !== effA ? subB
    : (measured.has('Sub:rag(sql)') && effA !== 'Sub:rag(sql)' ? 'Sub:rag(sql)'
      : subOptions.find(o => o.value !== effA)?.value ?? '');

  const aSlice = useMartSlice<CaseRow>('cases', run && effA ? { run, substrate: effA } : null);
  const bSlice = useMartSlice<CaseRow>('cases', run && effB ? { run, substrate: effB } : null);
  const result = useMemo(
    () => winLoss(aSlice.rows ?? [], bSlice.rows ?? []),
    [aSlice.rows, bSlice.rows],
  );
  const runRow = runs.find(r => r.run_id === run);

  if (aSlice.unavailable) return <PanelMsg kind="info" text={t('bench.unavailable', 'Experiment mart is unavailable')} onRetry={aSlice.reload} />;
  const err = aSlice.error ?? bSlice.error;
  if (err) return <PanelMsg kind="error" text={err} onRetry={aSlice.reload} />;

  return (
    <div data-testid="bench-winloss">
      <ScreenTitle text={t('bench.wl.title', 'Win/loss — substrate pair, case by case')}
                   hint={t('bench.wl.hint', 'the WHY behind a leaderboard gap: divergent cases side by side, with traces')} />
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 10, alignItems: 'center' }}>
        <Field label={t('bench.run', 'Run')}>
          <MuninnSelect value={run} onChange={setRun}
                       options={runs.map(r => ({ value: r.run_id, label: r.run_id }))} />
        </Field>
        <Field label="A"><MuninnSelect value={effA} onChange={setSubA} options={subOptions} /></Field>
        <Field label="B"><MuninnSelect value={effB} onChange={setSubB} options={subOptions} /></Field>
        <span style={{ fontSize: 'var(--fs-sm)', color: 'var(--t3)' }}>
          {t('bench.wl.measuredOnly', 'only actors measured in this run are offered (facts in brackets)')}
        </span>
      </div>

      {(aSlice.loading || bSlice.loading || !aSlice.rows || !bSlice.rows) && (
        <PanelMsg kind="loading" text={t('bench.loading', 'Loading…')} />
      )}

      {aSlice.rows && bSlice.rows && result.totals.joined === 0 && (
        <PanelMsg kind="info" text={t('bench.wl.emptyJoin',
          'no shared scored cases for this pair — pick another pair or run')} />
      )}

      {aSlice.rows && bSlice.rows && result.totals.joined > 0 && (
        <>
          <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 10, fontSize: 'var(--fs-base)' }}>
            <span style={{ color: A_COLOR, fontWeight: 600 }}>{subLabel(effA)}: {result.totals.aWins}</span>
            <CountBar {...result.totals} />
            <span style={{ color: B_COLOR, fontWeight: 600 }}>{subLabel(effB)}: {result.totals.bWins}</span>
            <span style={{ color: 'var(--t3)' }}>
              {t('bench.wl.ties', 'ties')}: {result.totals.ties} · {t('bench.wl.joined', 'joined cases')}: {result.totals.joined}
            </span>
          </div>

          <div className="data-panel" style={{ marginBottom: 14 }}>
            <table className="data-table" data-testid="winloss-cells">
              <thead>
                <tr>
                  <th>{t('bench.adv.cell', 'level · hop')}</th>
                  <th style={{ color: A_COLOR }}>{subLabel(effA)} &gt;</th>
                  <th>{t('bench.wl.ties', 'ties')}</th>
                  <th style={{ color: B_COLOR }}>&gt; {subLabel(effB)}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {result.cells.map(c => (
                  <tr key={c.key}>
                    <td style={{ fontFamily: 'var(--mono)', fontSize: 'var(--fs-base)' }}>{c.key.split('·').map(short).join('·')}</td>
                    <td style={{ fontFamily: 'var(--mono)', color: A_COLOR }}>{c.aWins}</td>
                    <td style={{ fontFamily: 'var(--mono)', color: 'var(--t3)' }}>{c.ties}</td>
                    <td style={{ fontFamily: 'var(--mono)', color: B_COLOR }}>{c.bWins}</td>
                    <td><CountBar aWins={c.aWins} ties={c.ties} bWins={c.bWins} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="analytics-card">
            <div className="analytics-card-title">
              {t('bench.wl.diffs', 'Divergent cases')} ({result.diffs.length})
            </div>
            {result.diffs.slice(0, 50).map(d => (
              <div key={d.case_id} style={{ borderBottom: '1px solid var(--bd)' }}>
                <div style={{ display: 'flex', gap: 10, alignItems: 'center', padding: '4px 0',
                              cursor: 'pointer', fontSize: 'var(--fs-base)' }}
                     data-testid={`wl-diff-${d.case_id}`}
                     onClick={() => setOpen(open === d.case_id ? null : d.case_id)}>
                  <span style={{ fontFamily: 'var(--mono)' }}>{d.case_id}</span>
                  <span className="scope-tag">{d.key.split('·').map(short).join('·')}</span>
                  <span style={{ fontFamily: 'var(--mono)', color: d.delta > 0 ? A_COLOR : B_COLOR }}>
                    {fmtF1(d.a.f1 as number)} vs {fmtF1(d.b.f1 as number)} (Δ {d.delta > 0 ? '+' : ''}{d.delta.toFixed(3)})
                  </span>
                  <span style={{ color: 'var(--t3)', fontSize: 'var(--fs-sm)' }}>
                    {open === d.case_id ? '▾' : '▸'} {t('bench.wl.sideBySide', 'side by side')}
                  </span>
                </div>
                {open === d.case_id && (
                  <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', padding: '6px 0 10px' }}>
                    <div style={{ flex: '1 1 380px', borderLeft: `2px solid ${A_COLOR}`, paddingLeft: 10 }}>
                      <div style={{ fontSize: 'var(--fs-sm)', color: A_COLOR, fontWeight: 600 }}>{subLabel(effA)}</div>
                      <CaseDetails c={d.a} run={run} runSnapshot={runRow?.snapshot_id} />
                    </div>
                    <div style={{ flex: '1 1 380px', borderLeft: `2px solid ${B_COLOR}`, paddingLeft: 10 }}>
                      <div style={{ fontSize: 'var(--fs-sm)', color: B_COLOR, fontWeight: 600 }}>{subLabel(effB)}</div>
                      <CaseDetails c={d.b} run={run} runSnapshot={runRow?.snapshot_id} />
                    </div>
                  </div>
                )}
              </div>
            ))}
            {result.diffs.length > 50 && (
              <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--t3)', marginTop: 4 }}>
                {t('bench.wl.truncated', 'showing top-50 by |Δ| — narrow the pair or the run for the rest')}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
