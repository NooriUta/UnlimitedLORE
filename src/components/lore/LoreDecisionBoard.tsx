// Composite feed view for KnowDecision — all records in a scrollable list.
// No master-detail split: decisions are short notes, not large documents.
import { useEffect, useState } from 'react';
import { fetchLoreSlice, type LoreDecisionRow, type LoreDecisionPassport } from '../../api/lore';
import { StatusChip } from '../../pages/LorePage';

interface Props {
  q: string;
  onError: (e: unknown) => void;
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

export default function LoreDecisionBoard({ q, onError }: Props) {
  const [rows,           setRows]           = useState<LoreDecisionRow[]>([]);
  const [loading,        setLoading]        = useState(true);
  const [expanded,       setExpanded]       = useState<string | null>(null);
  const [detail,         setDetail]         = useState<Record<string, LoreDecisionPassport>>({});
  const [loadingDetail,  setLoadingDetail]  = useState<string | null>(null);
  const [sortBy,         setSortBy]         = useState<'id' | 'date'>('id');
  const [sortDir,        setSortDir]        = useState<'asc' | 'desc'>('asc');
  const [groupByStatus,  setGroupByStatus]  = useState(false);
  const [collapsedGroups,setCollapsedGroups]= useState<Set<string>>(new Set());

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
      .catch(() => setLoadingDetail(null));
  }

  function toggleGroup(status: string) {
    setCollapsedGroups(prev => {
      const next = new Set(prev);
      if (next.has(status)) next.delete(status); else next.add(status);
      return next;
    });
  }

  const filtered = q
    ? rows.filter(d =>
        d.title.toLowerCase().includes(q.toLowerCase()) ||
        d.decision_id.includes(q.replace(/^#/, ''))
      )
    : rows;

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
        onClick={() => toggle(d.decision_id)}
      >
        <span style={S.num}>#{d.decision_id}</span>
        <div style={S.body}>
          <span style={S.title}>{d.title}</span>
          {isOpen && (
            <div style={S.detail} onClick={e => e.stopPropagation()}>
              {loadingDetail === d.decision_id && <span style={S.meta}>Загрузка…</span>}
              {det && (
                <>
                  {det.body_md && <pre style={S.bodyMd}>{det.body_md}</pre>}
                  {det.rationale_md && (
                    <div style={S.rationaleWrap}>
                      <span style={S.rationaleLabel}>Обоснование</span>
                      <pre style={S.bodyMd}>{det.rationale_md}</pre>
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
                    <span style={S.meta}>Дополнительных данных нет.</span>
                  )}
                </>
              )}
            </div>
          )}
        </div>
        {!groupByStatus && status && <StatusChip status={status} />}
        {d.date_created && <span style={S.date}>{d.date_created.slice(0, 10)}</span>}
      </div>
    );
  }

  if (loading) return <div style={S.empty}>Загрузка решений…</div>;

  return (
    <div style={S.root}>
      <div style={S.header}>
        <span style={S.count}>{filtered.length} решений</span>
        {q && <span style={S.filterNote}>фильтр: «{q}»</span>}
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 5, alignItems: 'center' }}>
          <div style={S.pillGroup}>
            <button
              onClick={() => {
                if (sortBy === 'id') setSortDir(d => d === 'asc' ? 'desc' : 'asc');
                else { setSortBy('id'); setSortDir('asc'); }
              }}
              style={{ ...S.ctrl, ...(sortBy === 'id' ? S.ctrlActive : {}), borderRadius: '4px 0 0 4px', borderRight: 'none' }}
            >
              по ID {sortBy === 'id' ? (sortDir === 'asc' ? '↑' : '↓') : ''}
            </button>
            <button
              onClick={() => {
                if (sortBy === 'date') setSortDir(d => d === 'asc' ? 'desc' : 'asc');
                else { setSortBy('date'); setSortDir('desc'); }
              }}
              style={{ ...S.ctrl, ...(sortBy === 'date' ? S.ctrlActive : {}), borderRadius: '0 4px 4px 0' }}
            >
              по дате {sortBy === 'date' ? (sortDir === 'asc' ? '↑' : '↓') : ''}
            </button>
          </div>
          <button
            onClick={() => setGroupByStatus(v => !v)}
            style={{ ...S.ctrl, ...(groupByStatus ? S.ctrlActive : {}) }}
            title={groupByStatus ? 'Убрать группировку' : 'Группировать по статусу'}
          >
            группировать
          </button>
        </div>
      </div>
      <div style={S.list}>
        {filtered.length === 0 && <div style={S.empty}>Решений не найдено.</div>}
        {sections.map(sec => {
          const isCollapsed = sec.status ? collapsedGroups.has(sec.status) : false;
          return (
            <div key={sec.status ?? 'all'}>
              {sec.status && (
                <div
                  style={{ ...S.groupHeader, cursor: 'pointer' }}
                  onClick={() => toggleGroup(sec.status!)}
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
  count:      { fontSize: 11, color: 'var(--t3)' },
  filterNote: { fontSize: 11, color: 'var(--acc)' },
  list:  { flex: 1, overflowY: 'auto' as const },
  empty: { padding: '24px 16px', color: 'var(--t3)', fontSize: 12 },
  row: {
    display: 'flex', alignItems: 'flex-start', gap: 10,
    padding: '8px 16px', borderBottom: '1px solid var(--bd)',
    cursor: 'pointer',
    transition: 'background 0.1s',
  },
  num: {
    fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--acc)',
    fontWeight: 700, minWidth: 42, flexShrink: 0, paddingTop: 1,
  },
  body: { flex: 1, minWidth: 0 },
  title: { fontSize: 12, color: 'var(--t1)', lineHeight: 1.6 },
  date:  { fontSize: 10, color: 'var(--t3)', flexShrink: 0, paddingTop: 2 },
  detail: {
    marginTop: 8, paddingTop: 8, borderTop: '1px solid var(--bd)',
  },
  meta:    { fontSize: 11, color: 'var(--t3)' },
  bodyMd: {
    fontSize: 11, color: 'var(--t2)', lineHeight: 1.7,
    margin: '0 0 8px 0', whiteSpace: 'pre-wrap' as const,
    fontFamily: 'inherit',
  },
  rationaleWrap: { marginBottom: 8 },
  rationaleLabel: {
    fontSize: 10, fontWeight: 600, color: 'var(--t3)',
    textTransform: 'uppercase' as const, letterSpacing: '0.08em',
    display: 'block', marginBottom: 3,
  },
  chips: { display: 'flex', flexWrap: 'wrap' as const, gap: 4 },
  chip: {
    fontSize: 10, padding: '2px 6px', borderRadius: 3,
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
  ctrl: {
    fontSize: 10, padding: '3px 8px', borderRadius: 4, cursor: 'pointer',
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
  groupChevron: { fontSize: 9, color: 'var(--t3)', flexShrink: 0 },
  groupCount:   { fontSize: 10, color: 'var(--t3)' },
  pillGroup:    { display: 'flex' },
};
