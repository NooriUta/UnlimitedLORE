import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useMartSlice } from '../../hooks/useHuginn';
import type {
  CaseDimRow, FactRow, GoldRow, HypothesisRow, RunRow, SubstrateRow,
} from '../../utils/huginnData';
import {
  advisorCells, advisorDisclaimers, advisorSpread, buildCellSql, defaultRunId,
  engineGaps, fmtF1, formatUsd, num, pickLocale,
} from '../../utils/huginnData';
import { HuginnSelect, Field, PanelMsg, ScreenTitle, SqlChip, SubstrateLink } from './shared';

const EMPTY_PARAMS: Record<string, string> = {};

const chipLink = { fontSize: 10, color: 'var(--acc)', textDecoration: 'none',
                   border: '1px solid var(--bd)', borderRadius: 5, padding: '1px 6px' } as const;

/**
 * RFC-1 «Strategy advisor» — §1–§3 of STRATEGY_REVISION generated live from
 * the mart: the level·hop decision map (leader, gap to 2nd, n, I1 spread,
 * $/case, honesty disclaimers) on top, the gaps map (HBP-25: empty engine
 * combos, unsolved cells, open registered bets) below. Answers UC-1
 * («which substrate for this task class») and UC-4 («what to run next»)
 * on ONE page; every number carries an evidence link and a reproducing SQL.
 */
export function AdvisorScreen({ runs, subLabel }: {
  runs: RunRow[];
  subLabel: (id: string) => string;
}) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const [run, setRun] = useState(defaultRunId(runs));
  const sel = runs.find(r => r.run_id === run);
  // I1 spread: sibling runs under the SAME model+prompt pins (up to 2 extra)
  const siblings = runs
    .filter(r => r.run_id !== run && r.model === sel?.model && r.prompt === sel?.prompt)
    .slice(0, 2);

  const facts = useMartSlice<FactRow>('facts', run ? { run } : null);
  const sib1 = useMartSlice<FactRow>('facts', siblings[0] ? { run: siblings[0].run_id } : null);
  const sib2 = useMartSlice<FactRow>('facts', siblings[1] ? { run: siblings[1].run_id } : null);
  const casesDim = useMartSlice<CaseDimRow>('cases_dim', EMPTY_PARAMS);
  const golds = useMartSlice<GoldRow>('golds', EMPTY_PARAMS);
  const substrates = useMartSlice<SubstrateRow>('substrates', EMPTY_PARAMS);
  const hypotheses = useMartSlice<HypothesisRow>('hypotheses', EMPTY_PARAMS);

  const cells = useMemo(() => advisorCells(facts.rows ?? []), [facts.rows]);
  const spread = useMemo(
    () => advisorSpread([facts.rows ?? [], sib1.rows ?? [], sib2.rows ?? []].filter(x => x.length)),
    [facts.rows, sib1.rows, sib2.rows],
  );
  const disclaimers = useMemo(
    () => advisorDisclaimers(casesDim.rows ?? [], golds.rows ?? []),
    [casesDim.rows, golds.rows],
  );
  const gaps = useMemo(() => engineGaps(substrates.rows ?? []), [substrates.rows]);
  const unsolved = cells.filter(c => (c.ranking[0]?.f1 ?? 0) < 0.8);
  const bets = (hypotheses.rows ?? []).filter(h => h.status === 'registered_bet');

  if (facts.unavailable) return <PanelMsg kind="info" text={t('bench.unavailable', 'Experiment mart is unavailable')} onRetry={facts.reload} />;
  if (facts.error) return <PanelMsg kind="error" text={facts.error} onRetry={facts.reload} />;
  if (!facts.rows) return <PanelMsg kind="loading" text={t('bench.loading', 'Loading…')} />;

  return (
    <div data-testid="bench-advisor">
      <ScreenTitle text={t('bench.adv.title', 'Strategy advisor — task → optimal substrate')}
                   hint={t('bench.adv.hint', 'the §1 decision map live from the mart; every number carries evidence links and a reproducing SQL')} />
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 10, alignItems: 'center' }}>
        <Field label={t('bench.run', 'Run')}>
          <HuginnSelect value={run} onChange={setRun}
                       options={runs.map(r => ({ value: r.run_id, label: r.run_id }))} />
        </Field>
        <span style={{ fontSize: 11, color: 'var(--t3)' }}>
          {t('bench.adv.spreadNote', 'spread (I1) over runs with the same pins')}: {1 + siblings.length}
        </span>
      </div>

      {/* §1 decision map */}
      <div className="data-panel" style={{ marginBottom: 14, overflowX: 'auto' }}>
        <table className="data-table" data-testid="advisor-map">
          <thead>
            <tr>
              <th>{t('bench.adv.cell', 'level · hop')}</th>
              <th>n</th>
              <th>{t('bench.adv.leader', 'Leader')}</th>
              <th>{t('bench.adv.gap', 'Gap to 2nd')}</th>
              <th>{t('bench.adv.spread', 'Spread (I1)')}</th>
              <th>{t('bench.adv.costCase', '$/case')}</th>
              <th>{t('bench.adv.flags', 'Honesty')}</th>
              <th>{t('bench.adv.evidence', 'Evidence')}</th>
            </tr>
          </thead>
          <tbody>
            {cells.map(c => {
              const leader = c.ranking[0];
              const second = c.ranking[1];
              const sp = leader ? spread.get(`${c.key}|${leader.substrate_id}`) : undefined;
              const d = disclaimers.get(c.key);
              return (
                <tr key={c.key}>
                  <td style={{ fontFamily: 'var(--mono)', fontSize: 12, whiteSpace: 'nowrap' }}>{c.key}</td>
                  <td style={{ fontFamily: 'var(--mono)', fontSize: 11 }}>{c.n}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    {leader ? (
                      <>
                        <SubstrateLink id={leader.substrate_id} label={subLabel(leader.substrate_id)} />
                        <span style={{ fontFamily: 'var(--mono)', marginLeft: 6 }}>{fmtF1(leader.f1)}</span>
                      </>
                    ) : '—'}
                  </td>
                  <td style={{ fontFamily: 'var(--mono)', fontSize: 11, whiteSpace: 'nowrap' }}>
                    {leader && second
                      ? `+${(leader.f1 - second.f1).toFixed(3)} (${subLabel(second.substrate_id)} ${fmtF1(second.f1)})`
                      : '—'}
                  </td>
                  <td style={{ fontFamily: 'var(--mono)', fontSize: 11 }}>
                    {sp === undefined ? '—' : (
                      <span style={{ color: sp > 0.1 ? 'var(--danger)' : undefined }}
                            title={sp > 0.1 ? t('bench.adv.lottery', 'unstable across runs — a lottery') : undefined}>
                        {sp.toFixed(3)}
                      </span>
                    )}
                  </td>
                  <td style={{ fontFamily: 'var(--mono)', fontSize: 11 }}>
                    {leader?.costPerCase !== undefined && num(leader.costPerCase) !== undefined
                      ? (leader.costPerCase === 0 ? '$0' : formatUsd(leader.costPerCase)) : '—'}
                  </td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    {d && d.goldRiskShare > 0.5 && (
                      <span className="badge badge-warn"
                            title={`${t('bench.adv.goldRisk', 'share of circularity-risk golds among the cell cases')}: ${(d.goldRiskShare * 100).toFixed(0)}%`}>
                        ⚠ gold
                      </span>
                    )}
                    {d && d.metricMismatch > 0 && (
                      <span className="badge badge-neutral" style={{ marginLeft: 4 }}
                            title={`${t('bench.adv.metricMismatch', 'cases whose declared metric ≠ applied exact_set')}: ${d.metricMismatch}`}>
                        metric≠declared
                      </span>
                    )}
                    {c.zeros.length > 0 && (
                      <span className="scope-tag" style={{ marginLeft: 4 }}
                            title={c.zeros.map(z => `${subLabel(z.substrate_id)}: S0 × ${z.n}`).join(' · ')}>
                        S0 × {c.zeros.length}
                      </span>
                    )}
                  </td>
                  <td style={{ whiteSpace: 'nowrap', display: 'flex', gap: 4, alignItems: 'center' }}>
                    <Link to="/benchmark?tab=semantic" style={chipLink}>{t('bench.adv.evSem', 'semantics')}</Link>
                    <Link to={`/benchmark?tab=cases&run=${encodeURIComponent(run)}&hop_kind=${encodeURIComponent(c.hop)}`}
                          style={chipLink}>{t('bench.adv.evCases', 'cases')}</Link>
                    <SqlChip sql={buildCellSql({ run, substrate: leader?.substrate_id, level: c.level, hop: c.hop })}
                             passport={`n=${c.n} · S0=${c.zeros.reduce((s, z) => s + z.n, 0)} · metric=exact_set · I3=rev@run`} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* gaps map (HBP-25 + UC-4) */}
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <div className="analytics-card" style={{ flex: '1 1 300px', marginBottom: 12 }} data-testid="advisor-gaps">
          <div className="analytics-card-title">
            {t('bench.adv.gapsTitle', 'Engine gaps')} — {gaps.instantiated}/{gaps.total}
          </div>
          <div style={{ fontSize: 11, color: 'var(--t2)' }}>
            {(Object.entries(gaps.facets) as Array<[string, string[]]>).map(([k, vs]) => (
              <div key={k} style={{ padding: '2px 0' }}>
                <span style={{ color: 'var(--t3)' }}>{k}</span>: {vs.join(', ')}
              </div>
            ))}
          </div>
          <details style={{ marginTop: 6 }}>
            <summary style={{ cursor: 'pointer', fontSize: 11, color: 'var(--acc)' }}>
              {t('bench.adv.gapsList', 'empty combinations')} ({gaps.missing.length})
            </summary>
            <div style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--t3)',
                          maxHeight: 220, overflowY: 'auto', marginTop: 4 }}>
              {gaps.missing.map(m => <div key={m}>{m}</div>)}
            </div>
          </details>
        </div>

        <div className="analytics-card" style={{ flex: '1 1 300px', marginBottom: 12 }}>
          <div className="analytics-card-title">{t('bench.adv.unsolved', 'Cells without a solution (max F1 < 0.8)')}</div>
          {unsolved.length === 0 && <span style={{ fontSize: 12, color: 'var(--t3)' }}>—</span>}
          {unsolved.map(c => (
            <div key={c.key} style={{ fontSize: 12, padding: '3px 0' }}>
              <span style={{ fontFamily: 'var(--mono)' }}>{c.key}</span>
              <span style={{ color: 'var(--t3)' }}> · max {fmtF1(c.ranking[0]?.f1)} · n={c.n}</span>
              <Link to={`/benchmark?tab=cases&run=${encodeURIComponent(run)}&hop_kind=${encodeURIComponent(c.hop)}`}
                    style={{ ...chipLink, marginLeft: 6 }}>{t('bench.adv.evCases', 'cases')}</Link>
            </div>
          ))}

          <div className="analytics-card-title" style={{ marginTop: 12 }}>
            {t('bench.adv.bets', 'Open registered bets')}
          </div>
          {bets.length === 0 && <span style={{ fontSize: 12, color: 'var(--t3)' }}>—</span>}
          {bets.map(h => (
            <div key={h.hyp_id} style={{ fontSize: 12, padding: '3px 0' }}>
              <Link to={`/benchmark/hypothesis/${encodeURIComponent(h.hyp_id)}`}
                    style={{ color: 'var(--acc)', textDecoration: 'none', fontFamily: 'var(--mono)' }}>
                {h.hyp_id}
              </Link>
              <span style={{ color: 'var(--t2)' }}> — {pickLocale(lang, h.statement_ru_sci, h.statement_en, h.statement, h.statement_ru) ?? ''}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
