import { useEffect, useMemo, useState } from 'react';
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

const STATUS_FILTERS = [
  { key: 'done',        label: 'Готово'    },
  { key: 'in_progress', label: 'В работе'  },
  { key: 'partial',     label: 'Частично'  },
  { key: 'planned',     label: 'План'      },
  { key: 'deferred',    label: 'Отложено'  },
  { key: 'cancelled',   label: 'Отменено'  },
];

const S = {
  wrap:    { flex: 1, display: 'flex', flexDirection: 'column' as const, minHeight: 0 },
  toolbar: { display: 'flex', flexWrap: 'wrap' as const, alignItems: 'center', gap: 5, padding: '6px 10px', borderBottom: '1px solid var(--b2)', flexShrink: 0 },
  sortBtn: { display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer', fontSize: 10, padding: '3px 9px', borderRadius: 12, border: '1px solid var(--b3)', background: 'transparent', color: 'var(--t2)', fontFamily: 'inherit', whiteSpace: 'nowrap' as const },
  statusChip: (on: boolean, color: string) => ({
    display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer', userSelect: 'none' as const,
    fontSize: 10, padding: '3px 8px', borderRadius: 12, whiteSpace: 'nowrap' as const,
    border: `1px solid ${on ? color : 'var(--b3)'}`,
    background: on ? `color-mix(in srgb, ${color} 18%, transparent)` : 'transparent',
    color: on ? 'var(--t1)' : 'var(--t3)',
  }),
  chipCount: (on: boolean) => ({ fontSize: 9, opacity: on ? 0.85 : 0.55 }),
  root:  { flex: 1, overflowY: 'auto' as const, overflowX: 'hidden' as const },
  row: {
    display: 'flex', flexDirection: 'column' as const, gap: 2,
    padding: '6px 10px', borderBottom: '1px solid var(--b2)', minWidth: 0,
  },
  line1: { display: 'flex', alignItems: 'center', gap: 4, minWidth: 0 },
  line2: { display: 'flex', alignItems: 'center', gap: 6, paddingLeft: 1 },
  id: {
    color: 'var(--acc)', fontSize: 11, fontFamily: 'var(--mono)',
    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const, flex: 1, minWidth: 0,
  },
  date:  { color: 'var(--t3)', fontSize: 10, fontFamily: 'var(--mono)', flexShrink: 0 },
  empty: { padding: 24, color: 'var(--t3)', fontSize: 12 },
};

interface Props {
  module: string;
  q?: string;
  selectedId?: string;
  onError: (e: unknown) => void;
  onSelect?: (id: string) => void;
}

export default function LoreSprintTree({ module: _module, q, selectedId, onError, onSelect }: Props) {
  const [rows, setRows]         = useState<LoreSprintRow[]>([]);
  const [loading, setLoading]   = useState(true);
  const [sortDesc, setSortDesc] = useState(true);
  const [statusSel, setStatusSel] = useState<Set<string>>(new Set());

  useEffect(() => {
    setLoading(true);
    const ctrl = new AbortController();
    fetchLoreSlice<LoreSprintRow>('sprints', undefined, ctrl.signal)
      .then(r => { setRows(r); setLoading(false); })
      .catch(e => { onError(e); setLoading(false); });
    return () => ctrl.abort();
  }, [onError]);

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    rows.forEach(s => { const k = normalizeStatus(s.status_raw); if (k) c[k] = (c[k] || 0) + 1; });
    return c;
  }, [rows]);

  const visible = useMemo(() => {
    const qLow = q?.toLowerCase() ?? '';
    let v = rows.filter(s =>
      (!qLow || s.sprint_id.toLowerCase().includes(qLow) || (s.name ?? '').toLowerCase().includes(qLow)) &&
      (statusSel.size === 0 || statusSel.has(normalizeStatus(s.status_raw))));
    v = [...v].sort((a, b) => {
      const da = a.valid_from ?? '', db = b.valid_from ?? '';
      if (!da && !db) return a.sprint_id.localeCompare(b.sprint_id);
      if (!da) return 1;            // sprints without a date always last
      if (!db) return -1;
      if (da === db) return a.sprint_id.localeCompare(b.sprint_id);
      return sortDesc ? db.localeCompare(da) : da.localeCompare(db);
    });
    return v;
  }, [rows, q, statusSel, sortDesc]);

  const toggleStatus = (k: string) => setStatusSel(p => {
    const n = new Set(p);
    if (n.has(k)) n.delete(k); else n.add(k);
    return n;
  });

  if (loading) return <div style={S.empty}>Загрузка спринтов…</div>;
  if (!rows.length) return <div style={S.empty}>Спринты не найдены.</div>;

  return (
    <div style={S.wrap}>
      <div style={S.toolbar}>
        <button style={S.sortBtn} onClick={() => setSortDesc(d => !d)} title="Сортировка по дате">
          Дата {sortDesc ? '↓' : '↑'}
        </button>
        {STATUS_FILTERS.map(f => {
          const on = statusSel.has(f.key);
          const meta = statusMeta(f.key);
          return (
            <span key={f.key} style={S.statusChip(on, meta.color)} onClick={() => toggleStatus(f.key)}>
              <GameIcon slug={meta.icon} size={11} />
              {f.label}
              <span style={S.chipCount(on)}>{counts[f.key] ?? 0}</span>
            </span>
          );
        })}
      </div>

      <div style={S.root}>
        {visible.map(s => {
          const status = normalizeStatus(s.status_raw);
          // Prefer the closing date (done_date); fall back to the current-state entry date.
          const date   = (s.done_date ?? s.valid_from)?.slice(0, 10) ?? '';
          // Release № from the IMPLEMENTED_IN_RELEASE edge; fallback: parse vX.Y.Z from status_raw.
          const release = s.release_ids?.[0] ?? (s.status_raw?.match(/v\d+\.\d+(?:\.\d+)?/)?.[0] ?? null);
          const relDate = s.release_dates?.[0]?.slice(0, 10) ?? null;
          const active = selectedId === s.sprint_id;
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
                <span style={S.id}>{s.sprint_id}</span>
              </div>
              {(date || status || release || relDate) && (
                <div style={S.line2}>
                  {/* дата спринта · статус-иконка · № релиза · дата релиза */}
                  {date && <span style={S.date}>{date}</span>}
                  {status && (
                    <span title={status} style={{ display: 'inline-flex', alignItems: 'center' }}>
                      <GameIcon slug={statusMeta(status).icon} size={12} style={{ color: statusMeta(status).color }} />
                    </span>
                  )}
                  {release && (
                    <span style={{
                      fontSize: 10, padding: '0 5px', borderRadius: 3, whiteSpace: 'nowrap',
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
    </div>
  );
}
