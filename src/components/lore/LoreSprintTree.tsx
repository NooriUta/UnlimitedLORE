import { useEffect, useMemo, useRef, useState } from 'react';
import { fetchLoreSlice, type LoreSprintRow } from '../../api/lore';
import { statusMeta } from './lore-status';
import { GameIcon } from './GameIcon';

function normalizeStatus(raw: string | null): string {
  if (!raw) return '';
  const s = raw.trimStart();
  if (s.startsWith('✅') || /^(DONE|CLOSED|ЗАВЕРШ|MERGED|ЗАКРЫТ)/i.test(s)) return 'done';
  if (s.startsWith('🔄') || s.startsWith('🟢') ||
      /^(IN.?PROGRESS|WIP|ACTIVE|READY)/i.test(s)) return 'in_progress';
  if (s.startsWith('🟡') || /^(PARTIAL|ЧАСТИЧ)/i.test(s)) return 'partial';
  if (s.startsWith('📋') || s.startsWith('⬜') || /^(TODO|PLANNED|STUB|DRAFT)/i.test(s)) return 'planned';
  if (s.startsWith('🟣') || s.startsWith('⏸') ||
      /^(BACKLOG|DEFERRED|BLOCKED|ARCHIVED)/i.test(s)) return 'deferred';
  if (s.startsWith('🚫') || /^(CANCEL|ОТМЕН)/i.test(s)) return 'cancelled';
  return '';
}

// Semver-aware release comparator: v1.10.0 > v1.9.0
function releaseKey(id: string | null | undefined): string {
  if (!id) return '';
  return id.replace(/(\d+)/g, m => m.padStart(6, '0'));
}

// Short label for a git_project slug: "NooriUta/AIDA" → "AIDA"
function projLabel(slug: string): string {
  return slug.split('/').pop() ?? slug;
}

// Colour palette per project slug (consistent per session)
const PROJ_COLORS = [
  '#7c83fd', '#4dc9a0', '#e8884f', '#c47af5', '#f5c842', '#5ab4e8',
];
function projColor(slug: string, allSlugs: string[]): string {
  const i = allSlugs.indexOf(slug);
  return PROJ_COLORS[i % PROJ_COLORS.length];
}

type SortMode = 'date' | 'release' | 'project' | 'priority';

export const STATUS_FILTERS = [
  { key: 'done',        label: 'Готово'    },
  { key: 'in_progress', label: 'В работе'  },
  { key: 'partial',     label: 'Частично'  },
  { key: 'planned',     label: 'План'      },
  { key: 'deferred',    label: 'Отложено'  },
  { key: 'cancelled',   label: 'Отменено'  },
];

export interface SprintStats {
  total: number;
  done: number;
  active: number;
  p0Open: number;
  noRelease: number;
}

const S = {
  wrap:    { flex: 1, display: 'flex', flexDirection: 'column' as const, minHeight: 0 },

  // Toolbar (status chips + sort + refresh)
  toolbar: {
    display: 'flex', flexWrap: 'wrap' as const, alignItems: 'center',
    gap: 4, padding: '5px 8px', borderBottom: '1px solid var(--b2)', flexShrink: 0,
  },
  sortBtn: (active: boolean) => ({
    display: 'flex', alignItems: 'center', gap: 3, cursor: 'pointer',
    fontSize: 10, padding: '3px 8px', borderRadius: 12, whiteSpace: 'nowrap' as const,
    border: `1px solid ${active ? 'var(--acc)' : 'var(--b3)'}`,
    background: active ? 'color-mix(in srgb, var(--acc) 14%, transparent)' : 'transparent',
    color: active ? 'var(--acc)' : 'var(--t2)', fontFamily: 'inherit',
  }),
  refreshBtn: {
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    width: 24, height: 24, borderRadius: 6, cursor: 'pointer',
    border: '1px solid var(--b3)', background: 'transparent',
    color: 'var(--t3)', fontSize: 13, flexShrink: 0,
    marginLeft: 'auto' as const,
  },
  projChip: (on: boolean, color: string) => ({
    display: 'inline-flex', alignItems: 'center', gap: 3,
    cursor: 'pointer', userSelect: 'none' as const,
    fontSize: 10, padding: '2px 7px', borderRadius: 12, whiteSpace: 'nowrap' as const,
    border: `1px solid ${on ? color : 'var(--b3)'}`,
    background: on ? `color-mix(in srgb, ${color} 18%, transparent)` : 'transparent',
    color: on ? color : 'var(--t3)',
    fontWeight: on ? 600 : 400,
  }),
  statusChip: (on: boolean, color: string) => ({
    display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer',
    userSelect: 'none' as const, fontSize: 10, padding: '2px 7px',
    borderRadius: 12, whiteSpace: 'nowrap' as const,
    border: `1px solid ${on ? color : 'var(--b3)'}`,
    background: on ? `color-mix(in srgb, ${color} 18%, transparent)` : 'transparent',
    color: on ? 'var(--t1)' : 'var(--t3)',
  }),
  chipCount: (on: boolean) => ({ fontSize: 9, opacity: on ? 0.85 : 0.55 }),

  // List
  root:  { flex: 1, overflowY: 'auto' as const, overflowX: 'hidden' as const },
  row: {
    display: 'flex', flexDirection: 'column' as const, gap: 2,
    padding: '6px 10px', borderBottom: '1px solid var(--b2)', minWidth: 0,
  },
  line1: { display: 'flex', alignItems: 'center', gap: 4, minWidth: 0 },
  line2: { display: 'flex', alignItems: 'center', gap: 5, paddingLeft: 1 },
  id: {
    color: 'var(--acc)', fontSize: 11, fontFamily: 'var(--mono)',
    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const,
    flex: 1, minWidth: 0,
  },
  date:  { color: 'var(--t3)', fontSize: 10, fontFamily: 'var(--mono)', flexShrink: 0 },
  projDot: (color: string) => ({
    width: 6, height: 6, borderRadius: '50%', flexShrink: 0,
    background: color,
  }),
  empty: { padding: 24, color: 'var(--t3)', fontSize: 12 },
  spinning: { display: 'inline-block', animation: 'lore-spin 0.6s linear infinite' },
};

export type DatePeriod = 'month' | 'quarter' | '90d' | null;

interface Props {
  module: string;
  q?: string;
  statusFilter?: Set<string>;
  priorityFilter?: Set<string>;
  noRelease?: boolean;
  datePeriod?: DatePeriod;
  selectedId?: string;
  onError: (e: unknown) => void;
  onSelect?: (id: string) => void;
  onCounts?: (counts: Record<string, number>) => void;
  onStats?: (stats: SprintStats) => void;
}

export default function LoreSprintTree({ module: _module, q, statusFilter, priorityFilter, noRelease, datePeriod, selectedId, onError, onSelect, onCounts, onStats }: Props) {
  const [rows, setRows]           = useState<LoreSprintRow[]>([]);
  const [loading, setLoading]     = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [sortMode, setSortMode]   = useState<SortMode>('date');
  const [sortDesc, setSortDesc]   = useState(true);
  const statusSel   = statusFilter   ?? new Set<string>();
  const prioritySel = priorityFilter ?? new Set<string>();
  const [projSel, setProjSel]     = useState<Set<string>>(new Set());
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    if (reloadKey === 0) setLoading(true); else setRefreshing(true);
    fetchLoreSlice<LoreSprintRow>('sprints', undefined, ctrl.signal)
      .then(r => { setRows(r); })
      .catch(e => { if (!ctrl.signal.aborted) onError(e); })
      .finally(() => { setLoading(false); setRefreshing(false); });
    return () => ctrl.abort();
  }, [reloadKey, onError]);

  // All unique project slugs present in the data
  const allProjects = useMemo(() => {
    const set = new Set<string>();
    rows.forEach(s => s.git_projects?.forEach(g => set.add(g)));
    return [...set].sort();
  }, [rows]);

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    rows.forEach(s => { const k = normalizeStatus(s.status_raw); if (k) c[k] = (c[k] || 0) + 1; });
    return c;
  }, [rows]);

  useEffect(() => { onCounts?.(counts); }, [counts, onCounts]);

  const stats = useMemo<SprintStats>(() => ({
    total:     rows.length,
    done:      rows.filter(r => normalizeStatus(r.status_raw) === 'done').length,
    active:    rows.filter(r => ['in_progress', 'partial'].includes(normalizeStatus(r.status_raw))).length,
    p0Open:    rows.filter(r => r.priority === 'P0' && normalizeStatus(r.status_raw) !== 'done').length,
    noRelease: rows.filter(r => !r.release_ids || r.release_ids.length === 0).length,
  }), [rows]);

  useEffect(() => { onStats?.(stats); }, [stats, onStats]);

  const projCounts = useMemo(() => {
    const c: Record<string, number> = {};
    rows.forEach(s => s.git_projects?.forEach(g => { c[g] = (c[g] || 0) + 1; }));
    return c;
  }, [rows]);

  const visible = useMemo(() => {
    const qLow = q?.toLowerCase() ?? '';
    const now = new Date();
    const cutoff: string | null = (() => {
      if (!datePeriod) return null;
      const d = new Date(now);
      if (datePeriod === 'month')   { d.setDate(1); }
      if (datePeriod === 'quarter') { d.setMonth(Math.floor(d.getMonth() / 3) * 3, 1); }
      if (datePeriod === '90d')     { d.setDate(d.getDate() - 90); }
      return d.toISOString().slice(0, 10);
    })();
    let v = rows.filter(s => {
      if (qLow && !s.sprint_id.toLowerCase().includes(qLow) &&
          !(s.name ?? '').toLowerCase().includes(qLow) &&
          !(s.context_md ?? '').toLowerCase().includes(qLow)) return false;
      if (statusSel.size > 0 && !statusSel.has(normalizeStatus(s.status_raw))) return false;
      if (projSel.size > 0 && !s.git_projects?.some(g => projSel.has(g))) return false;
      if (prioritySel.size > 0 && !prioritySel.has(s.priority ?? '')) return false;
      if (noRelease && (s.release_ids?.length ?? 0) > 0) return false;
      if (cutoff) {
        const date = (s.done_date ?? s.valid_from ?? '').slice(0, 10);
        if (!date || date < cutoff) return false;
      }
      return true;
    });

    v = [...v].sort((a, b) => {
      if (sortMode === 'release') {
        const ra = releaseKey(a.release_ids?.[0]), rb = releaseKey(b.release_ids?.[0]);
        if (!ra && !rb) return a.sprint_id.localeCompare(b.sprint_id);
        if (!ra) return 1; if (!rb) return -1;
        return sortDesc ? rb.localeCompare(ra) : ra.localeCompare(rb);
      }
      if (sortMode === 'project') {
        const pa = a.git_projects?.[0] ?? '', pb = b.git_projects?.[0] ?? '';
        if (pa !== pb) return sortDesc ? pb.localeCompare(pa) : pa.localeCompare(pb);
        return a.sprint_id.localeCompare(b.sprint_id);
      }
      if (sortMode === 'priority') {
        const PMAP: Record<string, number> = { P0: 0, P1: 1, P2: 2 };
        const pa = PMAP[a.priority ?? ''] ?? 3, pb = PMAP[b.priority ?? ''] ?? 3;
        if (pa !== pb) return sortDesc ? pa - pb : pb - pa;
        return a.sprint_id.localeCompare(b.sprint_id);
      }
      // default: date
      const da = a.valid_from ?? '', db = b.valid_from ?? '';
      if (!da && !db) return a.sprint_id.localeCompare(b.sprint_id);
      if (!da) return 1; if (!db) return -1;
      if (da === db) return a.sprint_id.localeCompare(b.sprint_id);
      return sortDesc ? db.localeCompare(da) : da.localeCompare(db);
    });
    return v;
  }, [rows, q, statusSel, prioritySel, projSel, noRelease, datePeriod, sortMode, sortDesc]);

  const toggleProj = (g: string) => setProjSel(p => {
    const n = new Set(p); n.has(g) ? n.delete(g) : n.add(g); return n;
  });
  const cycleSort = (mode: SortMode) => {
    if (sortMode === mode) setSortDesc(d => !d);
    else { setSortMode(mode); setSortDesc(true); }
  };

  const refresh = () => setReloadKey(k => k + 1);

  if (loading) return <div style={S.empty}>Загрузка спринтов…</div>;
  if (!rows.length) return <div style={S.empty}>Спринты не найдены.</div>;

  return (
    <div style={S.wrap}>
      {/* ── Toolbar: sort + refresh ────────────────────── */}
      <div style={S.toolbar}>
        <button style={S.sortBtn(sortMode === 'date')}
          onClick={() => cycleSort('date')} title="Сортировка по дате">
          Дата {sortMode === 'date' ? (sortDesc ? '↓' : '↑') : ''}
        </button>
        <button style={S.sortBtn(sortMode === 'release')}
          onClick={() => cycleSort('release')} title="Сортировка по релизу">
          Релиз {sortMode === 'release' ? (sortDesc ? '↓' : '↑') : ''}
        </button>
        <button style={S.sortBtn(sortMode === 'project')}
          onClick={() => cycleSort('project')} title="Сортировка по проекту">
          Проект {sortMode === 'project' ? (sortDesc ? '↓' : '↑') : ''}
        </button>
        <button style={S.sortBtn(sortMode === 'priority')}
          onClick={() => cycleSort('priority')} title="Сортировка по приоритету">
          Приоритет {sortMode === 'priority' ? (sortDesc ? '↓' : '↑') : ''}
        </button>

        <button
          style={S.refreshBtn}
          onClick={refresh}
          title="Обновить список спринтов"
          disabled={refreshing}
        >
          <span style={refreshing ? S.spinning : undefined}>↺</span>
        </button>
      </div>


      {/* ── Project filter pills — прямо над списком ─── */}
      {allProjects.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, padding: '5px 8px 4px', borderBottom: '1px solid var(--b2)', flexShrink: 0 }}>
          {allProjects.map(slug => {
            const color = projColor(slug, allProjects);
            const on = projSel.has(slug);
            return (
              <span key={slug} style={S.projChip(on, color)}
                onClick={() => toggleProj(slug)}
                title={`${slug} (${projCounts[slug] ?? 0})`}>
                {projLabel(slug)}
                <span style={{ fontSize: 9, opacity: on ? 0.85 : 0.55 }}>{projCounts[slug] ?? 0}</span>
              </span>
            );
          })}
        </div>
      )}

      {/* ── List ──────────────────────────────────────── */}
      <div style={S.root}>
        {visible.map(s => {
          const status  = normalizeStatus(s.status_raw);
          const date    = (s.done_date ?? s.valid_from)?.slice(0, 10) ?? '';
          const release = s.release_ids?.[0] ?? (s.status_raw?.match(/v\d+\.\d+(?:\.\d+)?/)?.[0] ?? null);
          const relDate = s.release_dates?.[0]?.slice(0, 10) ?? null;
          const active  = selectedId === s.sprint_id;
          const projs   = s.git_projects ?? [];

          return (
            <div
              key={s.sprint_id}
              style={{
                ...S.row,
                background: active ? 'color-mix(in srgb, var(--acc) 10%, transparent)' : 'transparent',
                cursor: onSelect ? 'pointer' : 'default',
              }}
              onClick={() => onSelect?.(s.sprint_id)}
            >
              <div style={S.line1}>
                {/* Project colour dots */}
                {projs.map(g => (
                  <span key={g} style={S.projDot(projColor(g, allProjects))} title={g} />
                ))}
                <span style={S.id}>{s.sprint_id}</span>
              </div>
              {(date || status || release || relDate) && (
                <div style={S.line2}>
                  {date && <span style={S.date}>{date}</span>}
                  {s.priority && (
                    <span style={{
                      fontSize: 10, fontWeight: 600, flexShrink: 0,
                      color: s.priority === 'P0' ? '#E24B4A' : s.priority === 'P1' ? '#ef9f27' : 'var(--t3)',
                    }}>{s.priority}</span>
                  )}
                  {status && (
                    <span title={status} style={{ display: 'inline-flex', alignItems: 'center' }}>
                      <GameIcon slug={statusMeta(status).icon} size={12}
                        style={{ color: statusMeta(status).color }} />
                    </span>
                  )}
                  {release && (
                    <span style={{
                      fontSize: 10, padding: '0 5px', borderRadius: 3, whiteSpace: 'nowrap' as const,
                      background: 'color-mix(in srgb, var(--acc) 16%, transparent)',
                      color: 'var(--acc)', border: '1px solid color-mix(in srgb, var(--acc) 35%, transparent)',
                    }}>{release}</span>
                  )}
                  {relDate && <span style={{ ...S.date, opacity: 0.7 }}>{relDate}</span>}
                </div>
              )}
            </div>
          );
        })}
        {visible.length === 0 && <div style={S.empty}>Ничего не найдено.</div>}
      </div>

      <style>{`
        @keyframes lore-spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
      `}</style>
    </div>
  );
}
