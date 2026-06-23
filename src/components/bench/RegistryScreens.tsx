import { useMemo, useState, type CSSProperties } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useMartSlice } from '../../hooks/useBench';
import type {
  CaseDimRow, DecisionRow, FindingRow, GoldRow, GoldVerdictRow, HypothesisRow,
  MethodCardRow, ReferenceRow, SourceRow,
  SubstrateRevAllRow, SubstrateRow,
} from '../../utils/benchData';
import { groupRevChains, pickLocale, substrateSortKey } from '../../utils/benchData';
import { MartProse } from './MartProse';
import {
  PanelMsg, RegistryFooter, ScreenTitle, StatusBadge, SubstrateLink, hypothesisTone, useRegistryTable,
} from './shared';

const EMPTY_PARAMS: Record<string, string> = {};

// ExpSource.kind → short chip label.
const SRC_KIND_LABEL: Record<string, string> = {
  arxiv: 'arXiv', github: 'GitHub', huggingface: 'HF', doi: 'DOI',
  project: 'project', other: 'link', status: 'нет репо',
};

/** "value × n" chips for the registry footers (the owner's aggregation rule) */
function hist(values: Array<string | undefined>): Array<{ text: string }> {
  const m = new Map<string, number>();
  for (const v of values) m.set(v ?? '—', (m.get(v ?? '—') ?? 0) + 1);
  return [...m.entries()].sort((a, b) => b[1] - a[1]).map(([k, n]) => ({ text: `${k} × ${n}` }));
}

const entityLink = { color: 'var(--acc)', textDecoration: 'none', fontFamily: 'var(--mono)', fontSize: 12 } as const;

function RevChain({ revs, fallback }: { revs: SubstrateRevAllRow[] | undefined; fallback?: string }) {
  if (!revs?.length) {
    return <span style={{ fontFamily: 'var(--mono)', fontSize: 11 }}>{fallback ?? '—'}</span>;
  }
  return (
    <span style={{ whiteSpace: 'nowrap' }}>
      {revs.map((r, i) => (
        <span key={r.rev_id}>
          {i > 0 && <span style={{ color: 'var(--t3)', fontSize: 10 }}> → </span>}
          <span title={[r.change_why, `${r.valid_from ?? ''} → ${r.valid_to || 'now'}`].filter(Boolean).join('\n')}
                style={{ fontFamily: 'var(--mono)', fontSize: 11,
                         color: r.is_current ? 'var(--t1)' : 'var(--t3)',
                         textDecoration: r.is_current ? undefined : 'line-through' }}>
            {r.config_rev ?? r.rev_id}
          </span>
        </span>
      ))}
    </span>
  );
}

export function SubstratesScreen({ substrates }: { substrates: SubstrateRow[] }) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const revsAll = useMartSlice<SubstrateRevAllRow>('substrate_revs_all', EMPTY_PARAMS);
  const chains = groupRevChains(revsAll.rows ?? []);
  const sorted = [...substrates].sort(
    (a, b) => substrateSortKey(a.substrate_id).localeCompare(substrateSortKey(b.substrate_id)));
  const subName = (s: SubstrateRow) =>
    pickLocale(lang, undefined, s.label_en, s.short_name, s.label_ru) ?? s.substrate_id;
  const table = useRegistryTable(sorted, [
    { key: 'name', label: t('bench.reg.substrate', 'Substrate'), get: subName },
    { key: 'family', label: t('bench.reg.family', 'Family'), fk: true, get: s => s.family },
    { key: 'status', label: t('bench.reg.status', 'Status'), fk: true, get: s => s.status },
    { key: 'data_layer', label: 'data layer', fk: true, get: s => s.data_layer_id },
    { key: 'retrieval', label: 'retrieval', fk: true, get: s => s.retrieval_id },
    { key: 'text_gran', label: 'text gran', fk: true, get: s => s.text_gran_id },
    { key: 'reasoner', label: 'reasoner', fk: true, get: s => s.reasoner_id },
  ]);
  return (
    <div>
      <ScreenTitle text={t('bench.reg.substratesTitle', 'Substrates — all actors of the experiment')}
                   hint={t('bench.reg.substratesHint', 'click a name to open the passport')} />
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginBottom: 8, fontSize: 12 }}>
        {table.controls}
        <span style={{ color: 'var(--t3)' }}>{table.count} / {substrates.length}</span>
      </div>
      <div className="data-panel">
        <table className="data-table">
          <thead>
            <tr>
              {table.th({ key: 'name', label: t('bench.reg.substrate', 'Substrate'), get: subName })}
              {table.th({ key: 'family', label: t('bench.reg.family', 'Family'), get: s => s.family })}
              {table.th({ key: 'status', label: t('bench.reg.status', 'Status'), get: s => s.status })}
              <th>{t('bench.reg.revisions', 'Revisions (SCD2)')}</th>
              <th>{t('bench.reg.engine', 'Engine')}</th>
              <th>{t('bench.reg.description', 'Description')}</th>
            </tr>
          </thead>
          <tbody>
            {table.groups.flatMap(g => [
              ...(g.group ? [(
                <tr key={`g-${g.group}`}>
                  <td colSpan={6} style={{ background: 'var(--bg2)', fontSize: 11, fontWeight: 600, color: 'var(--t2)' }}>
                    {g.group} · {g.rows.length}
                  </td>
                </tr>
              )] : []),
              ...g.rows.map(s => {
              const name = subName(s);
              return (
              <tr key={s.substrate_id}>
                <td><SubstrateLink id={s.substrate_id} label={name} />
                  {s.short_name && s.short_name !== name && (
                    <div style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--t3)' }}>{s.short_name}</div>
                  )}
                </td>
                <td><span className="scope-tag">{s.family ?? '—'}</span></td>
                <td>{s.status ? <span className="badge badge-neutral">{s.status}</span> : '—'}</td>
                <td><RevChain revs={chains.get(s.substrate_id)} fallback={s.config_rev} /></td>
                <td style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--t3)', whiteSpace: 'nowrap' }}>
                  {[s.data_layer_id, s.retrieval_id, s.text_gran_id, s.reasoner_id].filter(Boolean).join(' · ') || '—'}
                </td>
                <td style={{ color: 'var(--t2)', fontSize: 12, maxWidth: 420 }}>
                  {s.description ?? ''}
                  {s.builder && (
                    <div style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--t3)', marginTop: 2 }}>
                      {s.builder}{s.code_file ? ` · ${s.code_file}` : ''}
                    </div>
                  )}
                </td>
              </tr>
              ); }),
            ])}
          </tbody>
        </table>
      </div>
      <RegistryFooter groups={[
        { label: t('bench.foot.byFamily', 'By family'), chips: hist(sorted.map(s => s.family)) },
        { label: t('bench.foot.byStatus', 'By status'), chips: hist(sorted.map(s => s.status)) },
        {
          label: t('bench.foot.linkedRevs', 'Linked: revisions (SCD2)'),
          chips: [{ text: `${(revsAll.rows ?? []).length} ${t('bench.foot.revsOf', 'revisions of')} ${chains.size} ${t('bench.foot.actors', 'actors')}` }],
        },
      ]} />
    </div>
  );
}

export function HypothesesScreen() {
  const { t } = useTranslation();
  const hyps = useMartSlice<HypothesisRow>('hypotheses', EMPTY_PARAMS);
  const table = useRegistryTable(hyps.rows ?? [], [
    { key: 'id', label: t('bench.reg.id', 'ID'), get: h => h.hyp_id },
    { key: 'status', label: t('bench.reg.status', 'Status'), fk: true, get: h => h.status },
    { key: 'metric', label: t('bench.reg.metric', 'Metric'), fk: true, get: h => h.metric },
  ]);
  if (hyps.unavailable) return <PanelMsg kind="info" text={t('bench.unavailable', 'Experiment mart is unavailable')} onRetry={hyps.reload} />;
  if (hyps.error) return <PanelMsg kind="error" text={hyps.error} onRetry={hyps.reload} />;
  if (!hyps.rows) return <PanelMsg kind="loading" text={t('bench.loading', 'Loading…')} />;
  return (
    <div>
      <ScreenTitle text={t('bench.reg.hypothesesTitle', 'Hypotheses — all registered bets')}
                   hint={t('bench.reg.hypothesesHint', 'pre-registered before the runs; refuted is a result, not a failure')} />
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginBottom: 8, fontSize: 12 }}>
        {table.controls}
        <span style={{ color: 'var(--t3)' }}>{table.count} / {hyps.rows.length}</span>
      </div>
      <div className="data-panel">
        <table className="data-table">
          <thead>
            <tr>
              {table.th({ key: 'id', label: t('bench.reg.id', 'ID'), get: h => h.hyp_id })}
              {table.th({ key: 'status', label: t('bench.reg.status', 'Status'), get: h => h.status })}
              <th>{t('bench.reg.statement', 'Statement')}</th>
              {table.th({ key: 'metric', label: t('bench.reg.metric', 'Metric'), get: h => h.metric })}
              <th>{t('bench.reg.campaigns', 'Campaigns')}</th>
            </tr>
          </thead>
          <tbody>
            {table.groups.flatMap(g => [
              ...(g.group ? [(
                <tr key={`g-${g.group}`}>
                  <td colSpan={5} style={{ background: 'var(--bg2)', fontSize: 11, fontWeight: 600, color: 'var(--t2)' }}>
                    {g.group} · {g.rows.length}
                  </td>
                </tr>
              )] : []),
              ...g.rows.map(h => (
              <tr key={h.hyp_id}>
                <td><Link to={`/benchmark/hypothesis/${encodeURIComponent(h.hyp_id)}`} style={entityLink}>{h.hyp_id}</Link></td>
                <td>{h.status ? <StatusBadge tone={hypothesisTone(h.status)} text={h.status} /> : '—'}</td>
                <td style={{ fontSize: 12, maxWidth: 460 }}>{h.statement ?? ''}</td>
                <td style={{ fontFamily: 'var(--mono)', fontSize: 11 }}>
                  {h.metric ?? '—'}{h.threshold ? ` ${h.threshold}` : ''}
                </td>
                <td>{(h.campaigns ?? []).map(c => <span key={c} className="scope-tag" style={{ marginRight: 4 }}>{c}</span>)}</td>
              </tr>
              )),
            ])}
          </tbody>
        </table>
      </div>
      <RegistryFooter groups={[
        {
          label: t('bench.foot.confirmedAs', 'Decided as'),
          chips: hist(hyps.rows.map(h => h.status)).map(c => ({
            ...c, tone: hypothesisTone(c.text.split(' × ')[0]),
          })),
        },
        {
          label: t('bench.foot.fromCampaigns', 'Originates from campaigns'),
          chips: hist(hyps.rows.flatMap(h => (h.campaigns ?? []).length ? h.campaigns! : [undefined])),
        },
      ]} />
    </div>
  );
}

export function FindingsScreen() {
  const { t } = useTranslation();
  const finds = useMartSlice<FindingRow>('findings', EMPTY_PARAMS);
  const table = useRegistryTable(finds.rows ?? [], [
    { key: 'id', label: t('bench.reg.id', 'ID'), get: f => f.finding_id },
    { key: 'class', label: t('bench.reg.class', 'Class'), fk: true, get: f => f.finding_class_id },
    { key: 'status', label: t('bench.reg.status', 'Status'), fk: true, get: f => f.finding_status_id },
    { key: 'side', label: t('bench.reg.side', 'Side'), fk: true, get: f => f.side },
    { key: 'snapshot', label: t('bench.reg.snapshot', 'Snapshot'), fk: true, get: f => f.snapshot_id },
  ]);
  if (finds.unavailable) return <PanelMsg kind="info" text={t('bench.unavailable', 'Experiment mart is unavailable')} onRetry={finds.reload} />;
  if (finds.error) return <PanelMsg kind="error" text={finds.error} onRetry={finds.reload} />;
  if (!finds.rows) return <PanelMsg kind="loading" text={t('bench.loading', 'Loading…')} />;
  return (
    <div>
      <ScreenTitle text={t('bench.reg.findingsTitle', 'Findings — everything the experiment surfaced')}
                   hint={t('bench.reg.findingsHint', 'side = where the cause lives; click for the narrative and demo cases')} />
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginBottom: 8, fontSize: 12 }}>
        {table.controls}
        <span style={{ color: 'var(--t3)' }}>{table.count} / {finds.rows.length}</span>
      </div>
      <div className="data-panel">
        <table className="data-table">
          <thead>
            <tr>
              {table.th({ key: 'id', label: t('bench.reg.id', 'ID'), get: f => f.finding_id })}
              <th>{t('bench.reg.title', 'Title')}</th>
              {table.th({ key: 'class', label: t('bench.reg.class', 'Class'), get: f => f.finding_class_id })}
              {table.th({ key: 'status', label: t('bench.reg.status', 'Status'), get: f => f.finding_status_id })}
              {table.th({ key: 'side', label: t('bench.reg.side', 'Side'), get: f => f.side })}
              {table.th({ key: 'snapshot', label: t('bench.reg.snapshot', 'Snapshot'), get: f => f.snapshot_id })}
            </tr>
          </thead>
          <tbody>
            {table.groups.flatMap(g => [
              ...(g.group ? [(
                <tr key={`g-${g.group}`}>
                  <td colSpan={6} style={{ background: 'var(--bg2)', fontSize: 11, fontWeight: 600, color: 'var(--t2)' }}>
                    {g.group} · {g.rows.length}
                  </td>
                </tr>
              )] : []),
              ...g.rows.map(f => (
              <tr key={f.finding_id}>
                <td><Link to={`/benchmark/finding/${encodeURIComponent(f.finding_id)}`} style={entityLink}>{f.finding_id}</Link></td>
                <td style={{ fontSize: 12, maxWidth: 380 }}>{f.title ?? ''}</td>
                <td>{f.finding_class_id ? <span className="scope-tag">{f.finding_class_id}</span> : '—'}</td>
                <td>{f.finding_status_id ? <span className="badge badge-neutral">{f.finding_status_id}</span> : '—'}</td>
                <td style={{ fontSize: 12 }}>{f.side ?? '—'}</td>
                <td style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--t3)' }}>{f.snapshot_id ?? '—'}</td>
              </tr>
              )),
            ])}
          </tbody>
        </table>
      </div>
      <RegistryFooter groups={[
        { label: t('bench.foot.byClass', 'By class'), chips: hist(finds.rows.map(f => f.finding_class_id)) },
        { label: t('bench.foot.bySide', 'Cause lives in'), chips: hist(finds.rows.map(f => f.side)) },
        {
          label: t('bench.foot.fromCampaigns', 'Originates from campaigns'),
          chips: hist(finds.rows.flatMap(f => (f.campaigns ?? []).length ? f.campaigns! : [undefined])),
        },
        {
          label: t('bench.foot.demoCases', 'Demonstrated by'),
          chips: [{ text: `${finds.rows.reduce((s, f) => s + (f.demo_cases?.length ?? 0), 0)} ${t('bench.foot.cases', 'cases')}` }],
        },
      ]} />
    </div>
  );
}

// ── shared MethodCardBlock ────────────────────────────────────────────────────

function MethodCardBlock({ card }: { card: MethodCardRow }) {
  const scores = [
    card.bird   ? `BIRD ${card.bird}`   : null,
    card.spider ? `Spider ${card.spider}` : null,
  ].filter(Boolean).join(' · ');
  const mermaidSrc = card.mermaid ? '```mermaid\n' + card.mermaid + '\n```' : null;
  const hasSections = card.architecture || card.prep || card.method || card.results || card.findings;
  return (
    <div style={{
      marginTop: 6, borderRadius: 5,
      border: '1px solid color-mix(in srgb, var(--acc) 25%, transparent)',
      background: 'color-mix(in srgb, var(--acc) 5%, transparent)',
      overflow: 'hidden',
    }}>
      {/* header */}
      <div style={{
        padding: '5px 10px', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap',
        borderBottom: '1px solid color-mix(in srgb, var(--acc) 15%, transparent)',
      }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--t1)' }}>{card.name ?? card.card_id}</span>
        {card.group_name && <span style={{ fontSize: 10, color: 'var(--t3)' }}>{card.group_name}</span>}
        {card.date && <span style={{ fontSize: 10, color: 'var(--t3)' }}>· {card.date}</span>}
        <span style={{ flex: 1 }} />
        {scores && <span style={{ fontSize: 10, color: 'var(--acc)' }}>{scores}</span>}
        {card.link && (
          <a href={card.link} target="_blank" rel="noopener noreferrer"
             style={{ fontSize: 10, color: 'var(--acc)', textDecoration: 'none' }}>↗</a>
        )}
      </div>
      {/* body */}
      <div style={{ padding: '6px 10px 8px' }}>
        {card.tldr && (
          <p style={{
            margin: '0 0 6px', fontSize: 12, color: 'var(--t2)', lineHeight: 1.55, fontStyle: 'italic',
            borderLeft: '2px solid color-mix(in srgb, var(--acc) 40%, transparent)', paddingLeft: 8,
          }}>
            {card.tldr}
          </p>
        )}
        {card.hound && (
          <div style={{ fontSize: 11, color: 'var(--wrn)', lineHeight: 1.5, marginBottom: 6 }}>
            <span style={{ fontWeight: 700 }}>↳ HOUND: </span>{card.hound}
          </div>
        )}
        {mermaidSrc && <MartProse text={mermaidSrc} style={{ marginTop: 4 }} />}
        {hasSections && (
          <details style={{ marginTop: 6 }}>
            <summary style={{ cursor: 'pointer', fontSize: 10, color: 'var(--t3)', userSelect: 'none' }}>
              детали методики
            </summary>
            <div style={{ paddingTop: 5, display: 'flex', flexDirection: 'column', gap: 5 }}>
              {[
                { label: 'Архитектура', val: card.architecture },
                { label: 'Данные',      val: card.prep },
                { label: 'Метод',       val: card.method },
                { label: 'Результаты',  val: card.results },
                { label: 'Выводы',      val: card.findings },
              ].filter(s => s.val).map(s => (
                <div key={s.label} style={{ fontSize: 11, lineHeight: 1.5 }}>
                  <span style={{ color: 'var(--t3)', fontWeight: 600 }}>{s.label}: </span>
                  <span style={{ color: 'var(--t2)' }}>{s.val}</span>
                </div>
              ))}
            </div>
          </details>
        )}
      </div>
    </div>
  );
}

export function ReferencesScreen() {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const refs = useMartSlice<ReferenceRow>('references', EMPTY_PARAMS);
  const sources = useMartSlice<SourceRow>('sources', EMPTY_PARAMS);
  const methodCards = useMartSlice<MethodCardRow>('method_cards', EMPTY_PARAMS);
  if (refs.unavailable) return <PanelMsg kind="info" text={t('bench.unavailable', 'Experiment mart is unavailable')} onRetry={refs.reload} />;
  if (refs.error) return <PanelMsg kind="error" text={refs.error} onRetry={refs.reload} />;
  if (!refs.rows) return <PanelMsg kind="loading" text={t('bench.loading', 'Loading…')} />;

  const groups = new Map<string, ReferenceRow[]>();
  for (const r of refs.rows) {
    const g = r.ref_group ?? 'other';
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g)!.push(r);
  }
  // ExpSource links grouped by reference (git / HF / arXiv / doi …).
  const srcByRef = new Map<string, SourceRow[]>();
  for (const s of sources.rows ?? []) {
    if (!s.ref_id) continue;
    if (!srcByRef.has(s.ref_id)) srcByRef.set(s.ref_id, []);
    srcByRef.get(s.ref_id)!.push(s);
  }
  // ExpMethodCard competitor cards grouped by reference.
  const cardsByRef = new Map<string, MethodCardRow[]>();
  for (const c of methodCards.rows ?? []) {
    if (!c.ref_id) continue;
    if (!cardsByRef.has(c.ref_id)) cardsByRef.set(c.ref_id, []);
    cardsByRef.get(c.ref_id)!.push(c);
  }
  return (
    <div>
      <ScreenTitle text={t('bench.refs.title', 'Bibliography')}
                   hint={t('bench.refs.subtitle', 'ExpReference — what the method is grounded in (GROUNDED_IN)')} />
      {[...groups.entries()].map(([group, items]) => {
        const firstRef = items.find(r => r.group_overview || r.group_overview_ru_sci || r.group_overview_en || r.group_overview_ru);
        const overview = firstRef ? pickLocale(lang, firstRef.group_overview_ru_sci, firstRef.group_overview_en, firstRef.group_overview, firstRef.group_overview_ru) : undefined;
        return (
          <div key={group} className="analytics-card" style={{ marginBottom: 12 }}>
            <div className="analytics-card-title">{group}</div>
            {overview && <MartProse text={overview} style={{ maxWidth: 940, marginBottom: 8 }} />}
            {items.map(r => {
              const description = pickLocale(lang, undefined, r.description_en, r.description, r.description_ru);
              const relevance = pickLocale(lang, r.relevance_ru_sci, r.relevance_en, r.relevance, r.relevance_ru);
              const takeaway = pickLocale(lang, r.takeaway_ru_sci, r.takeaway_en, r.takeaway, r.takeaway_ru);
              return (
                <div key={r.ref_id} style={{ padding: '5px 0', fontSize: 12, borderBottom: '1px solid var(--bd)' }}>
                  <span style={{ color: 'var(--t1)' }}>{r.citation ?? r.ref_id}</span>
                  {(r.venue || r.year) && (
                    <span style={{ color: 'var(--t3)' }}> · {r.venue ?? ''}{r.year ? ` ${r.year}` : ''}</span>
                  )}
                  {description && <div style={{ color: 'var(--t2)', fontSize: 11, marginTop: 2 }}>{description}</div>}
                  {takeaway && <div style={{ color: 'var(--t2)', fontSize: 11, marginTop: 2, fontStyle: 'italic' }}>{takeaway}</div>}
                  {relevance && (
                    <details style={{ marginTop: 3 }}>
                      <summary style={{ cursor: 'pointer', fontSize: 11, color: 'var(--acc)' }}>
                        {t('bench.refs.relevance', 'how it shaped our method')}
                      </summary>
                      <MartProse text={relevance} style={{ maxWidth: 940, padding: '4px 0 0 14px' }} />
                    </details>
                  )}
                  {r.link && (
                    <a href={r.link} target="_blank" rel="noopener noreferrer"
                       style={{ color: 'var(--acc)', fontSize: 11 }}>{r.link}</a>
                  )}
                  {(srcByRef.get(r.ref_id) ?? []).length > 0 && (
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 4 }}>
                      {(srcByRef.get(r.ref_id) ?? []).map(s => {
                        const label = SRC_KIND_LABEL[s.kind ?? ''] ?? s.kind ?? 'src';
                        const muted = s.kind === 'status' || !s.url;
                        const chip: CSSProperties = {
                          fontSize: 10, padding: '1px 6px', borderRadius: 3, whiteSpace: 'nowrap',
                          border: `1px solid color-mix(in srgb, ${muted ? 'var(--t3)' : 'var(--acc)'} 35%, transparent)`,
                          background: `color-mix(in srgb, ${muted ? 'var(--t3)' : 'var(--acc)'} 12%, transparent)`,
                          color: muted ? 'var(--t3)' : 'var(--acc)', textDecoration: 'none',
                        };
                        return muted ? (
                          <span key={s.source_id} title={s.annotation} style={chip}>{label}</span>
                        ) : (
                          <a key={s.source_id} href={s.url} target="_blank" rel="noopener noreferrer"
                             title={s.annotation} style={chip}>{label} ↗</a>
                        );
                      })}
                    </div>
                  )}
                  {(cardsByRef.get(r.ref_id) ?? []).map(mc => (
                    <MethodCardBlock key={mc.card_id} card={mc} />
                  ))}
                </div>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}

const VERDICT_TONE: Record<string, 'suc' | 'warn' | 'err' | 'info' | 'neutral'> = {
  source_verified: 'suc', rebuilt: 'info', disputed: 'err', initial: 'neutral',
};

function shortEpoch(snapshotId: string | undefined): string {
  if (!snapshotId) return '?';
  return snapshotId.replace(/^DALI_/, '').split('_')[0];
}

export function CasesDimScreen() {
  const { t } = useTranslation();
  const cases = useMartSlice<CaseDimRow>('cases_dim', EMPTY_PARAMS);
  const golds = useMartSlice<GoldRow>('golds', EMPTY_PARAMS);
  const verdicts = useMartSlice<GoldVerdictRow>('gold_verdicts', EMPTY_PARAMS);
  const [q, setQ] = useState('');
  const [riskOnly, setRiskOnly] = useState(false);

  const goldsByCase = useMemo(() => {
    const m = new Map<string, GoldRow[]>();
    for (const g of golds.rows ?? []) {
      if (!g.case_id) continue;
      if (!m.has(g.case_id)) m.set(g.case_id, []);
      m.get(g.case_id)!.push(g);
    }
    return m;
  }, [golds.rows]);

  const verdictsByGold = useMemo(() => {
    const m = new Map<string, GoldVerdictRow[]>();
    for (const v of verdicts.rows ?? []) {
      if (!v.gold_id) continue;
      if (!m.has(v.gold_id)) m.set(v.gold_id, []);
      m.get(v.gold_id)!.push(v);
    }
    return m;
  }, [verdicts.rows]);

  const needle = q.toLowerCase();
  const preFiltered = (cases.rows ?? [])
    .filter(c => !riskOnly || (goldsByCase.get(c.case_id) ?? []).some(g => g.circularity_risk === true))
    .filter(c => !needle
      || c.case_id.toLowerCase().includes(needle)
      || (c.target ?? '').toLowerCase().includes(needle)
      || (c.question ?? '').toLowerCase().includes(needle));
  const table = useRegistryTable(preFiltered, [
    { key: 'case', label: t('bench.reg.case', 'Case'), get: c => c.case_id },
    { key: 'task', label: t('bench.reg.task', 'Task'), fk: true, get: c => c.task_id },
    { key: 'level', label: t('bench.reg.level', 'Level'), fk: true, get: c => c.level_id },
    { key: 'hop', label: t('bench.reg.hop', 'Hop'), fk: true, get: c => c.hop_kind_id },
    { key: 'target', label: t('bench.reg.target', 'Target'), get: c => c.target },
    { key: 'gold_size', label: t('bench.reg.goldSize', 'Size'), get: c => c.gold_size },
  ]);

  if (cases.unavailable) return <PanelMsg kind="info" text={t('bench.unavailable', 'Experiment mart is unavailable')} onRetry={cases.reload} />;
  if (cases.error) return <PanelMsg kind="error" text={cases.error} onRetry={cases.reload} />;
  if (!cases.rows) return <PanelMsg kind="loading" text={t('bench.loading', 'Loading…')} />;

  const nRisk = cases.rows.filter(c => (goldsByCase.get(c.case_id) ?? []).some(g => g.circularity_risk === true)).length;

  return (
    <div>
      <ScreenTitle text={t('bench.reg.casesTitle', 'Cases & gold — the question bank with its answer revisions')}
                   hint={t('bench.reg.casesHint', 'campaigns assemble runs from these cases')} />
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap',
                    marginBottom: 8, fontSize: 12 }}>
        <input value={q} onChange={e => setQ(e.target.value)}
               placeholder={t('bench.reg.searchCaseText', 'search case_id / target / question…')}
               style={{ padding: '4px 8px', fontSize: 12, background: 'var(--bg2)', color: 'var(--t1)',
                        border: '1px solid var(--bd)', borderRadius: 6, width: 280 }} />
        {table.controls}
        <label style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer', color: 'var(--t2)' }}>
          <input type="checkbox" checked={riskOnly} onChange={e => setRiskOnly(e.target.checked)} />
          {t('bench.reg.riskOnly', 'circularity risk only')} ({nRisk}/{cases.rows.length})
        </label>
        <span style={{ color: 'var(--t3)' }}>{table.count} / {cases.rows.length}</span>
      </div>
      <div className="data-panel">
        <table className="data-table">
          <thead>
            <tr>
              {table.th({ key: 'case', label: t('bench.reg.case', 'Case'), get: c => c.case_id })}
              {table.th({ key: 'task', label: t('bench.reg.task', 'Task'), get: c => c.task_id })}
              {table.th({ key: 'level', label: t('bench.reg.level', 'Level'), get: c => c.level_id })}
              {table.th({ key: 'hop', label: t('bench.reg.hop', 'Hop'), get: c => c.hop_kind_id })}
              {table.th({ key: 'target', label: t('bench.reg.target', 'Target'), get: c => c.target })}
              <th>{t('bench.reg.question', 'Question')}</th>
              {table.th({ key: 'gold_size', label: t('bench.reg.gold', 'Gold by epoch'), get: c => c.gold_size })}
            </tr>
          </thead>
          <tbody>
            {table.groups.flatMap(g => [
              ...(g.group ? [(
                <tr key={`g-${g.group}`}>
                  <td colSpan={7} style={{ background: 'var(--bg2)', fontSize: 11, fontWeight: 600,
                                           color: 'var(--t2)' }}>
                    {g.group} · {g.rows.length}
                  </td>
                </tr>
              )] : []),
              ...g.rows.map(c => (
              <tr key={c.case_id}>
                <td style={{ fontFamily: 'var(--mono)', fontSize: 11 }}>{c.case_id}</td>
                <td>{c.task_id ? <span className="scope-tag">{c.task_id}</span> : '—'}</td>
                <td style={{ fontSize: 11, color: 'var(--t2)' }}>{c.level_id ?? '—'}</td>
                <td style={{ fontSize: 11, color: 'var(--t2)' }}>{c.hop_kind_id ?? '—'}</td>
                <td style={{ fontFamily: 'var(--mono)', fontSize: 10, maxWidth: 200, overflow: 'hidden',
                             textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.target ?? '—'}</td>
                <td style={{ fontSize: 11, color: 'var(--t2)', maxWidth: 320 }}>{c.question ?? ''}</td>
                <td>
                  {(goldsByCase.get(c.case_id) ?? []).map(g => (
                    <span key={g.gold_id} style={{ display: 'inline-flex', alignItems: 'center', gap: 3,
                                                   marginRight: 6, whiteSpace: 'nowrap' }}>
                      <span className="scope-tag"
                            title={[g.snapshot_id, g.provenance_type, g.circularity_rationale].filter(Boolean).join(' · ')}>
                        {shortEpoch(g.snapshot_id)}: {g.gold_count ?? '—'}
                      </span>
                      {g.circularity_risk === true && (
                        <span className="badge badge-warn" title={g.circularity_rationale ?? ''}>⚠</span>
                      )}
                      {(verdictsByGold.get(g.gold_id) ?? []).map(v => (
                        <span key={v.verdict_id}
                              className={`badge badge-${VERDICT_TONE[v.kind ?? ''] ?? 'neutral'}`}
                              title={[v.generated_by, v.campaign_id, v.evidence].filter(Boolean).join(' · ')}>
                          {v.kind ?? '?'}
                        </span>
                      ))}
                    </span>
                  ))}
                  {!(goldsByCase.get(c.case_id) ?? []).length && (
                    <span style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--t3)' }}>
                      {c.gold_size ?? '—'}
                    </span>
                  )}
                </td>
              </tr>
              )),
            ])}
          </tbody>
        </table>
      </div>
      <RegistryFooter groups={[
        { label: t('bench.foot.byTask', 'By task'), chips: hist(cases.rows.map(c => c.task_id)) },
        {
          label: t('bench.foot.goldProvenance', 'Gold originates as'),
          chips: hist((golds.rows ?? []).map(g => g.provenance_type ?? undefined)),
        },
        {
          label: t('bench.foot.confirmedBy', 'Confirmed by verdicts'),
          chips: hist((verdicts.rows ?? []).map(v => v.kind)).map(c => ({
            ...c, tone: VERDICT_TONE[c.text.split(' × ')[0]] ?? 'neutral',
          })),
        },
        {
          label: t('bench.foot.circRisk', 'Circularity risk'),
          chips: [{
            text: `${(golds.rows ?? []).filter(g => g.circularity_risk === true).length} / ${(golds.rows ?? []).length}`,
            tone: 'warn',
          }],
        },
      ]} />
    </div>
  );
}

// ── status helpers for method decisions ──────────────────────────────────────

const DEC_STATUS_ORDER: Record<string, number> = { adopted: 0, under_review: 1, superseded: 2 };
const DEC_STATUS_TONE: Record<string, string> = {
  adopted: 'var(--suc)', under_review: 'var(--wrn)', superseded: 'var(--t3)',
};
const DEC_STATUS_LABEL: Record<string, { ru: string; en: string }> = {
  adopted:      { ru: 'принято',     en: 'adopted' },
  under_review: { ru: 'на ревью',    en: 'under review' },
  superseded:   { ru: 'пересмотрено', en: 'superseded' },
};

// ── DecisionsScreen — «Методологические решения / Method Decisions» ──────────

export function DecisionsScreen() {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const [q, setQ] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('');
  const decisions = useMartSlice<DecisionRow>('decisions', EMPTY_PARAMS);

  if (decisions.unavailable) return <PanelMsg kind="info" text={t('bench.unavailable', 'Experiment mart is unavailable')} onRetry={decisions.reload} />;
  if (decisions.error) return <PanelMsg kind="error" text={decisions.error} onRetry={decisions.reload} />;
  if (!decisions.rows) return <PanelMsg kind="loading" text={t('bench.loading', 'Loading…')} />;

  const needle = q.toLowerCase();
  const filtered = (decisions.rows ?? [])
    .filter(d => !statusFilter || d.status === statusFilter)
    .filter(d => !needle
      || d.decision_id.toLowerCase().includes(needle)
      || (d.topic ?? '').toLowerCase().includes(needle)
      || (d.decision ?? '').toLowerCase().includes(needle)
      || (d.rationale ?? '').toLowerCase().includes(needle))
    .slice()
    .sort((a, b) =>
      (DEC_STATUS_ORDER[a.status ?? ''] ?? 9) - (DEC_STATUS_ORDER[b.status ?? ''] ?? 9)
      || (a.topic ?? '').localeCompare(b.topic ?? ''));

  const byStatus = (decisions.rows ?? []).reduce<Record<string, number>>((acc, d) => {
    const s = d.status ?? 'unknown';
    acc[s] = (acc[s] ?? 0) + 1;
    return acc;
  }, {});

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <ScreenTitle
        text={t('bench.decisions.title', 'Методологические решения')}
        hint={`${decisions.rows!.length} решений`}
      />

      {/* filter bar */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <input
          placeholder={t('bench.decisions.search', 'Поиск по теме, тексту, ратионалу…')}
          value={q} onChange={e => setQ(e.target.value)}
          style={{ padding: '3px 8px', fontSize: 12, borderRadius: 4,
            border: '1px solid var(--bd)', background: 'var(--bg)', color: 'var(--t1)',
            minWidth: 260 }}
        />
        {(['', 'adopted', 'under_review', 'superseded'] as const).map(s => (
          <button key={s}
            onClick={() => setStatusFilter(s)}
            style={{
              padding: '2px 10px', fontSize: 11, borderRadius: 10, cursor: 'pointer',
              border: `1px solid ${s === statusFilter ? DEC_STATUS_TONE[s] ?? 'var(--acc)' : 'var(--bd)'}`,
              background: s === statusFilter
                ? `color-mix(in srgb, ${DEC_STATUS_TONE[s] ?? 'var(--acc)'} 18%, transparent)`
                : 'transparent',
              color: s === statusFilter ? (DEC_STATUS_TONE[s] ?? 'var(--acc)') : 'var(--t2)',
            }}>
            {s === '' ? `все · ${decisions.rows!.length}`
              : `${DEC_STATUS_LABEL[s]?.[lang === 'ru' ? 'ru' : 'en'] ?? s} · ${byStatus[s] ?? 0}`}
          </button>
        ))}
      </div>

      {/* decision cards */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {filtered.map(d => {
          const decText  = pickLocale(lang, d.decision_ru_sci, d.decision_en, d.decision, d.decision_ru);
          const ratText  = pickLocale(lang, d.rationale_ru_sci, d.rationale_en, d.rationale, d.rationale_ru);
          const statusColor = DEC_STATUS_TONE[d.status ?? ''] ?? 'var(--t3)';
          const statusLabel = DEC_STATUS_LABEL[d.status ?? '']?.[lang === 'ru' ? 'ru' : 'en'] ?? d.status ?? '—';
          return (
            <div key={d.decision_id}
                 style={{
                   border: '1px solid var(--bd)', borderRadius: 6, padding: '10px 14px',
                   borderLeft: `3px solid ${statusColor}`,
                   background: 'color-mix(in srgb, var(--bg2) 40%, transparent)',
                 }}>
              {/* header */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <span style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--t3)' }}>
                  {d.decision_id}
                </span>
                {d.topic && (
                  <span style={{
                    fontSize: 10, padding: '1px 6px', borderRadius: 3,
                    background: 'color-mix(in srgb, var(--acc) 12%, transparent)',
                    border: '1px solid color-mix(in srgb, var(--acc) 30%, transparent)',
                    color: 'var(--acc)',
                  }}>{d.topic}</span>
                )}
                {d.phase_id && (
                  <span style={{ fontSize: 10, color: 'var(--t3)' }}>{d.phase_id}</span>
                )}
                <span style={{ marginLeft: 'auto', fontSize: 10, color: statusColor }}>
                  {statusLabel}
                </span>
                {d.created_ts && (
                  <span style={{ fontSize: 10, color: 'var(--t3)' }}>{d.created_ts}</span>
                )}
              </div>

              {/* decision text */}
              {decText && (
                <div style={{ marginTop: 6, fontSize: 13, color: 'var(--t1)', lineHeight: 1.5 }}>
                  {decText}
                </div>
              )}

              {/* rationale */}
              {ratText && (
                <details style={{ marginTop: 6 }}>
                  <summary style={{ cursor: 'pointer', fontSize: 11, color: 'var(--acc)' }}>
                    {t('bench.decisions.rationale', 'обоснование')}
                  </summary>
                  <MartProse text={ratText} style={{ padding: '4px 0 0 14px', maxWidth: 900 }} />
                </details>
              )}
            </div>
          );
        })}
        {filtered.length === 0 && (
          <div style={{ color: 'var(--t3)', fontSize: 12, padding: '12px 0' }}>
            {t('bench.noMatch', 'Нет совпадений')}
          </div>
        )}
      </div>
    </div>
  );
}
