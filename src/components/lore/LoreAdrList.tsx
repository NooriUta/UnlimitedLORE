import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { fetchLoreSlice, type LoreAdrRow } from '../../api/lore';

type DatePreset = null | '3m' | '6m' | '1y';
const DATE_PRESETS: { key: DatePreset; labelKey: string; labelFallback: string }[] = [
  { key: null, labelKey: 'lore.adrList.datePreset.all', labelFallback: 'Все' },
  { key: '3m', labelKey: 'lore.adrList.datePreset.3m',  labelFallback: '3м' },
  { key: '6m', labelKey: 'lore.adrList.datePreset.6m',  labelFallback: '6м' },
  { key: '1y', labelKey: 'lore.adrList.datePreset.1y',  labelFallback: 'Год' },
];
function cutoffDate(preset: DatePreset): string | null {
  if (!preset) return null;
  const d = new Date();
  if (preset === '3m') d.setMonth(d.getMonth() - 3);
  else if (preset === '6m') d.setMonth(d.getMonth() - 6);
  else d.setFullYear(d.getFullYear() - 1);
  return d.toISOString().slice(0, 10);
}

export const ADR_STATUS_FILTERS = [
  { key: 'PROPOSED',   label: 'Proposed',   color: 'var(--inf)' },
  { key: 'ACCEPTED',   label: 'Accepted',   color: 'var(--suc)' },
  { key: 'DEPRECATED', label: 'Deprecated', color: 'var(--wrn)' },
  { key: 'SUPERSEDED', label: 'Superseded', color: 'var(--t3)'  },
];
const STATUS_COLOR: Record<string, string> = Object.fromEntries(
  ADR_STATUS_FILTERS.map(f => [f.key, f.color])
);

const S = {
  root:  { flex: 1, overflowY: 'auto' as const, overflowX: 'hidden' as const, display: 'flex', flexDirection: 'column' as const },
  newBtn: {
    display: 'flex', alignItems: 'center', gap: 5,
    padding: '5px 10px', margin: '6px 8px',
    background: 'color-mix(in srgb, var(--acc) 10%, transparent)',
    color: 'var(--acc)', border: '1px dashed color-mix(in srgb, var(--acc) 40%, transparent)',
    borderRadius: 5, cursor: 'pointer', fontSize: 11, fontWeight: 600,
  },
  dateLine: { display: 'flex', alignItems: 'center', gap: 4, padding: '4px 10px', flexShrink: 0 },
  dateBtn: (on: boolean) => ({
    padding: '2px 8px', borderRadius: 4, fontSize: 10, cursor: 'pointer',
    border: `1px solid ${on ? 'var(--acc)' : 'var(--b3)'}`,
    background: on ? 'color-mix(in srgb, var(--acc) 14%, transparent)' : 'transparent',
    color: on ? 'var(--acc)' : 'var(--t3)',
  }),
  list: { flex: 1, overflowY: 'auto' as const },
  row: {
    display: 'flex', flexDirection: 'column' as const, gap: 2,
    padding: '6px 10px', borderBottom: '1px solid var(--bd)',
    fontSize: 11, cursor: 'pointer', minWidth: 0,
  },
  line1: { display: 'flex', alignItems: 'center', gap: 5, minWidth: 0 },
  line2: { display: 'flex', alignItems: 'center', gap: 5 },
  id: {
    color: 'var(--acc)', fontFamily: 'var(--mono)',
    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const,
    minWidth: 0, flexShrink: 0,
  },
  name: {
    flex: 1, color: 'var(--t2)', fontSize: 10,
    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const,
    minWidth: 0,
  },
  statusDot: (color: string) => ({
    width: 6, height: 6, borderRadius: '50%', flexShrink: 0,
    background: color,
  }),
  statusBadge: (color: string) => ({
    fontSize: 9, padding: '1px 4px', borderRadius: 2, flexShrink: 0,
    color, background: `color-mix(in srgb, ${color} 14%, transparent)`,
    border: `1px solid color-mix(in srgb, ${color} 28%, transparent)`,
    whiteSpace: 'nowrap' as const,
  }),
  component: {
    fontSize: 9, padding: '1px 4px', borderRadius: 2, flexShrink: 0,
    background: 'var(--b2)', color: 'var(--t3)',
  },
  date: { fontSize: 9, color: 'var(--t3)', fontFamily: 'var(--mono)', flexShrink: 0 },
  empty: { padding: 24, color: 'var(--t3)', fontSize: 12 },
};

interface Props {
  module: string;
  q: string;
  statusSel: Set<string>;
  selectedId?: string;
  onError: (e: unknown) => void;
  onOpen: (id: string) => void;
  onNew: () => void;
  onCounts: (counts: Record<string, number>) => void;
}

export default function LoreAdrList({ module, q, statusSel, selectedId, onError, onOpen, onNew, onCounts }: Props) {
  const { t } = useTranslation();
  const [rows, setRows]             = useState<LoreAdrRow[]>([]);
  const [loading, setLoading]       = useState(true);
  const [datePreset, setDatePreset] = useState<DatePreset>(null);

  useEffect(() => {
    setLoading(true);
    const ctrl = new AbortController();
    const params: Record<string, string> = {};
    if (module) params.component = module;
    fetchLoreSlice<LoreAdrRow>('adrs', params, ctrl.signal)
      .then(r => { setRows(r); setLoading(false); })
      .catch(e => { onError(e); setLoading(false); });
    return () => ctrl.abort();
  }, [module, onError]);

  // Report counts per status key (uppercase) from the full list
  useEffect(() => {
    const c: Record<string, number> = {};
    rows.forEach(r => {
      const k = (r.status ?? 'PROPOSED').toUpperCase();
      c[k] = (c[k] || 0) + 1;
    });
    onCounts(c);
  }, [rows, onCounts]);

  const shown = useMemo(() => {
    const ql     = q.trim().toLowerCase();
    const cutoff = cutoffDate(datePreset);
    return rows
      .filter(r => statusSel.size === 0 || statusSel.has((r.status ?? 'PROPOSED').toUpperCase()))
      .filter(r => !cutoff || (r.date_created ?? '') >= cutoff)
      .filter(r => !ql || r.adr_id.toLowerCase().includes(ql) || (r.name ?? '').toLowerCase().includes(ql));
  }, [rows, q, [...statusSel].sort().join(','), datePreset]);

  return (
    <div style={S.root}>
      <button style={S.newBtn} onClick={onNew}>{t('lore.adrList.newButton', '+ Новый ADR')}</button>
      <div style={S.dateLine}>
        {DATE_PRESETS.map(p => (
          <button key={String(p.key)} style={S.dateBtn(datePreset === p.key)} onClick={() => setDatePreset(p.key)}>
            {t(p.labelKey, p.labelFallback)}
          </button>
        ))}
      </div>
      <div style={S.list}>
        {loading && <div style={S.empty}>{t('lore.adrList.loading', 'Загрузка ADR…')}</div>}
        {!loading && !shown.length && <div style={S.empty}>{t('lore.adrList.empty', 'ADR не найдены.')}</div>}
        {shown.map(a => {
          const statusKey   = (a.status ?? 'PROPOSED').toUpperCase();
          const statusColor = STATUS_COLOR[statusKey] ?? 'var(--t3)';
          return (
            <div
              key={a.adr_id}
              style={{
                ...S.row,
                background: selectedId === a.adr_id
                  ? 'color-mix(in srgb, var(--acc) 10%, transparent)' : 'transparent',
              }}
              onClick={() => onOpen(a.adr_id)}
            >
              <div style={S.line1}>
                <span style={S.statusDot(statusColor)} title={statusKey} />
                <span style={S.id}>{a.adr_id}</span>
                {a.name && <span style={S.name}>{a.name}</span>}
              </div>
              {(a.component || a.date_created || a.status) && (
                <div style={S.line2}>
                  {a.status && <span style={S.statusBadge(statusColor)}>{statusKey}</span>}
                  {a.component && <span style={S.component}>{a.component}</span>}
                  {a.date_created && <span style={S.date}>{a.date_created.slice(0, 10)}</span>}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
