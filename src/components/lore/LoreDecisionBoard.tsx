// Composite feed view for KnowDecision — all records in a scrollable list.
// No master-detail split: decisions are short notes, not large documents.
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { a11yClick } from './a11y';
import { fetchLoreSlice, type LoreDecisionRow, type LoreDecisionPassport } from '../../api/lore';
import { StatusChip } from '../../pages/LorePage';
import LoreSkeleton from './LoreSkeleton';
import { MartProse } from '../bench/MartProse';
import { useIsNarrow } from '../../hooks/useMediaQuery';
import { FilterBar, Chip, type FilterTagData } from './FilterPrimitives';
import { resolveStatusMeta, statusLabel } from './lore-status';
import { GameIcon } from './GameIcon';

// Distinct marker for orphan decisions (no parent ADR) — used both on the
// filter chip and on each orphan row, so orphans are spottable in the list.
const OrphanIcon = ({ size = 11 }: { size?: number }) => (
  <GameIcon slug="broken-heart" size={size} style={{ color: 'var(--wrn)' }} />
);

interface Props {
  q: string;
  onError: (e: unknown) => void;
  /** Navigate to the parent ADR passport (ADR-019 "rule → why"). */
  onNavigateAdr?: (adrId: string) => void;
}

// KnowDecision has no status field — but many titles state the decision's own
// resolution as a leading marker ("Q29 ЗАКРЫТ: …", "ADR-MIMIR-002 ACCEPTED: …").
// Only trust a keyword in the HEADLINE (first ~45 chars), so a keyword buried
// mid-text that refers to a *different* entity (e.g. #4 mentions "ADR-DA-001
// REVOKED" — not its own status) does not produce a misleading chip.
// Note: \b is ASCII-only in JS regex, so it never matches a boundary before a
// Cyrillic letter — Cyrillic keywords are therefore matched WITHOUT \b (they are
// distinctive enough inside the short headline window).
const DECISION_STATUS: [RegExp, string][] = [
  [/ЗАКРЫТ|ЗАКР\b|\bCLOSED\b/i,                'done'],
  [/\bRESOLVED\b|\bFIXED\b/i,                  'fixed'],
  [/\bACCEPTED\b|ПРИНЯТ/i,                     'accepted'],
  [/\bCONFIRMED\b/i,                           'accepted'],
  [/\bREVOKED\b|ОТМЕН[ёе]н|ОТКЛОН[ёе]н/i,      'rejected'],
  [/\bDEFERRED\b|ОТЛОЖ|\bBACKLOG\b/i,          'deferred'],
  [/\bOBSOLETE\b|\bSUPERSEDED\b/i,             'superseded'],
];
function inferDecisionStatus(title: string | null): string | null {
  const head = (title ?? '').slice(0, 45);
  for (const [re, status] of DECISION_STATUS) if (re.test(head)) return status;
  return null;
}

const STATUS_ORDER = ['fixed', 'accepted', 'done', 'deferred', 'rejected', 'superseded'];

const dimLbl = {
  fontSize: 'var(--fs-2xs)', color: 'var(--t3)', textTransform: 'uppercase' as const,
  letterSpacing: 0.5, marginRight: 4, minWidth: 70,
};

export default function LoreDecisionBoard({ q, onError, onNavigateAdr }: Props) {
  const { t } = useTranslation();
  // MOB: compact date (MM-DD) on narrow — frees width for the decision text.
  const narrow = useIsNarrow(720);
  const [rows,           setRows]           = useState<LoreDecisionRow[]>([]);
  const [loading,        setLoading]        = useState(true);
  const [expanded,       setExpanded]       = useState<string | null>(null);
  const [detail,         setDetail]         = useState<Record<string, LoreDecisionPassport>>({});
  const [loadingDetail,  setLoadingDetail]  = useState<string | null>(null);
  const [sortBy,         setSortBy]         = useState<'id' | 'date'>('id');
  const [sortDir,        setSortDir]        = useState<'asc' | 'desc'>('asc');
  const [groupByStatus,  setGroupByStatus]  = useState(false);
  const [collapsedGroups,setCollapsedGroups]= useState<Set<string>>(new Set());
  // T34: status facet filter (decisions carry no status field — the category is
  // inferred from the headline via inferDecisionStatus, same source group-by uses).
  const [statusSel,      setStatusSel]      = useState<Set<string>>(new Set());
  const [filterOpen,     setFilterOpen]     = useState(false);
  // ADR-019 "rule" mode facets: component + parent (has ADR / orphan).
  const [compSel,        setCompSel]        = useState<Set<string>>(new Set());
  const [parentFilter,   setParentFilter]   = useState<'all' | 'has' | 'orphan'>('all');

  useEffect(() => {
    setLoading(true);
    const ctrl = new AbortController();
    fetchLoreSlice<LoreDecisionRow>('decisions', undefined, ctrl.signal)
      .then(r => { setRows(r); setLoading(false); })
      .catch(e => { onError(e); setLoading(false); });
    return () => ctrl.abort();
  }, [onError]);

  function toggle(id: string) {
    if (expanded === id) { setExpanded(null); return; }
    setExpanded(id);
    if (detail[id]) return;
    setLoadingDetail(id);
    fetchLoreSlice<LoreDecisionPassport>('decision', { id })
      .then(rows => {
        if (rows[0]) setDetail(prev => ({ ...prev, [id]: rows[0] }));
        setLoadingDetail(null);
      })
      .catch(e => { onError(e); setLoadingDetail(null); });
  }

  function toggleGroup(status: string) {
    setCollapsedGroups(prev => {
      const next = new Set(prev);
      if (next.has(status)) next.delete(status); else next.add(status);
      return next;
    });
  }

  const decStatus = (d: LoreDecisionRow): string | null => d.status_raw ?? inferDecisionStatus(d.title);
  function toggleStatus(s: string) {
    setStatusSel(prev => { const n = new Set(prev); n.has(s) ? n.delete(s) : n.add(s); return n; });
  }
  // Available status chips: only categories actually present, ordered by STATUS_ORDER.
  const statusCounts = (() => {
    const m: Record<string, number> = {};
    rows.forEach(d => { const s = decStatus(d); if (s) m[s] = (m[s] || 0) + 1; });
    return m;
  })();
  const allStatuses = [
    ...STATUS_ORDER.filter(s => statusCounts[s]),
    ...Object.keys(statusCounts).filter(s => !STATUS_ORDER.includes(s)).sort(),
  ];
  const compCounts = (() => {
    const m: Record<string, number> = {};
    rows.forEach(d => { if (d.component_id) m[d.component_id] = (m[d.component_id] || 0) + 1; });
    return m;
  })();
  const allComps = Object.keys(compCounts).sort((a, b) => (compCounts[b] - compCounts[a]) || a.localeCompare(b));
  const orphanCount = rows.filter(d => !d.parent_adr).length;

  const filtered = rows
    .filter(d => {
      if (!q) return true;
      const ql = q.toLowerCase();
      // Search matches the decision's own text/id AND its parent ADR — so an
      // ADR id typed here surfaces that ADR's decisions (по ADR и по решению).
      return d.title.toLowerCase().includes(ql)
        || d.decision_id.includes(q.replace(/^#/, ''))
        || (d.parent_adr ?? '').toLowerCase().includes(ql);
    })
    .filter(d => statusSel.size === 0 || statusSel.has(decStatus(d) ?? '\0'))
    .filter(d => compSel.size === 0 || (d.component_id != null && compSel.has(d.component_id)))
    .filter(d => parentFilter === 'all' || (parentFilter === 'has' ? !!d.parent_adr : !d.parent_adr));

  const display = [...filtered].sort((a, b) => {
    const dir = sortDir === 'asc' ? 1 : -1;
    if (sortBy === 'date') {
      return dir * (a.date_created ?? '').localeCompare(b.date_created ?? '');
    }
    return dir * (parseInt(a.decision_id, 10) - parseInt(b.decision_id, 10));
  });

  // Build sections: one group per status when grouped, single flat section otherwise
  type Section = { status: string | null; rows: LoreDecisionRow[] };
  const sections: Section[] = (() => {
    if (!groupByStatus) return [{ status: null, rows: display }];
    const map: Record<string, LoreDecisionRow[]> = {};
    display.forEach(d => {
      const s = (d.status_raw ?? inferDecisionStatus(d.title)) ?? 'unknown';
      (map[s] ??= []).push(d);
    });
    const known = STATUS_ORDER.filter(s => map[s]);
    const rest  = Object.keys(map).filter(s => !STATUS_ORDER.includes(s));
    return [...known, ...rest].map(s => ({ status: s, rows: map[s] }));
  })();

  function renderRow(d: LoreDecisionRow) {
    const isOpen = expanded === d.decision_id;
    const det    = detail[d.decision_id];
    const status = d.status_raw ?? inferDecisionStatus(d.title);
    const hasLinks = det && (
      det.adr_refs?.filter(Boolean).length ||
      det.sprint_refs?.filter(Boolean).length ||
      det.pr_refs?.filter(Boolean).length ||
      det.release_refs?.filter(Boolean).length ||
      det.supersedes_ids?.filter(Boolean).length
    );
    return (
      <div
        key={d.decision_id}
        style={{ ...S.row, background: isOpen ? 'color-mix(in srgb, var(--acc) 5%, transparent)' : 'transparent' }}
        {...a11yClick(() => toggle(d.decision_id))}
      >
        <span style={S.num}>#{d.decision_id}</span>
        <div style={S.body}>
          <span style={S.title}>{d.title}</span>
          {isOpen && (
            <div style={S.detail} onClick={e => e.stopPropagation()}>
              {loadingDetail === d.decision_id && <span style={S.meta}>{t('lore.decisionBoard.loading', 'Загрузка…')}</span>}
              {det && (
                <>
                  {det.body_md && <MartProse text={det.body_md} />}
                  {det.rationale_md && (
                    <div style={S.rationaleWrap}>
                      <span style={S.rationaleLabel}>{t('lore.decisionBoard.rationaleLabel', 'Обоснование')}</span>
                      <MartProse text={det.rationale_md} />
                    </div>
                  )}
                  {hasLinks ? (
                    <div style={S.chips}>
                      {det.release_refs?.filter(Boolean).map((id: string) => (
                        <span key={id} style={{ ...S.chip, ...S.chipRelease }}>{id}</span>
                      ))}
                      {det.adr_refs?.filter(Boolean).map((id: string) => (
                        <span key={id} style={S.chip}>{id}</span>
                      ))}
                      {det.sprint_refs?.filter(Boolean).map((id: string) => (
                        <span key={id} style={{ ...S.chip, ...S.chipSprint }}>{id}</span>
                      ))}
                      {det.pr_refs?.filter(Boolean).map((id: string) => (
                        <span key={id} style={{ ...S.chip, ...S.chipPr }}>PR #{id.replace(/^PR#?/i,'')}</span>
                      ))}
                      {det.supersedes_ids?.filter(Boolean).map((id: string) => (
                        <span key={id} style={{ ...S.chip, ...S.chipSupersedes }}>→ #{id}</span>
                      ))}
                    </div>
                  ) : null}
                  {!det.body_md && !det.rationale_md && !hasLinks && (
                    <span style={S.meta}>{t('lore.decisionBoard.noAdditionalData', 'Дополнительных данных нет.')}</span>
                  )}
                </>
              )}
            </div>
          )}
        </div>
        {d.component_id && <span style={S.compChip}>{d.component_id}</span>}
        {d.parent_adr ? (
          onNavigateAdr
            ? <span role="button" tabIndex={0} style={S.parentLink} title={d.parent_adr}
                onClick={e => { e.stopPropagation(); onNavigateAdr(d.parent_adr!); }}
                onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); onNavigateAdr(d.parent_adr!); } }}>
                {d.parent_adr}
              </span>
            : <span style={S.parentChip} title={d.parent_adr}>{d.parent_adr}</span>
        ) : (
          <span style={S.orphanChip} title={t('lore.decisionBoard.parentOrphan', 'Независимые')}>
            <OrphanIcon size={10} />
          </span>
        )}
        {!groupByStatus && status && <StatusChip status={status} />}
        {d.date_created && (
          <span style={S.date} title={d.date_created.slice(0, 10)}>
            {narrow ? d.date_created.slice(5, 10) : d.date_created.slice(0, 10)}
          </span>
        )}
      </div>
    );
  }

  if (loading) return <LoreSkeleton />;

  return (
    <div style={S.root}>
      <div style={S.header}>
        <span style={S.count}>{t('lore.decisionBoard.countSuffix', '{{count}} решений', { count: filtered.length })}</span>
        {q && <span style={S.filterNote}>{t('lore.decisionBoard.filterNote', 'фильтр: «{{q}}»', { q })}</span>}
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 5, alignItems: 'center' }}>
          <div style={S.pillGroup}>
            <button
              onClick={() => {
                if (sortBy === 'id') setSortDir(d => d === 'asc' ? 'desc' : 'asc');
                else { setSortBy('id'); setSortDir('asc'); }
              }}
              style={{ ...S.ctrl, ...(sortBy === 'id' ? S.ctrlActive : {}), borderRadius: '4px 0 0 4px', borderRight: 'none' }}
            >
              {t('lore.decisionBoard.sortById', 'по ID')} {sortBy === 'id' ? (sortDir === 'asc' ? '↑' : '↓') : ''}
            </button>
            <button
              onClick={() => {
                if (sortBy === 'date') setSortDir(d => d === 'asc' ? 'desc' : 'asc');
                else { setSortBy('date'); setSortDir('desc'); }
              }}
              style={{ ...S.ctrl, ...(sortBy === 'date' ? S.ctrlActive : {}), borderRadius: '0 4px 4px 0' }}
            >
              {t('lore.decisionBoard.sortByDate', 'по дате')} {sortBy === 'date' ? (sortDir === 'asc' ? '↑' : '↓') : ''}
            </button>
          </div>
          <button
            onClick={() => setGroupByStatus(v => !v)}
            style={{ ...S.ctrl, ...(groupByStatus ? S.ctrlActive : {}) }}
            title={groupByStatus ? t('lore.decisionBoard.ungroupTitle', 'Убрать группировку') : t('lore.decisionBoard.groupTitle', 'Группировать по статусу')}
          >
            {t('lore.decisionBoard.groupButton', 'группировать')}
          </button>
        </div>
      </div>
      {/* T34: status facet filter (collapsible one-line band, same as QG/Знания) */}
      {(allStatuses.length > 1 || allComps.length > 0) && (
        <FilterBar
          tier="local"
          label={t('lore.decisionBoard.filtersLabel', 'Фильтры')}
          activeCount={statusSel.size + compSel.size + (parentFilter !== 'all' ? 1 : 0)}
          summaryTags={[
            ...[...statusSel].map((s): FilterTagData => ({
              key: 's:' + s, label: statusLabel(s), color: resolveStatusMeta(s).color,
              onRemove: () => setStatusSel(prev => { const n = new Set(prev); n.delete(s); return n; }),
            })),
            ...[...compSel].map((c): FilterTagData => ({
              key: 'c:' + c, label: c,
              onRemove: () => setCompSel(prev => { const n = new Set(prev); n.delete(c); return n; }),
            })),
            ...(parentFilter !== 'all' ? [{
              key: 'p', label: parentFilter === 'has' ? t('lore.decisionBoard.parentHas', 'Под ADR') : t('lore.decisionBoard.parentOrphan', 'Независимые'),
              onRemove: () => setParentFilter('all'),
            } as FilterTagData] : []),
          ]}
          onClear={() => { setStatusSel(new Set()); setCompSel(new Set()); setParentFilter('all'); }}
          open={filterOpen}
          onToggleOpen={() => setFilterOpen(v => !v)}
        >
          <div style={{ display: 'flex', flexDirection: 'column' as const, gap: 8 }}>
            {allStatuses.length > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap' as const, gap: 6, alignItems: 'center' }}>
                <span style={dimLbl}>{t('lore.decisionBoard.statusLabel', 'Статус')}</span>
                {allStatuses.map(s => (
                  <Chip key={s} label={statusLabel(s)} pressed={statusSel.has(s)}
                    onClick={() => toggleStatus(s)} count={statusCounts[s]}
                    color={resolveStatusMeta(s).color} dot />
                ))}
              </div>
            )}
            {allComps.length > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap' as const, gap: 6, alignItems: 'center' }}>
                <span style={dimLbl}>{t('lore.decisionBoard.componentLabel', 'Компонент')}</span>
                {allComps.map(c => (
                  <Chip key={c} label={c} pressed={compSel.has(c)}
                    onClick={() => setCompSel(prev => { const n = new Set(prev); n.has(c) ? n.delete(c) : n.add(c); return n; })}
                    count={compCounts[c]} dot />
                ))}
              </div>
            )}
            <div style={{ display: 'flex', flexWrap: 'wrap' as const, gap: 6, alignItems: 'center' }}>
              <span style={dimLbl}>{t('lore.decisionBoard.parentLabel', 'Привязка к ADR')}</span>
              <Chip label={t('lore.decisionBoard.parentHas', 'Под ADR')} pressed={parentFilter === 'has'}
                onClick={() => setParentFilter(p => p === 'has' ? 'all' : 'has')} count={rows.length - orphanCount} />
              <Chip
                label={<span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><OrphanIcon />{t('lore.decisionBoard.parentOrphan', 'Независимые')}</span>}
                pressed={parentFilter === 'orphan'}
                onClick={() => setParentFilter(p => p === 'orphan' ? 'all' : 'orphan')} count={orphanCount} />
            </div>
          </div>
        </FilterBar>
      )}
      <div style={S.list}>
        {filtered.length === 0 && <div style={S.empty}>{t('lore.decisionBoard.noneFound', 'Решений не найдено.')}</div>}
        {sections.map(sec => {
          const isCollapsed = sec.status ? collapsedGroups.has(sec.status) : false;
          return (
            <div key={sec.status ?? 'all'}>
              {sec.status && (
                <div
                  style={{ ...S.groupHeader, cursor: 'pointer' }}
                  {...a11yClick(() => toggleGroup(sec.status!))}
                >
                  <span style={S.groupChevron}>{isCollapsed ? '▶' : '▼'}</span>
                  <StatusChip status={sec.status} />
                  <span style={S.groupCount}>{sec.rows.length}</span>
                </div>
              )}
              {!isCollapsed && sec.rows.map(renderRow)}
            </div>
          );
        })}
      </div>
    </div>
  );
}

const S = {
  root:  { flex: 1, display: 'flex', flexDirection: 'column' as const, overflow: 'hidden' },
  header: {
    display: 'flex', alignItems: 'center', gap: 10,
    padding: '6px 16px', borderBottom: '1px solid var(--bd)',
    flexShrink: 0,
  },
  count:      { fontSize: 'var(--fs-sm)', color: 'var(--t3)' },
  filterNote: { fontSize: 'var(--fs-sm)', color: 'var(--acc)' },
  list:  { flex: 1, overflowY: 'auto' as const },
  empty: { padding: '24px 16px', color: 'var(--t3)', fontSize: 'var(--fs-base)' },
  row: {
    display: 'flex', alignItems: 'flex-start', gap: 10,
    padding: '8px 16px', borderBottom: '1px solid var(--bd)',
    cursor: 'pointer',
    transition: 'background 0.1s',
  },
  num: {
    fontFamily: 'var(--mono)', fontSize: 'var(--fs-sm)', color: 'var(--acc)',
    fontWeight: 700, minWidth: 42, flexShrink: 0, paddingTop: 1,
  },
  body: { flex: 1, minWidth: 0 },
  title: { fontSize: 'var(--fs-base)', color: 'var(--t1)', lineHeight: 1.6 },
  date:  { fontSize: 'var(--fs-xs)', color: 'var(--t3)', flexShrink: 0, paddingTop: 2 },
  detail: {
    marginTop: 8, paddingTop: 8, borderTop: '1px solid var(--bd)',
  },
  meta:    { fontSize: 'var(--fs-sm)', color: 'var(--t3)' },
  bodyMd: {
    fontSize: 'var(--fs-sm)', color: 'var(--t2)', lineHeight: 1.7,
    margin: '0 0 8px 0', whiteSpace: 'pre-wrap' as const,
    fontFamily: 'inherit',
  },
  rationaleWrap: { marginBottom: 8 },
  rationaleLabel: {
    fontSize: 'var(--fs-xs)', fontWeight: 600, color: 'var(--t3)',
    textTransform: 'uppercase' as const, letterSpacing: '0.08em',
    display: 'block', marginBottom: 3,
  },
  chips: { display: 'flex', flexWrap: 'wrap' as const, gap: 4 },
  chip: {
    fontSize: 'var(--fs-xs)', padding: '2px 6px', borderRadius: 3,
    background: 'color-mix(in srgb, var(--acc) 12%, transparent)',
    color: 'var(--acc)', border: '1px solid color-mix(in srgb, var(--acc) 25%, transparent)',
    fontFamily: 'var(--mono)',
  },
  chipSprint: {
    background: 'color-mix(in srgb, var(--suc) 12%, transparent)',
    color: 'var(--suc)', border: '1px solid color-mix(in srgb, var(--suc) 25%, transparent)',
  },
  chipSupersedes: {
    background: 'color-mix(in srgb, var(--t3) 10%, transparent)',
    color: 'var(--t2)', border: '1px solid color-mix(in srgb, var(--t3) 30%, transparent)',
  },
  chipRelease: {
    background: 'color-mix(in srgb, var(--war) 12%, transparent)',
    color: 'var(--war)', border: '1px solid color-mix(in srgb, var(--war) 30%, transparent)',
  },
  chipPr: {
    background: 'color-mix(in srgb, var(--t2) 10%, transparent)',
    color: 'var(--t2)', border: '1px solid color-mix(in srgb, var(--t2) 25%, transparent)',
  },
  compChip: {
    fontSize: 'var(--fs-2xs)', padding: '1px 5px', borderRadius: 3, flexShrink: 0,
    background: 'var(--b2)', color: 'var(--t3)', alignSelf: 'flex-start' as const,
  },
  parentChip: {
    fontSize: 'var(--fs-2xs)', padding: '1px 5px', borderRadius: 3, flexShrink: 0,
    fontFamily: 'var(--mono)', color: 'var(--t3)', border: '1px solid var(--bd)', alignSelf: 'flex-start' as const,
  },
  parentLink: {
    fontSize: 'var(--fs-2xs)', padding: '1px 5px', borderRadius: 3, flexShrink: 0, cursor: 'pointer',
    fontFamily: 'var(--mono)', color: 'var(--acc)', border: '1px solid color-mix(in srgb, var(--acc) 30%, transparent)',
    background: 'color-mix(in srgb, var(--acc) 8%, transparent)', alignSelf: 'flex-start' as const,
  },
  orphanChip: {
    display: 'inline-flex', alignItems: 'center', padding: '1px 4px', borderRadius: 3, flexShrink: 0,
    border: '1px solid color-mix(in srgb, var(--wrn) 30%, transparent)',
    background: 'color-mix(in srgb, var(--wrn) 8%, transparent)', alignSelf: 'flex-start' as const,
  },
  ctrl: {
    fontSize: 'var(--fs-xs)', padding: '3px 8px', borderRadius: 4, cursor: 'pointer',
    border: '1px solid var(--bd)', background: 'transparent', color: 'var(--t3)',
  },
  ctrlActive: {
    background: 'color-mix(in srgb, var(--acc) 15%, transparent)',
    color: 'var(--acc)', border: '1px solid color-mix(in srgb, var(--acc) 40%, transparent)',
  },
  groupHeader: {
    display: 'flex', alignItems: 'center', gap: 6,
    padding: '5px 16px', background: 'var(--bg2)',
    borderBottom: '1px solid var(--bd)', borderTop: '1px solid var(--bd)',
    position: 'sticky' as const, top: 0, zIndex: 1,
  },
  groupChevron: { fontSize: 'var(--fs-2xs)', color: 'var(--t3)', flexShrink: 0 },
  groupCount:   { fontSize: 'var(--fs-xs)', color: 'var(--t3)' },
  pillGroup:    { display: 'flex' },
};
