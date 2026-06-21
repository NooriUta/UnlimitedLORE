import { useEffect, useState } from 'react';
import { fetchLoreSlice, type LoreRelease } from '../../api/lore';
import { StatusChip } from '../../pages/LorePage';

interface Props {
  q: string;
  onError: (e: unknown) => void;
  onNavigateToSprint: (id: string) => void;
}

interface DecisionRef {
  decision_id: string;
  title: string;
  status_raw: string | null;
}

interface SprintRef {
  sprint_id: string;
  name: string | null;
  status_raw: string | null;
}

interface PrRef {
  pr_number: number;
  title: string;
  merged_at: string | null;
  url: string | null;
}

function semverParts(tag: string): [number, number, number] {
  const m = tag.replace(/^v/, '').match(/^(\d+)\.(\d+)\.(\d+)/);
  return m ? [+m[1], +m[2], +m[3]] : [0, 0, 0];
}

function semverCompare(a: LoreRelease, b: LoreRelease): number {
  const [a1, a2, a3] = semverParts(a.git_tag ?? a.release_id);
  const [b1, b2, b3] = semverParts(b.git_tag ?? b.release_id);
  return (b1 - a1) || (b2 - a2) || (b3 - a3);
}

const TYPE_LABEL: Record<string, string> = { major: 'major', minor: 'minor', patch: 'patch' };

function GhIcon() {
  return (
    <svg viewBox="0 0 16 16" width="12" height="12" fill="currentColor" aria-hidden="true">
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38
               0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13
               -.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66
               .07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15
               -.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27
               .68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12
               .51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48
               0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/>
    </svg>
  );
}

export default function LoreReleasesBoard({ q, onError, onNavigateToSprint }: Props) {
  const [rows,           setRows]           = useState<LoreRelease[]>([]);
  const [loading,        setLoading]        = useState(true);
  const [expanded,       setExpanded]       = useState<string | null>(null);
  const [decisions,      setDecisions]      = useState<Record<string, DecisionRef[]>>({});
  const [sprintRefs,     setSprintRefs]     = useState<Record<string, SprintRef[]>>({});
  const [prRefs,         setPrRefs]         = useState<Record<string, PrRef[]>>({});
  const [loadingDetail,  setLoadingDetail]  = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    const ctrl = new AbortController();
    fetchLoreSlice<LoreRelease>('releases', undefined, ctrl.signal)
      .then(r => { setRows(r); setLoading(false); })
      .catch(e => { onError(e); setLoading(false); });
    return () => ctrl.abort();
  }, [onError]);

  function toggle(id: string, tag: string) {
    if (expanded === id) { setExpanded(null); return; }
    setExpanded(id);
    if (decisions[id]) return;
    setLoadingDetail(id);
    Promise.all([
      fetchLoreSlice<DecisionRef>('release_decisions', { tag }),
      fetchLoreSlice<SprintRef>('release_sprints', { tag }),
      fetchLoreSlice<PrRef>('release_prs', { tag }),
    ])
      .then(([decs, sprints, prs]) => {
        setDecisions(prev => ({ ...prev, [id]: decs }));
        setSprintRefs(prev => ({ ...prev, [id]: sprints }));
        setPrRefs(prev => ({ ...prev, [id]: prs }));
        setLoadingDetail(null);
      })
      .catch(e => { onError(e); setLoadingDetail(null); });
  }

  const filtered = [...rows]
    .sort(semverCompare)
    .filter(r =>
      !q || (r.git_tag ?? r.release_id).toLowerCase().includes(q.toLowerCase())
    );

  // Group by minor version (v1.3.x, v1.4.x, ...)
  const groups: Map<string, LoreRelease[]> = new Map();
  for (const r of filtered) {
    const [maj, min] = semverParts(r.git_tag ?? r.release_id);
    const key = `v${maj}.${min}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(r);
  }

  if (loading) return <div style={S.empty}>Загрузка релизов…</div>;

  return (
    <div style={S.root}>
      <div style={S.header}>
        <span style={S.count}>{filtered.length} релизов</span>
        {q && <span style={S.filterNote}>фильтр: «{q}»</span>}
      </div>
      <div style={S.list} className="lore-panel-scroll">
        {filtered.length === 0 && <div style={S.empty}>Релизы не найдены.</div>}
        {[...groups.entries()].map(([minor, releases]) => (
          <div key={minor}>
            <div style={S.groupHeader}>
              <span style={S.groupLabel}>{minor}</span>
              <span style={S.groupCount}>{releases.length} релизов</span>
            </div>
            {releases.map(r => {
              const id     = r.release_id;
              const tag    = r.git_tag ?? id;
              const isOpen = expanded === id;
              const decs   = decisions[id];
              const sprints = sprintRefs[id];
              const prs    = prRefs[id];
              const type   = r.type as string | null;
              const ghUrl  = `https://github.com/NooriUta/AIDA/releases/tag/${tag}`;
              return (
                <div
                  key={id}
                  style={{ ...S.row, background: isOpen ? 'color-mix(in srgb, var(--acc) 5%, transparent)' : 'transparent' }}
                  onClick={() => toggle(id, tag)}
                >
                  <div style={S.tagCell}>
                    <span style={{ ...S.tag, ...(type === 'major' ? S.tagMajor : type === 'minor' ? S.tagMinor : S.tagPatch) }}>
                      {tag}
                    </span>
                    {r.is_current && <span style={S.currentBadge}>CURRENT</span>}
                  </div>
                  <div style={S.body}>
                    {type && <span style={S.typeBadge}>{TYPE_LABEL[type] ?? type}</span>}
                    {r.week != null && <span style={S.weekBadge}>wk {r.week}</span>}
                    {r.description_md && <span style={S.desc}>{r.description_md.slice(0, 120)}</span>}
                    {isOpen && (
                      <div style={S.detail} onClick={e => e.stopPropagation()}>
                        {loadingDetail === id && <span style={S.meta}>Загрузка…</span>}

                        {/* Sprints */}
                        {sprints && sprints.length > 0 && (
                          <>
                            <span style={S.refLabel}>Спринты</span>
                            {sprints.map(s => (
                              <div
                                key={s.sprint_id}
                                style={S.sprintRef}
                                onClick={() => onNavigateToSprint(s.sprint_id)}
                                title={`Открыть спринт ${s.sprint_id}`}
                              >
                                <span style={S.sprintId}>{s.sprint_id}</span>
                                {s.name && s.name !== s.sprint_id && (
                                  <span style={S.sprintName}>{s.name}</span>
                                )}
                              </div>
                            ))}
                          </>
                        )}

                        {/* PRs (via SHIPPED_IN edge) */}
                        {prs && prs.length > 0 && (
                          <>
                            <span style={{ ...S.refLabel, marginTop: sprints?.length ? 8 : 0 }}>PR</span>
                            {prs.map(p => (
                              <div key={p.pr_number} style={S.decisionRef}>
                                <span style={S.decisionNum}>#{p.pr_number}</span>
                                <span style={S.decisionTitle}>{p.title}</span>
                                {p.url && (
                                  <a
                                    href={p.url}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    onClick={e => e.stopPropagation()}
                                    style={S.ghLink}
                                    title={`PR #${p.pr_number}`}
                                  ><GhIcon /></a>
                                )}
                              </div>
                            ))}
                          </>
                        )}

                        {/* Decisions */}
                        {decs && decs.length > 0 && (
                          <>
                            <span style={{ ...S.refLabel, marginTop: (sprints?.length || prs?.length) ? 8 : 0 }}>Решения</span>
                            {decs.map(d => (
                              <div key={d.decision_id} style={S.decisionRef}>
                                <span style={S.decisionNum}>#{d.decision_id}</span>
                                <span style={S.decisionTitle}>{d.title}</span>
                                {d.status_raw && <StatusChip status={d.status_raw} />}
                              </div>
                            ))}
                          </>
                        )}

                        {decs && decs.length === 0 && (!sprints || sprints.length === 0) && (!prs || prs.length === 0) && (
                          <span style={S.meta}>Связанных записей не найдено.</span>
                        )}
                      </div>
                    )}
                  </div>
                  <div style={S.rowRight}>
                    {r.release_date && <span style={S.date}>{r.release_date.slice(0, 10)}</span>}
                    <a
                      href={ghUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={e => e.stopPropagation()}
                      style={S.ghLink}
                      title={`GitHub Release ${tag}`}
                    ><GhIcon /></a>
                  </div>
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

const S = {
  root:   { flex: 1, display: 'flex', flexDirection: 'column' as const, overflow: 'hidden' },
  header: {
    display: 'flex', alignItems: 'center', gap: 10,
    padding: '6px 16px', borderBottom: '1px solid var(--bd)', flexShrink: 0,
  },
  count:      { fontSize: 11, color: 'var(--t3)' },
  filterNote: { fontSize: 11, color: 'var(--acc)' },
  list:  { flex: 1, overflowY: 'auto' as const },
  empty: { padding: '24px 16px', color: 'var(--t3)', fontSize: 12 },

  groupHeader: {
    display: 'flex', alignItems: 'center', gap: 8,
    padding: '5px 16px', background: 'var(--bg2)',
    borderBottom: '1px solid var(--bd)', borderTop: '1px solid var(--bd)',
    position: 'sticky' as const, top: 0, zIndex: 1,
  },
  groupLabel: { fontSize: 11, fontWeight: 700, color: 'var(--t2)', fontFamily: 'var(--mono)' },
  groupCount: { fontSize: 10, color: 'var(--t3)' },

  row: {
    display: 'flex', alignItems: 'flex-start', gap: 10,
    padding: '7px 16px', borderBottom: '1px solid var(--bd)',
    cursor: 'pointer', transition: 'background 0.1s',
  },
  tagCell: { display: 'flex', alignItems: 'center', gap: 5, flexShrink: 0 },
  tag: {
    fontFamily: 'var(--mono)', fontSize: 12, fontWeight: 700,
    minWidth: 72, flexShrink: 0, paddingTop: 1,
  },
  currentBadge: {
    fontSize: 8, padding: '1px 4px', borderRadius: 3, fontWeight: 700,
    letterSpacing: '0.06em', textTransform: 'uppercase' as const,
    background: 'color-mix(in srgb, var(--suc) 18%, transparent)',
    color: 'var(--suc)', border: '1px solid color-mix(in srgb, var(--suc) 35%, transparent)',
  },
  rowRight: { display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 },
  ghLink: {
    fontSize: 11, color: 'var(--t3)', textDecoration: 'none', flexShrink: 0,
    padding: '1px 4px', borderRadius: 3,
    border: '1px solid color-mix(in srgb, var(--bd) 70%, transparent)',
    lineHeight: 1.4, transition: 'color 0.1s',
  },
  tagMajor: { color: 'var(--err)' },
  tagMinor: { color: 'var(--war)' },
  tagPatch: { color: 'var(--acc)' },

  body: { flex: 1, minWidth: 0, display: 'flex', flexWrap: 'wrap' as const, alignItems: 'center', gap: 6 },

  typeBadge: {
    fontSize: 9, padding: '1px 5px', borderRadius: 3, textTransform: 'uppercase' as const,
    letterSpacing: '0.08em', fontWeight: 700,
    background: 'color-mix(in srgb, var(--acc) 10%, transparent)',
    color: 'var(--t3)', border: '1px solid color-mix(in srgb, var(--bd) 80%, transparent)',
  },
  weekBadge: {
    fontSize: 10, padding: '1px 5px', borderRadius: 3,
    background: 'color-mix(in srgb, var(--t3) 8%, transparent)',
    color: 'var(--t3)', fontFamily: 'var(--mono)',
  },
  desc: { fontSize: 11, color: 'var(--t2)' },
  date: { fontSize: 10, color: 'var(--t3)', flexShrink: 0, paddingTop: 2 },

  detail: { width: '100%', marginTop: 8, paddingTop: 8, borderTop: '1px solid var(--bd)' },
  meta:   { fontSize: 11, color: 'var(--t3)' },
  refLabel: {
    fontSize: 10, fontWeight: 600, color: 'var(--t3)',
    textTransform: 'uppercase' as const, letterSpacing: '0.08em',
    display: 'block', marginBottom: 4,
  },
  sprintRef: {
    display: 'flex', alignItems: 'center', gap: 8,
    padding: '3px 0', borderBottom: '1px solid color-mix(in srgb, var(--bd) 50%, transparent)',
    cursor: 'pointer',
  },
  sprintId: {
    fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--acc)',
    fontWeight: 700, flexShrink: 0,
  },
  sprintName: { fontSize: 11, color: 'var(--t2)', flex: 1 },
  decisionRef: {
    display: 'flex', alignItems: 'center', gap: 8,
    padding: '3px 0', borderBottom: '1px solid color-mix(in srgb, var(--bd) 50%, transparent)',
  },
  decisionNum: {
    fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--acc)',
    fontWeight: 700, minWidth: 38, flexShrink: 0,
  },
  decisionTitle: { fontSize: 11, color: 'var(--t2)', flex: 1 },
};
