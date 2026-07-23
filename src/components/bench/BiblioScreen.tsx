import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ReactFlow, Controls, Background, BackgroundVariant,
  Handle, Position, type NodeProps, type Node, type Edge, type ReactFlowInstance,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import ELK from 'elkjs/lib/elk.bundled.js';
import { MartProse } from './MartProse';
import { fetchMartSlice, muninnFileUrl } from '../../api/muninn';

/* ELK runs in-process (bundled build, no worker) — one instance for the module */
const elk = new ELK();

/* ── Types ──────────────────────────────────────────────────────────── */
type LangMode   = 'ru' | 'ru_sci' | 'en';
type BiblioView = 'cards' | 'slice' | 'graph';

interface HarmoNode {
  node_id:            string;
  kind:               string;
  title:              string | null;
  label_ru:           string | null;
  label_en:           string | null;
  summary_ru:         string | null;
  summary_en:         string | null;
  description_ru_sci: string | null;
  description_en:     string | null;
}

interface InterNodeEdge {
  from_node: string;
  to_node:   string;
  edge_type: string;
}

interface RefRow {
  ref_id:               string;
  citation:             string | null;
  source_role:          string | null;
  ref_group:            string | null;
  year:                 number | null;
  link:                 string | null;
  description:          string | null;
  description_ru:       string | null;
  description_en:       string | null;
  relevance_ru:         string | null;
  relevance_ru_sci:     string | null;
  relevance_en:         string | null;
  relevance:            string | null;
  takeaway_ru:          string | null;
  takeaway_ru_sci:      string | null;
  takeaway_en:          string | null;
  takeaway:             string | null;
  group_overview_ru:    string | null;
  group_overview_ru_sci:string | null;
  group_overview_en:    string | null;
  group_overview:       string | null;
}

interface SourceRow { source_id: string; ref_id: string | null; kind: string | null; url: string | null; annotation: string | null; }
interface MethodCardRow { card_id: string; ref_id: string | null; name: string | null; group_name: string | null; date: string | null; bird: string | null; spider: string | null; link: string | null; tldr: string | null; architecture: string | null; prep: string | null; method: string | null; results: string | null; findings: string | null; hound: string | null; mermaid: string | null; md: string | null; }

interface TopicRow {
  topic_id:  string;
  label_ru:  string | null;
  label_en:  string | null;
}

interface RefTopicRow {
  ref_id: string;
  topics: string[] | null;
}

interface NodeEdgeRaw {
  node_id:    string;
  edge_types: string[] | null;
  to_refs:    string[] | null;
}

interface EdgeLink {
  from_node:  string;
  to_ref:     string;
  edge_type:  string;
}

/* ── Mart-slice fetch ───────────────────────────────────────────────────
 * Goes through the backend mart (named slices) like the rest of the bench
 * panel — the browser sends NO SQL and NO ArcadeDB credentials. SQL templates
 * live server-side in MartSlices (biblio_* slices). */
const fetchSlice = fetchMartSlice;

/* Reference link normalizer: the `link` field holds heterogeneous values —
 * full URLs, bare arXiv codes ("arXiv:2503.11984"), DOIs, or benchmark-repo
 * doc paths ("docs/...."). Build a real href so the card link actually opens. */
function resolveRefUrl(link: string): string {
  const s = link.trim();
  if (/^https?:\/\//i.test(s)) return s;                       // already a URL
  const arxiv = s.match(/^arxiv:\s*(.+)$/i);                   // arXiv:2503.11984
  if (arxiv) return `https://arxiv.org/abs/${arxiv[1].trim()}`;
  const doi = s.match(/^doi:\s*(.+)$/i);                       // doi:10.1145/3725278
  if (doi) return `https://doi.org/${doi[1].trim()}`;
  if (/^10\.\d{4,}\//.test(s)) return `https://doi.org/${s}`;  // bare DOI
  const acl = s.match(/^aclanthology:\s*(.+)$/i);              // aclanthology:2020.emnlp-main.564
  if (acl) return `https://aclanthology.org/${acl[1].trim()}/`;
  if (/^(docs|results|backups)\//.test(s)) return muninnFileUrl(s); // repo file
  return s;
}

/* ── Language picker ────────────────────────────────────────────────── */
function pick(mode: LangMode,
  ru:     string | null | undefined,
  ru_sci: string | null | undefined,
  en:     string | null | undefined,
  base?:  string | null,
): string {
  if (mode === 'ru')     return ru     ?? base ?? ru_sci ?? en ?? '';
  if (mode === 'ru_sci') return ru_sci ?? base ?? ru     ?? en ?? '';
  return                        en     ?? base ?? ru_sci ?? ru ?? '';
}

/* ── Edge & role metadata ───────────────────────────────────────────── */
const EDGE_STYLE: Record<string, { color: string; stroke: string; label: string; dashed?: boolean; weight: number }> = {
  /* construct → reference */
  BASED_ON:     { color: 'var(--suc)', stroke: '#4caf50', label: 'метод-донор',    weight: 2 },
  CALIBRATED_BY:{ color: 'var(--acc)', stroke: '#2196f3', label: 'калибр',         weight: 2 },
  GROUNDED_IN:  { color: 'var(--t3)',  stroke: '#9e9e9e', label: 'концепт взят',   weight: 1 },
  CHALLENGED_BY:{ color: 'var(--err)', stroke: '#f44336', label: 'антитезис',      weight: 1, dashed: true },
  REF_TOPIC:    { color: 'var(--t3)',  stroke: '#bbb',    label: 'тема',           weight: 1 },
  /* inter-node (ExpHarmonizationNode → ExpHarmonizationNode) */
  HAS_CHILD:    { color: 'var(--t3)',  stroke: '#607d8b', label: 'дочерний',       weight: 1, dashed: true  },
  GROUNDS:      { color: 'var(--war)', stroke: '#ff8a65', label: 'основание',      weight: 1 },
  EXTENDS:      { color: 'var(--acc)', stroke: '#4db6ac', label: 'расширяет',      weight: 1 },
  PARALLELS:    { color: 'var(--t2)',  stroke: '#ba68c8', label: 'параллельно',    weight: 1 },
  INSTRUMENTS:  { color: 'var(--inf)', stroke: '#26c6da', label: 'измеряет',       weight: 1 },
};
const EDGE_ORDER = ['BASED_ON', 'CALIBRATED_BY', 'GROUNDED_IN', 'CHALLENGED_BY'];

// influence of a source ON OUR method: a method donor far outweighs a topical
// tie. Summed over a ref's incoming edges → vertical rank (high = top).
const INFLUENCE_WEIGHT: Record<string, number> = {
  BASED_ON: 4, CALIBRATED_BY: 3, GROUNDED_IN: 2, CHALLENGED_BY: 1.5, REF_TOPIC: 0.5,
};

const ROLE_COLOR: Record<string, string> = {
  method_grounding:    'var(--acc)',
  baseline_competitor: 'var(--war)',
  synthesis_agent:     'var(--suc)',
  complexity_calibre:  'var(--t2)',
  method_donor:        'var(--acc)',
  error_taxonomy:      'var(--err)',
  boundary_caution:    'var(--war)',
  data_model:          'var(--t3)',
};

/* ── ── ── Cards View ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── */
function CardsView({
  refs, topics, refTopics, lang, srcByRef, cardsByRef,
}: {
  refs: RefRow[];
  topics: TopicRow[];
  refTopics: Map<string, string[]>;
  lang: LangMode;
  srcByRef: Map<string, SourceRow[]>;
  cardsByRef: Map<string, MethodCardRow[]>;
}) {
  const [search,   setSearch]   = useState('');
  const [role,     setRole]     = useState('');
  const [group,    setGroup]    = useState('');
  const [topicFilter, setTopicFilter] = useState<string[]>([]);
  const [yearMin,  setYearMin]  = useState<number | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  const roles  = useMemo(() => [...new Set(refs.map(r => r.source_role).filter(Boolean))] as string[], [refs]);
  const groups = useMemo(() => [...new Set(refs.map(r => r.ref_group).filter(Boolean))] as string[], [refs]);
  const years  = useMemo(() => {
    const ys = refs.map(r => r.year).filter(Boolean) as number[];
    return { min: Math.min(...ys), max: Math.max(...ys) };
  }, [refs]);

  const topicMap = useMemo(() => {
    const m = new Map<string, TopicRow>();
    topics.forEach(t => m.set(t.topic_id, t));
    return m;
  }, [topics]);

  const visible = useMemo(() => refs.filter(r => {
    if (role  && r.source_role !== role)  return false;
    if (group && r.ref_group   !== group) return false;
    if (yearMin && r.year && r.year < yearMin) return false;
    if (topicFilter.length) {
      const tids = refTopics.get(r.ref_id) ?? [];
      if (!topicFilter.every(t => tids.includes(t))) return false;
    }
    if (search) {
      const q = search.toLowerCase();
      return (r.ref_id + ' ' + (r.citation ?? '')).toLowerCase().includes(q);
    }
    return true;
  }), [refs, role, group, yearMin, topicFilter, search, refTopics]);

  function toggleTopic(tid: string) {
    setTopicFilter(prev =>
      prev.includes(tid) ? prev.filter(x => x !== tid) : [...prev, tid],
    );
  }

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* Filter bar */}
      <div style={S.filterArea}>
        <div style={S.filterRow}>
          <input
            style={S.searchIn}
            placeholder="поиск по источникам…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
          <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--t3)', flexShrink: 0 }}>{visible.length}/{refs.length}</span>
        </div>
        <div style={S.filterRow}>
          <span style={S.filterLabel}>роль</span>
          <span style={{ ...S.chip, ...(role === '' ? S.chipActive : {}) }} onClick={() => setRole('')}>все</span>
          {roles.map(r => (
            <span key={r} style={{ ...S.chip, ...(role === r ? S.chipActive : {}), borderColor: ROLE_COLOR[r] ?? 'var(--bd)' }}
              onClick={() => setRole(role === r ? '' : r)}>{r}</span>
          ))}
        </div>
        <div style={S.filterRow}>
          <span style={S.filterLabel}>группа</span>
          <span style={{ ...S.chip, ...(group === '' ? S.chipActive : {}) }} onClick={() => setGroup('')}>все</span>
          {groups.map(g => (
            <span key={g} style={{ ...S.chip, ...(group === g ? S.chipActive : {}) }}
              onClick={() => setGroup(group === g ? '' : g)}>{g}</span>
          ))}
        </div>
        {topics.length > 0 && (
          <div style={S.filterRow}>
            <span style={S.filterLabel}>темы</span>
            {topics.map(t => {
              const label = lang === 'en' ? (t.label_en ?? t.topic_id) : (t.label_ru ?? t.topic_id);
              const active = topicFilter.includes(t.topic_id);
              return (
                <span key={t.topic_id} style={{ ...S.chip, ...(active ? S.chipActive : {}) }}
                  onClick={() => toggleTopic(t.topic_id)}>{label}</span>
              );
            })}
          </div>
        )}
        {(years.min !== Infinity) && (
          <div style={S.filterRow}>
            <span style={S.filterLabel}>год ≥</span>
            {[null, years.min, 2022, 2023, 2024, 2025].filter(y => y === null || (y >= years.min && y <= years.max)).map(y => (
              <span key={String(y)} style={{ ...S.chip, ...(yearMin === y ? S.chipActive : {}) }}
                onClick={() => setYearMin(y)}>{y === null ? 'все' : y}</span>
            ))}
          </div>
        )}
      </div>

      {/* Cards */}
      <div style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden' }} className="lore-panel-scroll">
        {visible.map(r => {
          const isOpen      = expanded === r.ref_id;
          const description = pick(lang, r.description_ru, null, r.description_en, r.description);
          const relevance   = pick(lang, r.relevance_ru, r.relevance_ru_sci, r.relevance_en, r.relevance);
          const takeaway    = pick(lang, r.takeaway_ru, r.takeaway_ru_sci, r.takeaway_en, r.takeaway);
          const groupOv     = pick(lang, r.group_overview_ru, r.group_overview_ru_sci, r.group_overview_en, r.group_overview);
          const cardTopics  = refTopics.get(r.ref_id) ?? [];
          const refSrcs     = srcByRef.get(r.ref_id) ?? [];
          const refCards    = cardsByRef.get(r.ref_id) ?? [];
          return (
            <div key={r.ref_id} style={{ ...S.card, ...(isOpen ? S.cardOpen : {}) }}>
              <div style={S.cardHead} onClick={() => setExpanded(isOpen ? null : r.ref_id)}>
                <div style={S.cardMeta}>
                  {r.year && <span style={S.mono}>{r.year}</span>}
                  <span style={{ ...S.mono, color: 'var(--acc)', fontWeight: 600 }}>{r.ref_id}</span>
                  {r.source_role && (
                    <span style={{ ...S.roleBadge, color: ROLE_COLOR[r.source_role] ?? 'var(--t2)' }}>
                      {r.source_role}
                    </span>
                  )}
                  {r.ref_group && <span style={S.groupBadge}>{r.ref_group}</span>}
                  {cardTopics.map(tid => {
                    const t = topicMap.get(tid);
                    const lbl = t ? (lang === 'en' ? (t.label_en ?? tid) : (t.label_ru ?? tid)) : tid;
                    return <span key={tid} style={S.topicChip}>{lbl}</span>;
                  })}
                  {r.link && (
                    <a href={resolveRefUrl(r.link)} target="_blank" rel="noopener noreferrer"
                      style={{ marginLeft: 'auto', fontSize: 'var(--fs-xs)', color: 'var(--acc)' }}
                      onClick={e => e.stopPropagation()}>↗</a>
                  )}
                  <span style={{ color: 'var(--t3)', fontSize: 'var(--fs-sm)', flexShrink: 0, marginLeft: r.link ? 6 : 'auto' }}>
                    {isOpen ? '▲' : '▼'}
                  </span>
                </div>
                <span style={S.citation}>{r.citation}</span>
                {description && <MartProse text={description} style={{ fontSize: 'var(--fs-sm)', color: 'var(--t2)', margin: '2px 0 0', lineHeight: 1.5 }} />}
                {takeaway && <MartProse text={takeaway} style={{ fontSize: 'var(--fs-sm)', color: 'var(--t3)', margin: '2px 0 0', fontStyle: 'italic' }} />}
                {refSrcs.length > 0 && (
                  <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', marginTop: 4 }}>
                    {refSrcs.map(s => {
                      const SRC_LABELS: Record<string, string> = { arxiv: 'arXiv', github: 'GitHub', huggingface: 'HF', doi: 'DOI', project: 'project', other: 'link', status: 'нет репо' };
                      const label = SRC_LABELS[s.kind ?? ''] ?? s.kind ?? 'src';
                      const muted = s.kind === 'status' || !s.url;
                      const chip = { fontSize: 'var(--fs-xs)', padding: '1px 5px', borderRadius: 3, whiteSpace: 'nowrap' as const,
                        border: `1px solid color-mix(in srgb, ${muted ? 'var(--t3)' : 'var(--acc)'} 35%, transparent)`,
                        background: `color-mix(in srgb, ${muted ? 'var(--t3)' : 'var(--acc)'} 12%, transparent)`,
                        color: muted ? 'var(--t3)' : 'var(--acc)', textDecoration: 'none' as const };
                      return muted
                        ? <span key={s.source_id} title={s.annotation ?? undefined} style={chip}>{label}</span>
                        : <a key={s.source_id} href={s.url!} target="_blank" rel="noopener noreferrer" title={s.annotation ?? undefined} style={chip}>{label} ↗</a>;
                    })}
                  </div>
                )}
              </div>
              {isOpen && (
                <div style={S.cardBody}>
                  {groupOv && (
                    <div style={S.groupOvSection}>
                      <span style={S.sectionLabel}>Обзор группы · {r.ref_group}</span>
                      <MartProse text={groupOv} />
                    </div>
                  )}
                  {relevance && (
                    <div style={{ marginTop: groupOv ? 12 : 0 }}>
                      <span style={S.sectionLabel}>Релевантность</span>
                      <MartProse text={relevance} />
                    </div>
                  )}
                  {refCards.map(mc => (
                    <div key={mc.card_id} style={{ marginTop: 10, borderRadius: 5, padding: '6px 10px',
                      border: '1px solid color-mix(in srgb, var(--acc) 25%, transparent)',
                      background: 'color-mix(in srgb, var(--acc) 6%, transparent)' }}>
                      {/* header */}
                      <div style={{
                        padding: '4px 8px', margin: '-6px -8px 6px',
                        display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap',
                        borderBottom: '1px solid color-mix(in srgb, var(--acc) 15%, transparent)',
                      }}>
                        <span style={{ fontSize: 'var(--fs-md)', fontWeight: 700, color: 'var(--t1)' }}>{mc.name ?? mc.card_id}</span>
                        {mc.group_name && <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--t3)' }}>{mc.group_name}</span>}
                        {mc.date && <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--t3)' }}>· {mc.date}</span>}
                        <span style={{ flex: 1 }} />
                        {(mc.bird || mc.spider) && (
                          <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--acc)' }}>
                            {[mc.bird ? `BIRD ${mc.bird}` : null, mc.spider ? `Spider ${mc.spider}` : null].filter(Boolean).join(' · ')}
                          </span>
                        )}
                        {mc.link && <a href={mc.link} target="_blank" rel="noopener noreferrer" style={{ fontSize: 'var(--fs-xs)', color: 'var(--acc)', textDecoration: 'none' }}>↗</a>}
                      </div>
                      {mc.tldr && (
                        <p style={{
                          margin: '0 0 6px', fontSize: 'var(--fs-base)', color: 'var(--t2)', lineHeight: 1.55, fontStyle: 'italic',
                          borderLeft: '2px solid color-mix(in srgb, var(--acc) 40%, transparent)', paddingLeft: 8,
                        }}>{mc.tldr}</p>
                      )}
                      {mc.hound && (
                        <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--wrn)', lineHeight: 1.5, marginBottom: 6 }}>
                          <span style={{ fontWeight: 700 }}>↳ HOUND: </span>{mc.hound}
                        </div>
                      )}
                      {mc.mermaid && (
                        <MartProse text={'```mermaid\n' + mc.mermaid + '\n```'} style={{ marginTop: 4 }} />
                      )}
                      {(mc.architecture || mc.prep || mc.method || mc.results || mc.findings) && (
                        <details style={{ marginTop: 6 }}>
                          <summary style={{ cursor: 'pointer', fontSize: 'var(--fs-xs)', color: 'var(--t3)', userSelect: 'none' }}>детали методики</summary>
                          <div style={{ paddingTop: 5, display: 'flex', flexDirection: 'column', gap: 5 }}>
                            {([
                              { label: 'Архитектура', val: mc.architecture },
                              { label: 'Данные',      val: mc.prep },
                              { label: 'Метод',       val: mc.method },
                              { label: 'Результаты',  val: mc.results },
                              { label: 'Выводы',      val: mc.findings },
                            ] as { label: string; val: string | null }[]).filter(s => s.val).map(s => (
                              <div key={s.label} style={{ fontSize: 'var(--fs-sm)', lineHeight: 1.5 }}>
                                <span style={{ color: 'var(--t3)', fontWeight: 600 }}>{s.label}: </span>
                                <span style={{ color: 'var(--t2)' }}>{s.val}</span>
                              </div>
                            ))}
                          </div>
                        </details>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
        {visible.length === 0 && <div style={S.empty}>Источники не найдены.</div>}
      </div>
    </div>
  );
}

/* ── ── ── Slice View ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── */
function SliceView({
  nodes, refs, edges, interEdges = [], lang,
}: {
  nodes: HarmoNode[];
  refs: RefRow[];
  edges: EdgeLink[];
  interEdges?: InterNodeEdge[];
  lang: LangMode;
}) {
  const [nodeId, setNodeId] = useState(nodes[0]?.node_id ?? '');

  const refMap = useMemo(() => {
    const m = new Map<string, RefRow>();
    refs.forEach(r => m.set(r.ref_id, r));
    return m;
  }, [refs]);

  const nodeEdges = useMemo(() => edges.filter(e => e.from_node === nodeId), [edges, nodeId]);

  const byType = useMemo(() => {
    const m = new Map<string, EdgeLink[]>();
    EDGE_ORDER.forEach(t => m.set(t, []));
    nodeEdges.forEach(e => {
      if (!m.has(e.edge_type)) m.set(e.edge_type, []);
      m.get(e.edge_type)!.push(e);
    });
    return m;
  }, [nodeEdges]);

  const nodeMap = useMemo(() => {
    const m = new Map<string, HarmoNode>();
    nodes.forEach(n => m.set(n.node_id, n));
    return m;
  }, [nodes]);

  const childrenOf = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const e of interEdges.filter(ie => ie.edge_type === 'HAS_CHILD'))
      m.set(e.from_node, [...(m.get(e.from_node) ?? []), e.to_node]);
    return m;
  }, [interEdges]);

  const childSet = useMemo(
    () => new Set(interEdges.filter(ie => ie.edge_type === 'HAS_CHILD').map(ie => ie.to_node)),
    [interEdges],
  );

  const domains = useMemo(() => nodes.filter(n => n.kind === 'domain'), [nodes]);
  const orphans = useMemo(
    () => nodes.filter(n => n.kind !== 'domain' && !childSet.has(n.node_id)),
    [nodes, childSet],
  );

  const [descLang, setDescLang] = useState<'ru_sci' | 'en'>('ru_sci');

  const currentNode = nodes.find(n => n.node_id === nodeId);
  const nodeLabel   = currentNode
    ? pick(lang, currentNode.label_ru, null, currentNode.label_en) || currentNode.title || currentNode.node_id
    : '';
  const nodeSummary = currentNode
    ? pick(lang, currentNode.summary_ru, null, currentNode.summary_en)
    : '';

  const challenged  = byType.get('CHALLENGED_BY') ?? [];

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* Node selector — domains as group headers, vectors as buttons */}
      <div style={S.nodeBar}>
        {domains.length > 0 ? (
          <>
            {domains.map(d => {
              const dLabel   = pick(lang, d.label_ru, null, d.label_en) || d.title || d.node_id;
              const children = (childrenOf.get(d.node_id) ?? [])
                .map(cid => nodeMap.get(cid))
                .filter((n): n is HarmoNode => !!n);
              return (
                <div key={d.node_id} style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                  <div style={{
                    fontSize: 'var(--fs-2xs)', fontWeight: 700, color: 'var(--t3)', textTransform: 'uppercase' as const,
                    letterSpacing: '0.07em', padding: '1px 6px', borderBottom: '1px solid var(--bd)', whiteSpace: 'nowrap',
                  }}>▤ {dLabel}</div>
                  <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' as const, paddingLeft: 8 }}>
                    {children.map(n => (
                      <button key={n.node_id}
                        style={{ ...S.nodeBtn, ...(nodeId === n.node_id ? S.nodeBtnActive : {}) }}
                        onClick={() => setNodeId(n.node_id)}
                        title={pick(lang, n.label_ru, null, n.label_en) || n.title || ''}
                      >
                        <span style={{ fontFamily: 'var(--mono)', fontSize: 'var(--fs-sm)', fontWeight: 700 }}>{n.node_id}</span>
                        {n.kind === 'mirror' && <span style={S.mirrorDot} />}
                      </button>
                    ))}
                  </div>
                </div>
              );
            })}
            {orphans.map(n => (
              <button key={n.node_id}
                style={{ ...S.nodeBtn, ...(nodeId === n.node_id ? S.nodeBtnActive : {}) }}
                onClick={() => setNodeId(n.node_id)}
                title={pick(lang, n.label_ru, null, n.label_en) || n.title || ''}
              >
                <span style={{ fontFamily: 'var(--mono)', fontSize: 'var(--fs-sm)', fontWeight: 700 }}>{n.node_id}</span>
                {n.kind === 'mirror' && <span style={S.mirrorDot} />}
              </button>
            ))}
          </>
        ) : (
          nodes.map(n => (
            <button key={n.node_id}
              style={{ ...S.nodeBtn, ...(nodeId === n.node_id ? S.nodeBtnActive : {}) }}
              onClick={() => setNodeId(n.node_id)}
              title={pick(lang, n.label_ru, null, n.label_en) || n.title || ''}
            >
              <span style={{ fontFamily: 'var(--mono)', fontSize: 'var(--fs-sm)', fontWeight: 700 }}>{n.node_id}</span>
              {n.kind === 'mirror' && <span style={S.mirrorDot} />}
            </button>
          ))
        )}
      </div>

      {/* Node card */}
      {currentNode && (
        <div style={S.nodeSummaryBox}>
          <span style={S.nodeLabel}>{nodeLabel}</span>
          {nodeSummary && <span style={{ fontSize: 'var(--fs-sm)', color: 'var(--t2)', lineHeight: 1.5, display: 'block', marginTop: 2 }}>
            {nodeSummary.slice(0, 260)}{nodeSummary.length > 260 ? '…' : ''}
          </span>}
          {challenged.length > 0 && (
            <div style={S.challengedBanner}>
              <span style={{ color: EDGE_STYLE.CHALLENGED_BY.color, fontWeight: 700 }}>⚡ Антитезисы ({challenged.length}):</span>
              {' '}{challenged.map(e => refMap.get(e.to_ref)?.ref_id ?? e.to_ref).join(', ')}
            </div>
          )}
          {/* Markdown description (V5/V6) with language toggle */}
          {(currentNode.description_ru_sci || currentNode.description_en) && (
            <div style={{ marginTop: 8, borderTop: '1px solid var(--bd)', paddingTop: 8 }}>
              <div style={{ display: 'flex', alignItems: 'center', marginBottom: 6 }}>
                <span style={S.sectionLabel}>Описание</span>
                <div style={{ marginLeft: 'auto', display: 'flex', gap: 2 }}>
                  {currentNode.description_ru_sci && (
                    <button
                      style={{ ...S.switchBtn, ...(descLang === 'ru_sci' ? S.switchBtnActive : {}), padding: '1px 6px', fontSize: 'var(--fs-xs)' }}
                      onClick={() => setDescLang('ru_sci')}
                    >RU науч</button>
                  )}
                  {currentNode.description_en && (
                    <button
                      style={{ ...S.switchBtn, ...(descLang === 'en' ? S.switchBtnActive : {}), padding: '1px 6px', fontSize: 'var(--fs-xs)' }}
                      onClick={() => setDescLang('en')}
                    >EN</button>
                  )}
                </div>
              </div>
              {(descLang === 'ru_sci' ? currentNode.description_ru_sci : currentNode.description_en) && (
                <MartProse
                  text={(descLang === 'ru_sci' ? currentNode.description_ru_sci : currentNode.description_en)!}
                  style={{ fontSize: 'var(--fs-sm)' }}
                />
              )}
            </div>
          )}
        </div>
      )}

      {/* Refs + inter-node edges */}
      <div style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden' }} className="lore-panel-scroll">
        {EDGE_ORDER.map(etype => {
          const links = byType.get(etype) ?? [];
          if (!links.length) return null;
          const es = EDGE_STYLE[etype];
          return (
            <div key={etype} style={{ marginBottom: 4 }}>
              <div style={{ ...S.edgeSection, borderLeft: `3px solid ${es.color}` }}>
                <span style={{ color: es.color, fontSize: 'var(--fs-xs)', fontWeight: 700, textTransform: 'uppercase' as const, letterSpacing: '0.08em' }}>
                  {etype}
                </span>
                <span style={{ color: 'var(--t3)', fontSize: 'var(--fs-xs)' }}>· {es.label} · {links.length}</span>
              </div>
              {links.map(e => {
                const ref      = refMap.get(e.to_ref);
                const takeaway = ref ? pick(lang, ref.takeaway_ru, ref.takeaway_ru_sci, ref.takeaway_en, ref.takeaway) : '';
                return (
                  <div key={e.to_ref} style={S.sliceRef}>
                    <div style={S.sliceRefHead}>
                      <span style={{ ...S.mono, color: 'var(--acc)', fontWeight: 600, fontSize: 'var(--fs-sm)' }}>
                        {ref?.ref_id ?? e.to_ref}
                      </span>
                      {ref?.year && <span style={{ ...S.mono, fontSize: 'var(--fs-xs)', color: 'var(--t3)' }}>{ref.year}</span>}
                      {ref?.source_role && (
                        <span style={{ ...S.roleBadge, color: ROLE_COLOR[ref.source_role] ?? 'var(--t2)' }}>
                          {ref.source_role}
                        </span>
                      )}
                    </div>
                    {ref?.citation && <span style={S.citation}>{ref.citation}</span>}
                    {takeaway && <MartProse text={takeaway} style={{ fontSize: 'var(--fs-sm)', color: 'var(--t3)', margin: '2px 0 0' }} />}
                  </div>
                );
              })}
            </div>
          );
        })}

        {/* Inter-node structural edges */}
        {(() => {
          const outgoing = interEdges.filter(ie => ie.from_node === nodeId);
          const incoming = interEdges.filter(ie => ie.to_node === nodeId && ie.edge_type !== 'HAS_CHILD');
          if (!outgoing.length && !incoming.length) return null;
          const items = [
            ...outgoing.map(ie => ({ ...ie, dir: 'out' as const })),
            ...incoming.map(ie => ({ ...ie, dir: 'in'  as const })),
          ];
          return (
            <div style={{ marginBottom: 4 }}>
              <div style={{ ...S.edgeSection, borderLeft: '3px solid var(--t3)' }}>
                <span style={{ color: 'var(--t3)', fontSize: 'var(--fs-xs)', fontWeight: 700, textTransform: 'uppercase' as const, letterSpacing: '0.08em' }}>
                  Связи между конструктами
                </span>
                <span style={{ color: 'var(--t3)', fontSize: 'var(--fs-xs)' }}>· {items.length}</span>
              </div>
              {items.map((ie, i) => {
                const es      = EDGE_STYLE[ie.edge_type];
                const peerId  = ie.dir === 'out' ? ie.to_node : ie.from_node;
                const peer    = nodeMap.get(peerId);
                const peerLbl = peer ? (pick(lang, peer.label_ru, null, peer.label_en) || peer.title || peerId) : peerId;
                return (
                  <div key={i} style={{ ...S.sliceRef, borderLeft: `3px solid ${es?.stroke ?? '#888'}` }}>
                    <div style={S.sliceRefHead}>
                      <span style={{ fontSize: 'var(--fs-xs)', fontWeight: 700, color: es?.stroke ?? 'var(--t2)' }}>{ie.edge_type}</span>
                      <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--t3)' }}>{es?.label}</span>
                      <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--t2)' }}>{ie.dir === 'out' ? '→' : '←'}</span>
                      <span style={{ ...S.mono, color: 'var(--acc)', fontWeight: 600, fontSize: 'var(--fs-sm)' }}>{peerId}</span>
                      {peerLbl !== peerId && <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--t3)' }}>{peerLbl}</span>}
                    </div>
                  </div>
                );
              })}
            </div>
          );
        })()}

        {nodeEdges.length === 0 && interEdges.filter(ie => ie.from_node === nodeId || ie.to_node === nodeId).length === 0 && (
          <div style={S.empty}>Нет связей для этого конструкта.</div>
        )}
      </div>
    </div>
  );
}

/* ── ReactFlow custom nodes (defined outside render for stable reference) ── */
interface ConstructData extends Record<string, unknown> {
  node_id:    string;
  kind:       string;
  label:      string;
  edgeCount:  number;
  isSelected: boolean;
  dimmed:     boolean;
}
interface SourceData extends Record<string, unknown> {
  ref_id:      string;
  year:        number | null;
  source_role: string | null;
  ref_group:   string | null;
  primaryEdge: string;
  isSelected:  boolean;
  dimmed:      boolean;
  influence:   number;
}

function ConstructNodeComp({ data }: NodeProps) {
  const d        = data as unknown as ConstructData;
  const isSel    = d.isSelected;
  const isDomain = d.kind === 'domain';
  return (
    <div style={{
      background:   isDomain
        ? 'color-mix(in srgb, var(--t3) 8%, var(--bg2))'
        : isSel ? 'var(--acc)' : 'var(--bg2)',
      border:       isDomain
        ? `2px dashed ${isSel ? 'var(--acc)' : 'var(--bd)'}`
        : `2px solid ${isSel ? 'var(--acc)' : 'var(--bd)'}`,
      borderRadius: 7,
      padding:      '8px 14px',
      minWidth:     160,
      cursor:       'pointer',
      fontFamily:   'var(--mono)',
      transition:   'all 0.15s',
      opacity:      d.dimmed ? 0.35 : 1,
    }}>
      {/* ref-edges: Right→Left; HAS_CHILD same; construct-construct: Bottom→Top */}
      <Handle type="source" position={Position.Right}  isConnectable={false} style={{ opacity: 0, pointerEvents: 'none' }} />
      <Handle type="target" position={Position.Left}   isConnectable={false} style={{ opacity: 0, pointerEvents: 'none' }} />
      <Handle type="source" id="bot" position={Position.Bottom} isConnectable={false} style={{ opacity: 0, pointerEvents: 'none' }} />
      <Handle type="target" id="top" position={Position.Top}    isConnectable={false} style={{ opacity: 0, pointerEvents: 'none' }} />
      <div style={{ fontWeight: 700, fontSize: 'var(--fs-base)', color: isDomain ? 'var(--t2)' : isSel ? '#fff' : 'var(--acc)' }}>
        {isDomain && <span style={{ fontSize: 'var(--fs-2xs)', marginRight: 4, opacity: 0.7 }}>▤</span>}
        {d.node_id}
      </div>
      {d.label && (
        <div style={{ fontSize: 'var(--fs-xs)', marginTop: 2, color: isSel ? 'rgba(255,255,255,0.75)' : 'var(--t3)',
                      lineHeight: 1.35, wordBreak: 'break-word' }}>
          {d.label}
        </div>
      )}
      <div style={{ fontSize: 'var(--fs-2xs)', marginTop: 3, color: isSel ? 'rgba(255,255,255,0.55)' : 'var(--t3)' }}>
        {d.edgeCount} связей
      </div>
    </div>
  );
}

function SourceNodeComp({ data }: NodeProps) {
  const d      = data as unknown as SourceData;
  const border = EDGE_STYLE[d.primaryEdge]?.stroke ?? 'var(--bd)';
  const isSel  = d.isSelected;
  return (
    <div style={{
      background:    isSel ? 'color-mix(in srgb, var(--acc) 12%, var(--bg1))' : 'var(--bg1)',
      border:        `1px solid ${isSel ? 'var(--acc)' : border}`,
      outline:       isSel ? '2px solid var(--acc)' : 'none',
      outlineOffset: 1,
      borderRadius:  4,
      padding:       '2px 8px',
      cursor:        'pointer',
      transition:    'all 0.12s',
      fontFamily:    'var(--mono)',
      opacity:       d.dimmed ? 0.2 : 1,
      display:       'flex',
      alignItems:    'center',
      gap:           6,
      whiteSpace:    'nowrap',
    }}>
      <Handle type="target" position={Position.Left} isConnectable={false}
        style={{ opacity: 0, pointerEvents: 'none' }} />
      <span style={{ fontWeight: 600, fontSize: 'var(--fs-xs)', color: 'var(--acc)' }}>{d.ref_id}</span>
      {d.year     && <span style={{ fontSize: 'var(--fs-2xs)', color: 'var(--t3)' }}>{d.year}</span>}
      {d.ref_group && <span style={{ fontSize: 'var(--fs-2xs)', color: 'var(--t3)', opacity: 0.7 }}>{d.ref_group}</span>}
      <span title="влияние" style={{
        marginLeft: 'auto', paddingLeft: 6,
        fontSize: 'var(--fs-2xs)', fontWeight: 700, color: 'var(--suc)',
      }}>▲{d.influence.toFixed(1)}</span>
    </div>
  );
}

const RF_NODE_TYPES = {
  construct: ConstructNodeComp,
  source:    SourceNodeComp,
};

const SRC_KIND_LABEL: Record<string, string> = {
  arxiv: 'arXiv', github: 'GitHub', huggingface: 'HF', doi: 'DOI',
  pdf: 'PDF', demo: 'Demo', blog: 'Blog', video: 'Video', dataset: 'Dataset',
};

/* ── ── ── Graph View ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── */
function GraphView({
  nodes, refs, edges, interEdges = [], lang, srcByRef,
}: {
  nodes: HarmoNode[];
  refs: RefRow[];
  edges: EdgeLink[];
  interEdges?: InterNodeEdge[];
  lang: LangMode;
  srcByRef: Map<string, SourceRow[]>;
}) {
  const [sel,            setSel]            = useState<string | null>(null);
  const [challengeLayer, setChallengeLayer] = useState(false);
  const [panelRef,       setPanelRef]       = useState<RefRow | null>(null);
  const [panelNode,      setPanelNode]      = useState<HarmoNode | null>(null);

  const refMap = useMemo(() => {
    const m = new Map<string, RefRow>();
    refs.forEach(r => m.set(r.ref_id, r));
    return m;
  }, [refs]);

  const nodeMap = useMemo(() => {
    const m = new Map<string, HarmoNode>();
    nodes.forEach(n => m.set(n.node_id, n));
    return m;
  }, [nodes]);

  // distinct refs referenced by any edge (the source nodes on the right)
  const refIds = useMemo(() => [...new Set(edges.map(e => e.to_ref))], [edges]);

  // influence of each source ON OUR method — sum of its incoming edge weights;
  // drives both the on-node score badge and the ELK vertical ordering
  const influence = useMemo(() => {
    const m = new Map<string, number>();
    for (const e of edges) m.set(e.to_ref, (m.get(e.to_ref) ?? 0) + (INFLUENCE_WEIGHT[e.edge_type] ?? 0.5));
    return m;
  }, [edges]);

  // ELK layered layout — async; positions cached in state and recomputed only
  // when the topology changes (NOT on selection). considerModelOrder=NODES +
  // children fed in influence-desc order ⇒ most influential source on top.
  const [positions, setPositions] = useState<Map<string, { x: number; y: number }>>(new Map());
  // ELK needs the TRUE rendered node size or layers overlap (cards are ~290px,
  // not the declared estimate). Two passes: estimate on first paint (no pile-up
  // flash), then re-run reading real DOM sizes once nodes are measured.
  const [layoutPass, setLayoutPass] = useState(0);
  useEffect(() => {
    const t = setTimeout(() => setLayoutPass(p => p + 1), 160);
    return () => clearTimeout(t);
  }, [nodes, edges, interEdges]);
  useEffect(() => {
    let cancelled = false;
    const sizeOf = (id: string, fw: number, fh: number) => {
      const el = document.querySelector<HTMLElement>(`.react-flow__node[data-id="${id}"]`);
      return el?.offsetWidth ? { width: el.offsetWidth, height: el.offsetHeight } : { width: fw, height: fh };
    };
    const constructChildren = nodes
      .filter(n => n.kind !== 'domain')   // domain nodes placed manually after ELK
      .map(n => ({ id: n.node_id, inf: edges.filter(e => e.from_node === n.node_id)
                     .reduce((s, e) => s + (INFLUENCE_WEIGHT[e.edge_type] ?? 0.5), 0) }))
      .sort((a, b) => b.inf - a.inf)
      .map(n => ({ id: n.id, ...sizeOf(n.id, 300, 92) }));
    const sourceChildren = [...refIds]
      .sort((a, b) => (influence.get(b) ?? 0) - (influence.get(a) ?? 0))    // high → top
      .map(r => ({ id: `ref_${r}`, ...sizeOf(`ref_${r}`, 252, 26) }));
    const graph = {
      id: 'root',
      layoutOptions: {
        'elk.algorithm': 'layered',
        'elk.direction': 'RIGHT',
        'elk.layered.considerModelOrder.strategy': 'NODES',
        'elk.layered.crossingMinimization.semiInteractive': 'true',
        'elk.layered.nodePlacement.strategy': 'NETWORK_SIMPLEX',
        'elk.layered.spacing.nodeNodeBetweenLayers': '120',
        'elk.spacing.nodeNode': '8',
        'elk.spacing.edgeNode': '20',
        'elk.layered.spacing.edgeNodeBetweenLayers': '20',
      },
      children: [...constructChildren, ...sourceChildren],
      edges: edges.map((e, i) => ({ id: `le${i}`, sources: [e.from_node], targets: [`ref_${e.to_ref}`] })),
    };
    elk.layout(graph).then(res => {
      if (cancelled) return;
      const pos = new Map<string, { x: number; y: number }>();
      for (const c of res.children ?? []) pos.set(c.id, { x: c.x ?? 0, y: c.y ?? 0 });
      // Position domain nodes in a fixed column to the left of everything ELK placed
      const childrenOf = new Map<string, string[]>();
      for (const ie of interEdges) {
        if (ie.edge_type === 'HAS_CHILD') {
          const arr = childrenOf.get(ie.from_node) ?? [];
          arr.push(ie.to_node);
          childrenOf.set(ie.from_node, arr);
        }
      }
      if (childrenOf.size > 0) {
        const allX = [...pos.values()].map(p => p.x);
        const domainX = (allX.length ? Math.min(...allX) : 0) - 340;
        // Compute each domain's target Y from children centroid
        const placements: { id: string; y: number }[] = [];
        for (const [domainId, childIds] of childrenOf) {
          const cp = childIds.map(c => pos.get(c)).filter(Boolean) as { x: number; y: number }[];
          if (cp.length) {
            const avgY = cp.reduce((s, p) => s + p.y, 0) / cp.length;
            placements.push({ id: domainId, y: avgY });
          }
        }
        // Sort by Y and enforce minimum vertical gap (110px) to prevent overlap
        placements.sort((a, b) => a.y - b.y);
        for (let i = 1; i < placements.length; i++) {
          if (placements[i].y - placements[i - 1].y < 110) {
            placements[i].y = placements[i - 1].y + 110;
          }
        }
        for (const { id, y } of placements) pos.set(id, { x: domainX, y });
      }
      setPositions(pos);
    }).catch(() => { /* layout failure → keep last positions */ });
    return () => { cancelled = true; };
  }, [nodes, edges, interEdges, refIds, influence, layoutPass]);

  /* ReactFlow nodes + edges — ELK positions; selection only toggles dim/hide */
  const { rfNodes, rfEdges } = useMemo(() => {
    const selRefId = panelRef?.ref_id ?? null;

    // Reverse mode: ref selected → which constructs point to it
    const activeConstructIds: Set<string> | null = selRefId
      ? new Set(edges.filter(e => e.to_ref === selRefId).map(e => e.from_node))
      : null;

    // Domain expansion: when a domain node is selected, include its HAS_CHILD children
    // so their ref-edges also light up
    const domainChildIds: Set<string> = sel
      ? new Set(interEdges
          .filter(ie => ie.from_node === sel && ie.edge_type === 'HAS_CHILD')
          .map(ie => ie.to_node))
      : new Set();
    const selScope: Set<string> | null = sel ? new Set([sel, ...domainChildIds]) : null;

    // Forward mode: construct selected / challenge layer / ref selected (only that ref)
    const activeRefIds: Set<string> | null = challengeLayer
      ? new Set(edges.filter(e => e.edge_type === 'CHALLENGED_BY').map(e => e.to_ref))
      : selScope
        ? new Set(edges.filter(e => selScope.has(e.from_node)).map(e => e.to_ref))
        : selRefId
          ? new Set([selRefId])
          : null;

    const constructNodes: Node[] = nodes.map(n => ({
      id:       n.node_id,
      type:     'construct',
      position: positions.get(n.node_id) ?? { x: 0, y: 0 },
      data:     {
        node_id:    n.node_id,
        kind:       n.kind,
        label:      pick(lang, n.label_ru, null, n.label_en) || n.title || '',
        edgeCount:  edges.filter(e => e.from_node === n.node_id).length,
        isSelected: sel === n.node_id,
        dimmed: activeConstructIds !== null
          ? !activeConstructIds.has(n.node_id)
          : selScope !== null && !selScope.has(n.node_id),
      } satisfies ConstructData,
    }));

    const sourceNodes: Node[] = refIds.map(refId => {
      const ref         = refMap.get(refId);
      const primaryEdge = EDGE_ORDER.find(t => edges.some(e => e.to_ref === refId && e.edge_type === t)) ?? '';
      const isActive    = activeRefIds === null || activeRefIds.has(refId);
      return {
        id:       `ref_${refId}`,
        type:     'source',
        position: positions.get(`ref_${refId}`) ?? { x: 0, y: 0 },
        data:     {
          ref_id:      refId,
          year:        ref?.year        ?? null,
          source_role: ref?.source_role ?? null,
          ref_group:   ref?.ref_group   ?? null,
          primaryEdge,
          isSelected:  panelRef?.ref_id === refId,
          dimmed:      activeRefIds !== null && !isActive,
          influence:   influence.get(refId) ?? 0,
        } satisfies SourceData,
      };
    });

    // All edges — hidden/opacity varies; hex stroke matches the legend
    const hasFilter = sel !== null || challengeLayer || selRefId !== null;
    const rfEdges: Edge[] = edges.map((e, i) => {
      const isActive = selRefId
        ? e.to_ref === selRefId                    // reverse: only edges TO selected ref
        : challengeLayer
          ? e.edge_type === 'CHALLENGED_BY'
          : selScope ? selScope.has(e.from_node) : true;
      const es = EDGE_STYLE[e.edge_type];
      return {
        id:       `e${i}_${e.from_node}_${e.to_ref}`,
        source:   e.from_node,
        target:   `ref_${e.to_ref}`,
        type:     'smoothstep',
        hidden:   hasFilter && !isActive,
        style:    {
          stroke:          es?.stroke ?? '#888',
          strokeWidth:     isActive && hasFilter ? (es?.weight ?? 1) + 1 : (es?.weight ?? 1),
          strokeDasharray: e.edge_type === 'CHALLENGED_BY' ? '5,3' : undefined,
          opacity:         isActive ? 0.9 : 0.07,
        },
      };
    });

    // Inter-node edges (HAS_CHILD / GROUNDS / EXTENDS / PARALLELS / INSTRUMENTS)
    const interRfEdges: Edge[] = interEdges.map((ie, i) => {
      const es       = EDGE_STYLE[ie.edge_type];
      const isChild  = ie.edge_type === 'HAS_CHILD';
      const isParall = ie.edge_type === 'PARALLELS';
      const isActive = !hasFilter
        || (selScope !== null && (selScope.has(ie.from_node) || selScope.has(ie.to_node)))
        || (selRefId === null && !challengeLayer && sel === null);
      // Choose handles based on which node sits higher so the edge exits toward the target
      let srcHandle: string | undefined;
      let tgtHandle: string | undefined;
      if (!isChild) {
        const fromY = positions.get(ie.from_node)?.y ?? 0;
        const toY   = positions.get(ie.to_node)?.y   ?? 0;
        if (fromY <= toY) { srcHandle = 'bot'; tgtHandle = 'top'; }
        else              { srcHandle = 'top'; tgtHandle = 'bot'; }
      }
      return {
        id:           `ie${i}_${ie.from_node}_${ie.to_node}`,
        source:       ie.from_node,
        target:       ie.to_node,
        sourceHandle: srcHandle,
        targetHandle: tgtHandle,
        type:         'smoothstep',
        hidden:       hasFilter && !isActive,
        markerEnd:    { type: 'arrowclosed' as const, color: es?.stroke ?? '#888', width: 12, height: 12 },
        markerStart:  isParall
          ? { type: 'arrowclosed' as const, color: es?.stroke ?? '#888', width: 10, height: 10 }
          : undefined,
        style: {
          stroke:          es?.stroke ?? '#888',
          strokeWidth:     isActive && hasFilter ? 2.5 : 1.5,
          strokeDasharray: isChild ? '5,3' : undefined,
          opacity:         isActive ? 0.85 : 0.07,
        },
      };
    });

    return { rfNodes: [...constructNodes, ...sourceNodes], rfEdges: [...rfEdges, ...interRfEdges] };
  }, [nodes, edges, interEdges, sel, challengeLayer, panelRef, lang, refMap, refIds, influence, positions]);

  const onNodeClick = useCallback((_: React.MouseEvent, node: Node) => {
    if (node.type === 'construct') {
      const nodeId = node.id;
      setSel(prev => prev === nodeId ? null : nodeId);
      setChallengeLayer(false);
      setPanelRef(null);
      setPanelNode(prev => prev?.node_id === nodeId ? null : (nodeMap.get(nodeId) ?? null));
    } else if (node.type === 'source') {
      const refId = String(node.data.ref_id);
      setSel(null);
      setChallengeLayer(false);
      setPanelNode(null);
      setPanelRef(prev => prev?.ref_id === refId ? null : (refMap.get(refId) ?? null));
    }
  }, [refMap, nodeMap]);

  const panelRelevance = panelRef ? pick(lang, panelRef.relevance_ru, panelRef.relevance_ru_sci, panelRef.relevance_en, panelRef.relevance) : '';
  const panelTakeaway  = panelRef ? pick(lang, panelRef.takeaway_ru,  panelRef.takeaway_ru_sci,  panelRef.takeaway_en,  panelRef.takeaway)  : '';

  const nodeLabel   = panelNode ? (lang === 'en' ? panelNode.label_en : panelNode.label_ru) ?? panelNode.title ?? panelNode.node_id : '';
  const nodeSummary = panelNode ? (lang === 'en' ? panelNode.summary_en : panelNode.summary_ru) : null;
  const nodeDesc    = panelNode ? (lang === 'en' ? panelNode.description_en : panelNode.description_ru_sci) : null;

  /* Do NOT remount on layout change — a fresh ReactFlow instance fails to
     re-measure handles and edges vanish. Keep one instance, refit via the API
     once ELK positions land. */
  const rfRef = useRef<ReactFlowInstance | null>(null);
  useEffect(() => {
    if (positions.size === 0) return;
    const id = requestAnimationFrame(() => rfRef.current?.fitView({ padding: 0.18 }));
    return () => cancelAnimationFrame(id);
  }, [positions]);

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* Legend toolbar */}
      <div style={S.legend}>
        {EDGE_ORDER.map(et => {
          const es = EDGE_STYLE[et];
          return (
            <span key={et} style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
              <svg width={22} height={8} style={{ overflow: 'visible' }}>
                <line x1={0} y1={4} x2={22} y2={4}
                  stroke={es.stroke} strokeWidth={es.dashed ? 1 : 2}
                  strokeDasharray={es.dashed ? '4,3' : undefined} />
              </svg>
              <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--t2)' }}>{et}</span>
            </span>
          );
        })}
        {interEdges.length > 0 && (
          <>
            <span style={{ width: 1, height: 14, background: 'var(--bd)', flexShrink: 0 }} />
            {(['HAS_CHILD', 'GROUNDS', 'EXTENDS', 'PARALLELS', 'INSTRUMENTS'] as const).map(et => {
              const es = EDGE_STYLE[et];
              if (!es) return null;
              return (
                <span key={et} style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
                  <svg width={22} height={8} style={{ overflow: 'visible' }}>
                    <line x1={0} y1={4} x2={22} y2={4}
                      stroke={es.stroke} strokeWidth={1}
                      strokeDasharray={et === 'HAS_CHILD' ? '4,3' : undefined} />
                  </svg>
                  <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--t3)' }}>{et}</span>
                </span>
              );
            })}
          </>
        )}
        <button
          style={{
            ...S.clearBtn, marginLeft: 8,
            background: challengeLayer ? 'color-mix(in srgb, var(--err) 14%, transparent)' : 'transparent',
            color:      challengeLayer ? 'var(--err)' : 'var(--t3)',
            border:     `1px solid ${challengeLayer ? 'var(--err)' : 'var(--bd)'}`,
          }}
          onClick={() => { setChallengeLayer(p => !p); setSel(null); setPanelRef(null); }}
        >
          ⚡ Антитезисы
        </button>
        {(sel || panelRef) && (
          <button style={{ ...S.clearBtn, marginLeft: 4 }}
            onClick={() => { setSel(null); setPanelRef(null); }}>✕ сброс</button>
        )}
        <span style={{ marginLeft: 'auto', fontSize: 'var(--fs-xs)', color: 'var(--t3)' }}>
          {challengeLayer
            ? `Слой CHALLENGED_BY`
            : panelNode
              ? `${panelNode.node_id} · конструкт`
              : sel
                ? `${sel} · рёбра выделены`
                : 'Кликните конструкт или источник'}
        </span>
      </div>

      {/* Graph canvas + optional detail panel
          position:relative + absolute fill ensures ReactFlow gets a real pixel
          height regardless of the flex chain above it. minHeight is the fallback
          when the chain collapses (e.g. in narrow iframes / SSR). */}
      <div style={{ flex: 1, position: 'relative', minHeight: 400, overflow: 'hidden' }}>
        <div style={{ position: 'absolute', top: 0, left: 0, right: (panelRef || panelNode) ? 300 : 0, bottom: 0 }}>
          <ReactFlow
            key="graph"
            onInit={inst => { rfRef.current = inst; }}
            nodes={rfNodes}
            edges={rfEdges}
            nodeTypes={RF_NODE_TYPES}
            onNodeClick={onNodeClick}
            fitView
            fitViewOptions={{ padding: 0.18 }}
            style={{ background: 'var(--bg0)', width: '100%', height: '100%' }}
            proOptions={{ hideAttribution: true }}
            deleteKeyCode={null}
            nodesDraggable
            nodesConnectable={false}
            elementsSelectable={false}
          >
            <Controls
              style={{ border: '1px solid var(--bd)', borderRadius: 6, overflow: 'hidden' }}
              showInteractive={false}
            />
            <Background variant={BackgroundVariant.Dots} color="var(--bd)" gap={22} size={1} />
          </ReactFlow>
        </div>

        {/* Ref detail panel */}
        {panelRef && (
          <div style={S.graphPanel} className="lore-panel-scroll">
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 6, marginBottom: 8 }}>
              <span style={{ ...S.mono, color: 'var(--acc)', fontWeight: 700, fontSize: 'var(--fs-base)', flex: 1 }}>
                {panelRef.ref_id}
              </span>
              <button style={S.panelClose} onClick={() => setPanelRef(null)}>✕</button>
            </div>
            {panelRef.year && <span style={{ ...S.mono, fontSize: 'var(--fs-xs)', color: 'var(--t3)' }}>{panelRef.year}</span>}
            {panelRef.source_role && (
              <span style={{
                ...S.roleBadge, display: 'inline-block', marginTop: 4,
                color: ROLE_COLOR[panelRef.source_role] ?? 'var(--t2)',
              }}>
                {panelRef.source_role}
              </span>
            )}
            <p style={{ fontSize: 'var(--fs-sm)', color: 'var(--t1)', margin: '8px 0' }}>{panelRef.citation}</p>
            {panelRef.link && (
              <a href={resolveRefUrl(panelRef.link)} target="_blank" rel="noopener noreferrer"
                style={{ fontSize: 'var(--fs-xs)', color: 'var(--acc)', wordBreak: 'break-all', display: 'block', marginBottom: 6 }}>
                ↗ {resolveRefUrl(panelRef.link)}
              </a>
            )}
            {(srcByRef.get(panelRef.ref_id) ?? []).length > 0 && (
              <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', marginBottom: 8 }}>
                {(srcByRef.get(panelRef.ref_id) ?? []).map(s => {
                  const label = SRC_KIND_LABEL[s.kind ?? ''] ?? s.kind ?? 'src';
                  const muted = s.kind === 'status' || !s.url;
                  const chip: React.CSSProperties = {
                    fontSize: 'var(--fs-xs)', padding: '2px 7px', borderRadius: 3, whiteSpace: 'nowrap',
                    border: `1px solid color-mix(in srgb, ${muted ? 'var(--t3)' : 'var(--acc)'} 35%, transparent)`,
                    background: `color-mix(in srgb, ${muted ? 'var(--t3)' : 'var(--acc)'} 10%, transparent)`,
                    color: muted ? 'var(--t3)' : 'var(--acc)', textDecoration: 'none',
                  };
                  return muted ? (
                    <span key={s.source_id} title={s.annotation ?? undefined} style={chip}>{label}</span>
                  ) : (
                    <a key={s.source_id} href={s.url!} target="_blank" rel="noopener noreferrer"
                       title={s.annotation ?? undefined} style={chip}>{label} ↗</a>
                  );
                })}
              </div>
            )}
            {panelTakeaway && (
              <div style={{ marginBottom: 8 }}>
                <span style={S.sectionLabel}>Вывод</span>
                <MartProse text={panelTakeaway} />
              </div>
            )}
            {panelRelevance && (
              <div>
                <span style={S.sectionLabel}>Релевантность</span>
                <MartProse text={panelRelevance} />
              </div>
            )}
          </div>
        )}

        {/* Construct detail panel */}
        {panelNode && (
          <div style={S.graphPanel} className="lore-panel-scroll">
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 6, marginBottom: 8 }}>
              <div style={{ flex: 1 }}>
                <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--t3)', fontFamily: 'var(--mono)', display: 'block', marginBottom: 2 }}>
                  {panelNode.node_id}
                </span>
                {panelNode.kind && (
                  <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--acc)', background: 'color-mix(in srgb, var(--acc) 12%, transparent)', borderRadius: 3, padding: '1px 5px' }}>
                    {panelNode.kind}
                  </span>
                )}
              </div>
              <button style={S.panelClose} onClick={() => { setPanelNode(null); setSel(null); }}>✕</button>
            </div>
            <p style={{ fontSize: 'var(--fs-md)', fontWeight: 700, color: 'var(--t1)', margin: '6px 0 8px', lineHeight: 1.4 }}>
              {nodeLabel}
            </p>
            {nodeSummary && (
              <div style={{ marginBottom: 8 }}>
                <span style={S.sectionLabel}>Суть</span>
                <MartProse text={nodeSummary} />
              </div>
            )}
            {nodeDesc && (
              <div>
                <span style={S.sectionLabel}>Описание</span>
                <MartProse text={nodeDesc} />
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/* ── ── ── Main Screen ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── */
interface Props {
  onError?: (e: unknown) => void;
}

export function BiblioScreen({ onError }: Props) {
  const [view,      setView]      = useState<BiblioView>('slice');
  const [lang,      setLang]      = useState<LangMode>('ru');
  const [loading,   setLoading]   = useState(true);
  const [error,     setError]     = useState<string | null>(null);
  const [refs,       setRefs]       = useState<RefRow[]>([]);
  const [nodes,      setNodes]      = useState<HarmoNode[]>([]);
  const [edges,      setEdges]      = useState<EdgeLink[]>([]);
  const [interEdges, setInterEdges] = useState<InterNodeEdge[]>([]);
  const [topics,     setTopics]     = useState<TopicRow[]>([]);
  const [refTopics,  setRefTopics]  = useState<Map<string, string[]>>(new Map());
  const [srcByRef,   setSrcByRef]   = useState<Map<string, SourceRow[]>>(new Map());
  const [cardsByRef, setCardsByRef] = useState<Map<string, MethodCardRow[]>>(new Map());

  useEffect(() => {
    Promise.all([
      fetchSlice<RefRow>('biblio_refs'),
      fetchSlice<HarmoNode>('biblio_nodes'),
      fetchSlice<NodeEdgeRaw>('biblio_node_refs'),
      fetchSlice<TopicRow>('biblio_topics'),
      fetchSlice<RefTopicRow>('biblio_ref_topics'),
      fetchSlice<{ from_node: string; edge_types: string[] | null; to_nodes: string[] | null }>(
        'biblio_node_edges',
      ),
      fetchSlice<SourceRow>('sources'),
      fetchSlice<MethodCardRow>('method_cards'),
    ])
      .then(([r, n, e, t, rt, ie, srcs, mcards]) => {
        setRefs(r);
        setNodes(n);
        setTopics(t);
        const links: EdgeLink[] = [];
        for (const row of e) {
          const types = row.edge_types ?? [];
          const toR   = row.to_refs   ?? [];
          for (let i = 0; i < types.length; i++) {
            if (types[i] && toR[i]) links.push({ from_node: row.node_id, to_ref: toR[i], edge_type: types[i] });
          }
        }
        setEdges(links);
        const iLinks: InterNodeEdge[] = [];
        for (const row of ie) {
          const types = row.edge_types ?? [];
          const toN   = row.to_nodes   ?? [];
          for (let i = 0; i < types.length; i++) {
            if (types[i] && toN[i]) iLinks.push({ from_node: row.from_node, to_node: toN[i], edge_type: types[i] });
          }
        }
        setInterEdges(iLinks);
        const tm = new Map<string, string[]>();
        for (const row of rt) {
          const tids = (row.topics ?? []).filter(Boolean) as string[];
          if (tids.length) tm.set(row.ref_id, tids);
        }
        setRefTopics(tm);
        const sm = new Map<string, SourceRow[]>();
        for (const s of srcs) { if (s.ref_id) { if (!sm.has(s.ref_id)) sm.set(s.ref_id, []); sm.get(s.ref_id)!.push(s); } }
        setSrcByRef(sm);
        const cm = new Map<string, MethodCardRow[]>();
        for (const c of mcards) { if (c.ref_id) { if (!cm.has(c.ref_id)) cm.set(c.ref_id, []); cm.get(c.ref_id)!.push(c); } }
        setCardsByRef(cm);
        setLoading(false);
      })
      .catch(err => {
        const msg = String(err);
        setError(msg);
        onError?.(err);
        setLoading(false);
      });
  }, [onError]);

  if (loading) return <div style={S.loadMsg}>Загрузка исследований…</div>;
  if (error)   return <div style={S.errMsg}>{error}</div>;

  return (
    <div style={S.root}>
      {/* Toolbar */}
      <div style={S.toolbar}>
        <div style={S.switchGroup}>
          {(['slice', 'cards', 'graph'] as BiblioView[]).map(v => (
            <button key={v}
              style={{ ...S.switchBtn, ...(view === v ? S.switchBtnActive : {}) }}
              onClick={() => setView(v)}>
              {{ slice: 'Срез', cards: 'Карточки', graph: 'Граф' }[v]}
            </button>
          ))}
        </div>
        <div style={S.divider} />
        <div style={S.switchGroup}>
          {(['ru', 'ru_sci', 'en'] as LangMode[]).map(l => (
            <button key={l}
              style={{ ...S.switchBtn, ...(lang === l ? S.switchBtnActive : {}) }}
              onClick={() => setLang(l)}>
              {{ ru: 'RU', ru_sci: 'RU науч', en: 'EN' }[l]}
            </button>
          ))}
        </div>
        <div style={S.spacer} />
        <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--t3)' }}>
          {refs.length} ист. · {nodes.length} конструктов · {edges.length} связей{interEdges.length > 0 ? ` · ${interEdges.length} структурных` : ''}
        </span>
      </div>

      {/* Content */}
      <div style={{ flex: 1, overflow: 'hidden', display: 'flex' }}>
        {view === 'cards' && <CardsView refs={refs} topics={topics} refTopics={refTopics} lang={lang} srcByRef={srcByRef} cardsByRef={cardsByRef} />}
        {view === 'slice' && <SliceView nodes={nodes} refs={refs} edges={edges} interEdges={interEdges} lang={lang} />}
        {view === 'graph' && <GraphView nodes={nodes} refs={refs} edges={edges} interEdges={interEdges} lang={lang} srcByRef={srcByRef} />}
      </div>
    </div>
  );
}

/* ── Shared styles ──────────────────────────────────────────────────── */
const S = {
  root:    { flex: 1, display: 'flex', flexDirection: 'column' as const, overflow: 'hidden', minHeight: 0 },
  loadMsg: { padding: 32, color: 'var(--t3)', fontSize: 'var(--fs-base)' },
  errMsg:  { padding: 32, color: 'var(--err)', fontSize: 'var(--fs-base)' },
  empty:   { padding: '24px 16px', color: 'var(--t3)', fontSize: 'var(--fs-base)' },
  mono:    { fontFamily: 'var(--mono)', fontSize: 'var(--fs-sm)' },

  toolbar: {
    display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0,
    padding: '6px 12px', borderBottom: '1px solid var(--bd)', flexWrap: 'wrap' as const,
  },
  switchGroup: { display: 'flex', gap: 2 },
  switchBtn: {
    padding: '3px 10px', border: '1px solid var(--bd)', borderRadius: 4,
    fontSize: 'var(--fs-sm)', cursor: 'pointer', background: 'transparent', color: 'var(--t2)',
    transition: 'all 0.1s', fontFamily: 'inherit',
  },
  switchBtnActive: {
    background: 'color-mix(in srgb, var(--acc) 16%, transparent)',
    color: 'var(--acc)', borderColor: 'color-mix(in srgb, var(--acc) 40%, transparent)', fontWeight: 600,
  },
  divider: { width: 1, height: 20, background: 'var(--bd)', flexShrink: 0 },
  spacer:  { flex: 1 },

  /* Cards filters */
  filterArea: {
    display: 'flex', flexDirection: 'column' as const, gap: 4,
    padding: '6px 12px', borderBottom: '1px solid var(--bd)', flexShrink: 0,
  },
  filterRow: { display: 'flex', alignItems: 'center', gap: 5, flexWrap: 'wrap' as const, minHeight: 24 },
  filterLabel: { fontSize: 'var(--fs-xs)', color: 'var(--t3)', fontWeight: 600, minWidth: 36, textTransform: 'uppercase' as const, letterSpacing: '0.06em', flexShrink: 0 },
  searchIn: {
    flex: 1, minWidth: 160, background: 'transparent', border: '1px solid var(--bd)',
    borderRadius: 4, padding: '3px 8px', outline: 'none',
    color: 'var(--t1)', fontSize: 'var(--fs-base)', fontFamily: 'inherit',
  },
  chip: {
    padding: '1px 7px', borderRadius: 10, fontSize: 'var(--fs-xs)', cursor: 'pointer',
    border: '1px solid var(--bd)', color: 'var(--t2)', userSelect: 'none' as const, flexShrink: 0,
    transition: 'all 0.1s',
  },
  chipActive: {
    background: 'color-mix(in srgb, var(--acc) 14%, transparent)',
    color: 'var(--acc)', borderColor: 'var(--acc)',
  },

  /* Cards */
  card: { borderBottom: '1px solid var(--bd)', transition: 'background 0.1s' },
  cardOpen: { background: 'color-mix(in srgb, var(--acc) 4%, transparent)' },
  cardHead: { display: 'flex', flexDirection: 'column' as const, gap: 3, padding: '8px 14px', cursor: 'pointer' },
  cardMeta: { display: 'flex', alignItems: 'center', gap: 5, flexWrap: 'wrap' as const },
  cardBody: { padding: '6px 14px 12px', borderTop: '1px solid var(--bd)' },
  citation:    { fontSize: 'var(--fs-base)', color: 'var(--t1)', lineHeight: 1.4 },
  roleBadge: {
    fontSize: 'var(--fs-2xs)', padding: '1px 5px', borderRadius: 3, flexShrink: 0,
    background: 'color-mix(in srgb, currentColor 10%, transparent)',
    border: '1px solid color-mix(in srgb, currentColor 30%, transparent)',
    fontWeight: 700, letterSpacing: '0.04em',
  },
  groupBadge: {
    fontSize: 'var(--fs-2xs)', padding: '1px 5px', borderRadius: 3, flexShrink: 0,
    background: 'var(--bg2)', color: 'var(--t3)', border: '1px solid var(--bd)',
  },
  topicChip: {
    fontSize: 'var(--fs-2xs)', padding: '1px 5px', borderRadius: 10, flexShrink: 0,
    background: 'color-mix(in srgb, var(--acc) 8%, transparent)',
    color: 'var(--acc)', border: '1px solid color-mix(in srgb, var(--acc) 25%, transparent)',
  },
  sectionLabel: {
    fontSize: 'var(--fs-2xs)', fontWeight: 700, textTransform: 'uppercase' as const, letterSpacing: '0.08em',
    color: 'var(--t3)', display: 'block', marginBottom: 4,
  },
  groupOvSection: {
    padding: 10, borderRadius: 5,
    background: 'color-mix(in srgb, var(--bd) 30%, transparent)',
    marginBottom: 8,
  },

  /* Slice */
  nodeBar: {
    display: 'flex', gap: 4, flexWrap: 'wrap' as const,
    padding: '8px 12px', borderBottom: '1px solid var(--bd)', flexShrink: 0,
  },
  nodeBtn: {
    display: 'flex', alignItems: 'center', gap: 5,
    padding: '4px 10px', border: '1px solid var(--bd)', borderRadius: 4,
    cursor: 'pointer', background: 'transparent', color: 'var(--t2)',
    fontSize: 'var(--fs-sm)', fontFamily: 'inherit', transition: 'all 0.1s',
  },
  nodeBtnActive: {
    background: 'color-mix(in srgb, var(--acc) 16%, transparent)',
    color: 'var(--acc)', borderColor: 'color-mix(in srgb, var(--acc) 40%, transparent)',
  },
  mirrorDot: { width: 5, height: 5, borderRadius: '50%', flexShrink: 0, background: 'var(--war)' },
  nodeSummaryBox: {
    display: 'flex', flexDirection: 'column' as const, gap: 3,
    padding: '8px 14px', borderBottom: '1px solid var(--bd)', flexShrink: 0,
    background: 'var(--bg2)',
    maxHeight: '40%', overflowY: 'auto' as const,
  },
  nodeLabel: { fontSize: 'var(--fs-base)', fontWeight: 600, color: 'var(--t1)' },
  challengedBanner: {
    marginTop: 6, padding: '4px 8px', borderRadius: 4, fontSize: 'var(--fs-sm)',
    background: 'color-mix(in srgb, var(--err) 8%, transparent)',
    border: '1px solid color-mix(in srgb, var(--err) 25%, transparent)',
    color: 'var(--t2)',
  },
  edgeSection: {
    display: 'flex', alignItems: 'center', gap: 8,
    padding: '5px 8px 5px 11px', background: 'var(--bg2)',
  },
  sliceRef: {
    display: 'flex', flexDirection: 'column' as const, gap: 2,
    padding: '6px 14px', borderBottom: '1px solid color-mix(in srgb, var(--bd) 60%, transparent)',
  },
  sliceRefHead: { display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' as const },

  /* Graph */
  legend: {
    display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' as const,
    padding: '8px 16px', borderBottom: '1px solid var(--bd)', flexShrink: 0,
  },
  clearBtn: {
    padding: '2px 8px', border: '1px solid var(--bd)', borderRadius: 4,
    background: 'transparent', color: 'var(--t3)', cursor: 'pointer', fontSize: 'var(--fs-xs)',
    fontFamily: 'inherit', transition: 'all 0.1s',
  },
  graphPanel: {
    position: 'absolute' as const, right: 0, top: 0, bottom: 0,
    width: 300, zIndex: 1,
    borderLeft: '1px solid var(--bd)',
    padding: '12px 14px',
    overflowY: 'auto' as const,
    background: 'var(--bg1)',
  },
  panelClose: {
    background: 'none', border: 'none', cursor: 'pointer',
    color: 'var(--t3)', fontSize: 'var(--fs-base)', padding: '0 2px', flexShrink: 0,
  },
};
