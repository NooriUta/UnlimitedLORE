import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { fetchLoreSlice, type LoreRelease, type LoreSprintTask } from '../../api/lore';
import { StatusChip } from '../../pages/LorePage';
import LoreSkeleton from './LoreSkeleton';

interface Props {
  q: string;
  onClearQ?: () => void;
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
  pr_uid: string | null;
  git_project: string | null;
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

export default function LoreReleasesBoard({ q, onClearQ, onError, onNavigateToSprint }: Props) {
  const { t } = useTranslation();
  const [rows,           setRows]           = useState<LoreRelease[]>([]);
  const [loading,        setLoading]        = useState(true);
  const [expanded,       setExpanded]       = useState<string | null>(null);
  const [decisions,      setDecisions]      = useState<Record<string, DecisionRef[]>>({});
  const [sprintRefs,     setSprintRefs]     = useState<Record<string, SprintRef[]>>({});
  const [prRefs,         setPrRefs]         = useState<Record<string, PrRef[]>>({});
  const [taskMap,        setTaskMap]        = useState<Record<string, Record<string, LoreSprintTask[]>>>({});
  const [loadingDetail,  setLoadingDetail]  = useState<string | null>(null);
  const [projectFilter,  setProjectFilter]  = useState<string>('all');
  const [onlyCurrent,    setOnlyCurrent]    = useState(false);

  useEffect(() => {
    setLoading(true);
    const ctrl = new AbortController();
    fetchLoreSlice<LoreRelease>('releases', undefined, ctrl.signal)
      .then(r => { setRows(r); setLoading(false); })
      .catch(e => { onError(e); setLoading(false); });
    return () => ctrl.abort();
  }, [onError]);

  function toggle(uid: string, tag: string, ruid: string, gitTag: string | null) {
    if (expanded === uid) { setExpanded(null); return; }
    setExpanded(uid);
    if (decisions[uid]) return;
    setLoadingDetail(uid);
    // Use ruid-based slices to avoid cross-project tag collisions (e.g. AIDA#v1.3.0 vs seidr-site#v1.3.0).
    // Decisions are tag-based only — skip when release has no real git_tag.
    Promise.all([
      gitTag
        ? fetchLoreSlice<DecisionRef>('release_decisions', { tag })
        : Promise.resolve([] as DecisionRef[]),
      fetchLoreSlice<SprintRef>('release_sprints', { ruid }),
      fetchLoreSlice<PrRef>('release_prs', { ruid }),
    ])
      .then(([decs, sprints, prs]) => {
        setDecisions(prev => ({ ...prev, [uid]: decs }));
        setSprintRefs(prev => ({ ...prev, [uid]: sprints }));
        setPrRefs(prev => ({ ...prev, [uid]: prs }));
        setLoadingDetail(null);
        // Fetch tasks for all sprints in one batch request
        if (sprints.length > 0) {
          const ids = sprints.map(s => s.sprint_id).join(',');
          fetchLoreSlice<LoreSprintTask & { sprint_id: string }>(
            'tasks_of_sprints_batch', { sprint_ids: ids }
          ).then(tasks => {
            const m: Record<string, LoreSprintTask[]> = {};
            tasks.forEach(t => { (m[t.sprint_id] ??= []).push(t); });
            setTaskMap(prev => ({ ...prev, [uid]: m }));
          }).catch(() => { /* swallow — tasks are non-critical */ });
        }
      })
      .catch(e => { onError(e); setLoadingDetail(null); });
  }

  const projects = ['all', ...Array.from(new Set(rows.map(r => r.git_project ?? 'NooriUta/AIDA')))];

  const currentByProject: Record<string, string> = {};
  rows.forEach(r => { if (r.is_current) currentByProject[r.git_project ?? 'NooriUta/AIDA'] = r.git_tag ?? r.release_id; });

  const filtered = [...rows]
    .sort(semverCompare)
    .filter(r => {
      if (projectFilter !== 'all' && (r.git_project ?? 'NooriUta/AIDA') !== projectFilter) return false;
      if (onlyCurrent && !r.is_current) return false;
      if (q && !(r.git_tag ?? r.release_id).toLowerCase().includes(q.toLowerCase())) return false;
      return true;
    });

  // Group by minor version (v1.3.x, v1.4.x, ...)
  const groups: Map<string, LoreRelease[]> = new Map();
  for (const r of filtered) {
    const [maj, min] = semverParts(r.git_tag ?? r.release_id);
    const key = `v${maj}.${min}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(r);
  }

  if (loading) return <LoreSkeleton rows={6} />;

  return (
    <div style={S.root}>
      <div style={S.header}>
        <span style={S.count}>{t('lore.releasesBoard.releaseCount', '{{count}} релизов', { count: filtered.length })}</span>

        {/* Current filter chip */}
        <span
          style={{ ...S.projectTab, ...(onlyCurrent ? S.currentTabActive : {}) }}
          onClick={() => setOnlyCurrent(v => !v)}
          title={t('lore.releasesBoard.showOnlyCurrentTitle', 'Показать только текущие релизы каждого модуля')}
        >
          {t('lore.releasesBoard.currentChip', '● CURRENT')}
        </span>

        {/* Project tabs — always visible when >1 project */}
        {projects.filter(p => p !== 'all').length > 1 && projects.map(p => (
          <span
            key={p}
            style={{ ...S.projectTab, ...(projectFilter === p ? S.projectTabActive : {}) }}
            onClick={() => setProjectFilter(p)}
          >
            {p === 'all' ? t('lore.releasesBoard.allProjects', 'Все') : p.split('/')[1]}
          </span>
        ))}

        {/* Active filter chips */}
        {(projectFilter !== 'all' || onlyCurrent || q) && (
          <span
            style={S.resetBtn}
            onClick={() => { setProjectFilter('all'); setOnlyCurrent(false); onClearQ?.(); }}
          >
            {t('lore.releasesBoard.reset', '✕ сбросить')}
          </span>
        )}
        {q && (
          <span style={S.filterNote}>
            {t('lore.releasesBoard.quotedQuery', '«{{query}}»', { query: q })}{onClearQ && <span style={S.clearQ} onClick={onClearQ}>✕</span>}
          </span>
        )}
      </div>
      <div style={S.list} className="lore-panel-scroll">
        {filtered.length === 0 && <div style={S.empty}>{t('lore.releasesBoard.noReleasesFound', 'Релизы не найдены.')}</div>}
        {[...groups.entries()].map(([minor, releases]) => (
          <div key={minor}>
            <div style={S.groupHeader}>
              <span style={S.groupLabel}>{minor}</span>
              <span style={S.groupCount}>{t('lore.releasesBoard.releaseCount', '{{count}} релизов', { count: releases.length })}</span>
            </div>
            {releases.map(r => {
              const id     = r.release_id;
              const uid    = r.release_uid ?? id;
              const tag    = r.git_tag ?? id;
              const ruid   = r.release_uid ?? `${r.git_project ?? 'NooriUta/AIDA'}#${id}`;
              const isOpen = expanded === uid;
              const decs    = decisions[uid];
              const sprints = sprintRefs[uid];
              const prs     = prRefs[uid];
              const tasks   = taskMap[uid];
              const type   = r.type as string | null;
              const gp     = r.git_project ?? 'NooriUta/AIDA';
              const ghUrl  = `https://github.com/${gp}/releases/tag/${tag}`;
              return (
                <div
                  key={uid}
                  style={{ ...S.row, background: isOpen ? 'color-mix(in srgb, var(--acc) 5%, transparent)' : 'transparent' }}
                  onClick={() => toggle(uid, tag, ruid, r.git_tag ?? null)}
                >
                  <div style={S.tagCell}>
                    <span style={{ ...S.tag, ...(type === 'major' ? S.tagMajor : type === 'minor' ? S.tagMinor : S.tagPatch) }}>
                      {tag}
                    </span>
                    {r.is_current && <span style={S.currentBadge}>CURRENT</span>}
                  </div>
                  <div style={S.body}>
                    {projectFilter === 'all' && projects.length > 2 && (
                      <span style={S.repoBadge} title={gp}>{gp.split('/')[1]}</span>
                    )}
                    {type && <span style={S.typeBadge}>{TYPE_LABEL[type] ?? type}</span>}
                    {r.week != null && <span style={S.weekBadge}>wk {r.week}</span>}
                    {(r.sprint_count != null && r.sprint_count > 0) && (
                      <span style={S.countBadge} title={t('lore.releasesBoard.linkedSprintsTitle', 'Привязанных спринтов')}>↗ {r.sprint_count}</span>
                    )}
                    {(r.pr_count != null && r.pr_count > 0) && (
                      <span style={S.countBadge} title={t('lore.releasesBoard.linkedPrsTitle', 'Привязанных PR')}>PR {r.pr_count}</span>
                    )}
                    {r.description_md && <span style={S.desc}>{r.description_md.slice(0, 110)}</span>}
                    {isOpen && (
                      <div style={S.detail} onClick={e => e.stopPropagation()}>
                        {loadingDetail === uid && <span style={S.meta}>{t('lore.releasesBoard.loading', 'Загрузка…')}</span>}

                        {/* Sprints + Tasks */}
                        {sprints && sprints.length > 0 && (
                          <>
                            <span style={S.refLabel}>{t('lore.releasesBoard.sprintsLabel', 'Спринты ({{count}})', { count: sprints.length })}</span>
                            {sprints.map(s => {
                              const sTasks = tasks?.[s.sprint_id];
                              return (
                                <div key={s.sprint_id} style={S.sprintBlock}>
                                  <div
                                    style={S.sprintRef}
                                    onClick={() => onNavigateToSprint(s.sprint_id)}
                                    title={t('lore.releasesBoard.openSprintTitle', 'Открыть спринт {{id}}', { id: s.sprint_id })}
                                  >
                                    <span style={S.sprintId}>{s.sprint_id}</span>
                                    {s.name && s.name !== s.sprint_id && (
                                      <span style={S.sprintName}>{s.name}</span>
                                    )}
                                    {s.status_raw && <StatusChip status={s.status_raw} />}
                                    {sTasks && <span style={S.taskCount}>{t('lore.releasesBoard.taskCount', '{{count}} tasks', { count: sTasks.length })}</span>}
                                  </div>
                                  {sTasks && sTasks.length > 0 && (
                                    <div style={S.taskList}>
                                      {sTasks.map(t => {
                                        const done = (t.status_raw ?? '').includes('DONE') || (t.status_raw ?? '').includes('✅');
                                        return (
                                          <div key={t.task_uid} style={S.taskRow}>
                                            <span style={S.taskDot(done)} />
                                            <span style={S.taskId}>{t.task_id}</span>
                                            <span style={{ ...S.taskTitle, opacity: done ? 0.5 : 1 }}>{t.title}</span>
                                          </div>
                                        );
                                      })}
                                    </div>
                                  )}
                                </div>
                              );
                            })}
                          </>
                        )}

                        {/* PRs (via SHIPPED_IN edge) */}
                        {prs && prs.length > 0 && (
                          <>
                            <span style={{ ...S.refLabel, marginTop: sprints?.length ? 8 : 0 }}>{t('lore.releasesBoard.prLabel', 'PR')}</span>
                            {prs.map(p => {
                              const prGp  = p.git_project ?? 'NooriUta/AIDA';
                              const prUrl = p.url ?? `https://github.com/${prGp}/pull/${p.pr_number}`;
                              const prRepo = prGp !== gp ? prGp.split('/')[1] : null;
                              return (
                                <div key={p.pr_uid ?? p.pr_number} style={S.decisionRef}>
                                  <span style={S.decisionNum}>#{p.pr_number}</span>
                                  {prRepo && <span style={S.prRepo}>{prRepo}</span>}
                                  <span style={S.decisionTitle}>{p.title}</span>
                                  <a
                                    href={prUrl}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    onClick={e => e.stopPropagation()}
                                    style={S.ghLink}
                                    title={t('lore.releasesBoard.prTitle', 'PR #{{number}} · {{project}}', { number: p.pr_number, project: prGp })}
                                  ><GhIcon /></a>
                                </div>
                              );
                            })}
                          </>
                        )}

                        {/* Decisions */}
                        {decs && decs.length > 0 && (
                          <>
                            <span style={{ ...S.refLabel, marginTop: (sprints?.length || prs?.length) ? 8 : 0 }}>{t('lore.releasesBoard.decisionsLabel', 'Решения')}</span>
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
                          <span style={S.meta}>{t('lore.releasesBoard.noLinkedRecords', 'Связанных записей не найдено.')}</span>
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
                      title={t('lore.releasesBoard.githubReleaseTitle', 'GitHub Release {{tag}}', { tag })}
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
  filterNote: { fontSize: 11, color: 'var(--acc)', display: 'inline-flex', alignItems: 'center', gap: 4 },
  clearQ: { cursor: 'pointer', fontSize: 10, color: 'var(--t3)', padding: '0 2px' },
  resetBtn: {
    fontSize: 10, padding: '2px 7px', borderRadius: 10, cursor: 'pointer',
    border: '1px solid color-mix(in srgb, var(--err) 40%, transparent)',
    color: 'var(--err)', background: 'color-mix(in srgb, var(--err) 6%, transparent)',
  },
  currentTabActive: {
    background: 'color-mix(in srgb, var(--suc) 14%, transparent)',
    color: 'var(--suc)', borderColor: 'color-mix(in srgb, var(--suc) 40%, transparent)',
  },
  projectTab: {
    fontSize: 10, padding: '2px 8px', borderRadius: 10, cursor: 'pointer',
    border: '1px solid var(--bd)', color: 'var(--t3)',
    background: 'transparent', transition: 'all 0.1s',
  },
  projectTabActive: {
    background: 'color-mix(in srgb, var(--acc) 12%, transparent)',
    color: 'var(--acc)', borderColor: 'color-mix(in srgb, var(--acc) 40%, transparent)',
  },
  prRepo: {
    fontSize: 9, padding: '1px 4px', borderRadius: 3,
    background: 'color-mix(in srgb, var(--war) 10%, transparent)',
    color: 'var(--war)', fontFamily: 'var(--mono)', flexShrink: 0,
  },
  repoBadge: {
    fontSize: 9, padding: '1px 6px', borderRadius: 3, fontFamily: 'var(--mono)',
    background: 'color-mix(in srgb, var(--acc) 10%, transparent)',
    color: 'var(--acc)', border: '1px solid color-mix(in srgb, var(--acc) 25%, transparent)',
    flexShrink: 0,
  },
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
  countBadge: {
    fontSize: 10, padding: '1px 5px', borderRadius: 3,
    background: 'color-mix(in srgb, var(--acc) 8%, transparent)',
    color: 'var(--t3)', fontFamily: 'var(--mono)',
    border: '1px solid color-mix(in srgb, var(--acc) 20%, transparent)',
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
  sprintBlock: { marginBottom: 4 },
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
  taskCount: {
    fontSize: 9, padding: '1px 4px', borderRadius: 2, flexShrink: 0,
    background: 'color-mix(in srgb, var(--acc) 8%, transparent)',
    color: 'var(--t3)', border: '1px solid color-mix(in srgb, var(--acc) 18%, transparent)',
  },
  taskList: {
    paddingLeft: 16, paddingBottom: 4,
    borderLeft: '2px solid color-mix(in srgb, var(--acc) 18%, transparent)',
    marginLeft: 4, marginTop: 2,
  },
  taskRow: { display: 'flex', alignItems: 'center', gap: 6, padding: '2px 0' },
  taskDot: (done: boolean) => ({
    width: 5, height: 5, borderRadius: '50%', flexShrink: 0,
    background: done ? 'var(--suc)' : 'var(--acc)',
    opacity: done ? 0.5 : 1,
  }),
  taskId: { fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--acc)', flexShrink: 0 },
  taskTitle: { fontSize: 10, color: 'var(--t2)', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const },
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
