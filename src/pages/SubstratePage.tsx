import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { usePageTitle } from '../hooks/usePageTitle';
import { useMartSlice } from '../hooks/useBench';
import type {
  CapabilityRow, ReferenceRow, SubstrateFactRow, SubstrateRevRow, SubstrateRow,
} from '../utils/benchData';
import {
  HOP_ORDER, aggregateSubstrateRuns, buildCellSql, f1CellBg, fmtF1, formatSeconds, formatTokens,
  formatUsd, pickLocale, taxonomyDistribution,
} from '../utils/benchData';
import { BenchSelect, Field, PanelMsg, SqlChip, StatusBadge } from '../components/bench/shared';
import { MartProse } from '../components/bench/MartProse';
import { RevisionTimeline } from '../components/bench/RevisionTimeline';

const EMPTY_PARAMS: Record<string, string> = {};

function capTone(capability: string | undefined): 'suc' | 'warn' | 'neutral' {
  if (capability === 'native') return 'suc';
  if (capability === 'degraded') return 'warn';
  return 'neutral';
}

function Block({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="analytics-card" style={{ marginBottom: 12 }}>
      <div style={{ marginBottom: 8 }}>
        <span className="analytics-card-title" style={{ margin: 0 }}>{title}</span>
        {hint && <span style={{ fontSize: 11, color: 'var(--t3)', marginLeft: 8 }}>{hint}</span>}
      </div>
      {children}
    </div>
  );
}

/**
 * Substrate profile page — the "who answers" view that closes the
 * blind-dashboard gap (contract from the experiment-mart skill): prose,
 * builder code pointers, engine facets, capability row with rationale,
 * literature grounding, per-run measurements and the failure-taxonomy profile.
 */
export default function SubstratePage() {
  const { id } = useParams<{ id: string }>();
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  usePageTitle(`${id ?? ''} — ${t('bench.title', 'RAG vs Parse — experiment')}`);

  const substrates = useMartSlice<SubstrateRow>('substrates', EMPTY_PARAMS);
  const capabilities = useMartSlice<CapabilityRow>('capabilities', EMPTY_PARAMS);
  const refs = useMartSlice<ReferenceRow>('substrate_refs', id ? { substrate: id } : null);
  const facts = useMartSlice<SubstrateFactRow>('substrate_facts', id ? { substrate: id } : null);
  // v8: SCD2 history of the actor — what C1/tierA WAS at the moment of a run
  const revs = useMartSlice<SubstrateRevRow>('substrate_revs', id ? { substrate: id } : null);

  const sub = (substrates.rows ?? []).find(s => s.substrate_id === id);
  const caps = useMemo(() => (capabilities.rows ?? [])
    .filter(c => c.substrate_id === id)
    .sort((a, b) => HOP_ORDER.indexOf(a.hop_kind_id) - HOP_ORDER.indexOf(b.hop_kind_id)), [capabilities.rows, id]);

  const runAggs = useMemo(() => facts.rows ? aggregateSubstrateRuns(facts.rows) : null, [facts.rows]);
  const [taxRun, setTaxRun] = useState('');
  const taxonomy = useMemo(() => facts.rows
    ? taxonomyDistribution(facts.rows, taxRun || undefined)
    : [], [facts.rows, taxRun]);
  const taxMax = Math.max(1, ...taxonomy.map(x => x.n));

  const displayName = sub
    ? (pickLocale(lang, undefined, sub.label_en, sub.short_name, sub.label_ru) ?? sub.substrate_id)
    : '';
  const longDesc = sub
    ? (pickLocale(lang, sub.long_description_ru_sci, sub.long_description_en,
        sub.long_description, sub.long_description_ru) ?? sub.description)
    : undefined;
  const revRows = revs.rows ?? [];
  const curRev = revRows.find(r => r.is_current) ?? revRows[revRows.length - 1];
  const currentRevArch = curRev
    ? pickLocale(lang, curRev.architecture_ru_sci, curRev.architecture_en, curRev.architecture, curRev.architecture_ru)
    : undefined;

  return (
    <div className="page-content bench-scroll" style={{ padding: '16px 20px', height: '100%', boxSizing: 'border-box' }}
         data-testid="substrate-page">
      <Link to="/benchmark?tab=campaigns" style={{ fontSize: 12, color: 'var(--acc)', textDecoration: 'none' }}>
        {t('bench.sub.back', '← Benchmark panel')}
      </Link>

      {substrates.unavailable && <PanelMsg kind="info" text={t('bench.unavailable', 'Experiment mart is unavailable')} onRetry={substrates.reload} />}
      {!substrates.unavailable && substrates.rows && !sub && (
        <PanelMsg kind="error" text={`${t('bench.sub.notFound', 'Substrate not found in the mart')}: ${id ?? ''}`} />
      )}
      {!substrates.unavailable && !substrates.rows && !substrates.error && (
        <PanelMsg kind="loading" text={t('bench.loading', 'Loading…')} />
      )}

      {sub && (
        <>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap', margin: '10px 0 4px' }}>
            <div>
              <h1 className="page-title" style={{ margin: 0 }}>{displayName}</h1>
              {sub.short_name && sub.short_name !== displayName && (
                <div style={{ fontSize: 12, color: 'var(--t2)', marginTop: 2 }}>{sub.short_name}</div>
              )}
            </div>
            <span style={{ fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--t3)' }}>{sub.substrate_id}</span>
            {sub.family && <span className="scope-tag">{sub.family}</span>}
            {sub.status && <StatusBadge tone={sub.status === 'current' ? 'suc' : sub.status === 'pruned' ? 'neutral' : 'info'} text={sub.status} />}
            {sub.config_rev && <span className="scope-tag">config_rev: {sub.config_rev}</span>}
          </div>
          {longDesc && (
            <MartProse text={longDesc}
                       style={{ maxWidth: 980, margin: '6px 0 14px' }} />
          )}
          {/* Д-5 (RFC-3): numbers in the prose must be groundable — evidence
              deep-links with this actor pinned + the reproducing SQL */}
          <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap',
                        margin: '0 0 14px', fontSize: 11 }}
               data-testid="passport-evidence">
            <span style={{ color: 'var(--t3)' }}>{t('bench.sub.evidence', 'verify with slices:')}</span>
            <Link to="/benchmark?tab=semantic" className="scope-tag"
                  style={{ textDecoration: 'none' }}>{t('bench.adv.evSem', 'semantics')}</Link>
            <Link to="/benchmark?tab=dispersion" className="scope-tag"
                  style={{ textDecoration: 'none' }}>{t('bench.tabDispersion', 'Dispersion')}</Link>
            <Link to={`/benchmark?tab=cases&substrate=${encodeURIComponent(sub.substrate_id)}`}
                  className="scope-tag" style={{ textDecoration: 'none' }}>{t('bench.adv.evCases', 'cases')}</Link>
            <SqlChip sql={buildCellSql({ substrate: sub.substrate_id })}
                     passport={`${sub.substrate_id} · metric=exact_set · I3=rev@run`} />
          </div>

          <Block title={t('bench.sub.code', 'Code')}>
            <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', fontSize: 12 }}>
              <span>
                <span style={{ color: 'var(--t3)' }}>{t('bench.sub.builder', 'builder')}: </span>
                <span style={{ fontFamily: 'var(--mono)', color: 'var(--t1)' }}>{sub.builder ?? '—'}</span>
              </span>
              <span>
                <span style={{ color: 'var(--t3)' }}>{t('bench.sub.codeFile', 'file')}: </span>
                <span style={{ fontFamily: 'var(--mono)', color: 'var(--t1)' }}>{sub.code_file ?? '—'}</span>
              </span>
            </div>
          </Block>

          {(revs.rows?.length ?? 0) > 0 && (
            <Block title={t('bench.sub.revs', 'Revision history (SCD2)')}
                   hint={t('bench.sub.revsHint', 'what this actor WAS at the moment of each run; behaviour change = new revision')}>
              <RevisionTimeline revs={revs.rows ?? []} facts={facts.rows ?? []} />
            </Block>
          )}

          <Block title={t('bench.sub.engine', 'Engine facets')}>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              <span className="scope-tag">{t('bench.sub.dataLayer', 'data layer')}: {sub.data_layer_id ?? '—'}</span>
              <span className="scope-tag">{t('bench.sub.retrieval', 'retrieval')}: {sub.retrieval_id ?? '—'}</span>
              <span className="scope-tag">{t('bench.sub.textGran', 'text granularity')}: {sub.text_gran_id ?? '—'}</span>
              <span className="scope-tag">{t('bench.sub.reasoner', 'reasoner')}: {sub.reasoner_id ?? '—'}</span>
            </div>
          </Block>

          {currentRevArch && (
            <details className="analytics-card" style={{ marginBottom: 12 }}>
              <summary style={{
                cursor: 'pointer', listStyle: 'none', display: 'flex',
                alignItems: 'center', gap: 8,
              }}>
                <span className="analytics-card-title" style={{ margin: 0 }}>
                  {t('bench.sub.arch', 'Architecture')}
                </span>
                <span style={{ fontSize: 11, color: 'var(--t3)' }}>
                  {t('bench.sub.archHint', 'current revision prose')}
                </span>
              </summary>
              <MartProse text={currentRevArch} style={{ maxWidth: 980, paddingTop: 8 }} />
            </details>
          )}

          <Block title={t('bench.sub.caps', 'Capabilities by hop kind')}
                 hint={t('bench.sub.capsHint', 'native / degraded / none')}>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {caps.length === 0 && <span style={{ fontSize: 11, color: 'var(--t3)' }}>—</span>}
              {caps.map(c => (
                <span key={c.hop_kind_id} title={c.rationale ?? ''}
                      style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--t2)' }}>{c.hop_kind_id}</span>
                  <StatusBadge tone={capTone(c.capability)} text={c.capability ?? '?'} />
                </span>
              ))}
            </div>
          </Block>

          {(refs.rows?.length ?? 0) > 0 && (
            <Block title={t('bench.sub.literature', 'Literature (GROUNDED_IN)')}>
              {(refs.rows ?? []).map(r => {
                const takeaway = pickLocale(lang, r.takeaway_ru_sci, r.takeaway_en, r.takeaway, r.takeaway_ru);
                return (
                  <div key={r.ref_id} style={{ padding: '4px 0', fontSize: 12 }}>
                    <span style={{ color: 'var(--t1)' }}>{r.citation ?? r.ref_id}</span>
                    {r.venue && <span style={{ color: 'var(--t3)' }}> · {r.venue}{r.year ? ` ${r.year}` : ''}</span>}
                    {takeaway && <div style={{ color: 'var(--t2)', fontSize: 11 }}>{takeaway}</div>}
                    {r.link && (
                      <a href={r.link} target="_blank" rel="noopener noreferrer"
                         style={{ color: 'var(--acc)', fontSize: 11 }}>{r.link}</a>
                    )}
                  </div>
                );
              })}
            </Block>
          )}

          <Block title={t('bench.sub.runs', 'Measurements by run')}>
            {!runAggs && <PanelMsg kind="loading" text={t('bench.loading', 'Loading…')} />}
            {runAggs && runAggs.length === 0 && <PanelMsg kind="info" text={t('bench.noRows', 'No rows')} />}
            {runAggs && runAggs.length > 0 && (
              <div className="data-panel" style={{ overflowX: 'auto', marginBottom: 0 }}>
                <table className="data-table" data-testid="substrate-runs-table">
                  <thead>
                    <tr>
                      <th>{t('bench.run', 'Run')}</th>
                      <th style={{ textAlign: 'right' }}>{t('bench.n', 'n')}</th>
                      <th style={{ textAlign: 'right' }}>{t('bench.f1', 'F1')}</th>
                      <th style={{ textAlign: 'right' }} title={t('bench.sub.zerosTitle', 'structural zeros (by design)')}>
                        {t('bench.sub.zeros', 'S0')}
                      </th>
                      <th style={{ textAlign: 'right' }}>{t('bench.cost', 'cost')}</th>
                      <th style={{ textAlign: 'right' }}>{t('bench.tokens', 'tokens')}</th>
                      <th style={{ textAlign: 'right' }}>{t('bench.seconds', 'time')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {runAggs.map(r => (
                      <tr key={r.run_id}>
                        <td style={{ fontFamily: 'var(--mono)' }}>{r.run_id}</td>
                        <td style={{ textAlign: 'right', fontFamily: 'var(--mono)' }}>{r.n}</td>
                        <td style={{ textAlign: 'right', fontFamily: 'var(--mono)', background: f1CellBg(r.f1) }}>{fmtF1(r.f1)}</td>
                        <td style={{ textAlign: 'right', fontFamily: 'var(--mono)', color: 'var(--t3)' }}>{r.zeros || ''}</td>
                        <td style={{ textAlign: 'right', fontFamily: 'var(--mono)' }}>{formatUsd(r.costUsd)}</td>
                        <td style={{ textAlign: 'right', fontFamily: 'var(--mono)' }}>{formatTokens(r.tokens)}</td>
                        <td style={{ textAlign: 'right', fontFamily: 'var(--mono)' }}>{formatSeconds(r.elapsedS)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Block>

          <Block title={t('bench.sub.failures', 'Failure profile (rule-based v0)')}
                 hint={t('bench.sub.failuresHint', 'empty taxonomy = scored fine')}>
            <div style={{ marginBottom: 8 }}>
              <Field label={t('bench.run', 'Run')}>
                <BenchSelect value={taxRun} onChange={setTaxRun} allLabel={t('bench.sub.allRuns', 'all runs')}
                             options={(runAggs ?? []).map(r => ({ value: r.run_id, label: r.run_id }))} />
              </Field>
            </div>
            {taxonomy.length === 0 && <PanelMsg kind="info" text={t('bench.noRows', 'No rows')} />}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxWidth: 640 }}>
              {taxonomy.map(x => (
                <div key={x.taxonomy} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontFamily: 'var(--mono)', fontSize: 11, width: 150, color: 'var(--t2)' }}>{x.taxonomy}</span>
                  <div style={{ flex: 1, height: 10, background: 'var(--bg3)', borderRadius: 3, overflow: 'hidden' }}>
                    <div style={{ width: `${(x.n / taxMax) * 100}%`, height: '100%',
                                  background: x.taxonomy === 'ok' ? 'var(--suc)'
                                    : x.taxonomy === 'structural_zero' ? 'var(--t3)' : 'var(--wrn)' }} />
                  </div>
                  <span style={{ fontFamily: 'var(--mono)', fontSize: 11, width: 50, textAlign: 'right' }}>{x.n}</span>
                </div>
              ))}
            </div>
          </Block>
        </>
      )}
    </div>
  );
}
