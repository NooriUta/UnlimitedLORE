import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { a11yClick } from './a11y';
import { fetchLoreSlice, type LoreAdrRow } from '../../api/lore';
import { GameIcon } from './GameIcon';
import { areaColor } from './LoreComponentList';

interface CompMeta { area: string | null; full_name: string | null; game_icon: string | null }

export type DatePreset = null | '3m' | '6m' | '1y';
export const DATE_PRESETS: { key: DatePreset; labelKey: string; labelFallback: string }[] = [
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
// ADR_STATUS_FILTERS.label carries the raw English fallback (used before this
// list is displayed, or when a caller has no i18n instance) — everywhere it's
// actually rendered, go through this so the shared adrStatus.* namespace wins.
export function adrStatusLabel(t: (key: string, fallback: string) => string, key: string): string {
  const f = ADR_STATUS_FILTERS.find(x => x.key === key);
  return t(`adrStatus.${key.toLowerCase()}`, f?.label ?? key);
}

// Sentinel tag-filter value: match ADRs that carry NO tags at all (otherwise
// untagged ADRs would silently vanish once any tag chip is active).
export const NO_TAG = '__notag__';
export function matchTags(tags: string[], sel: Set<string>): boolean {
  if (sel.size === 0) return true;
  if (sel.has(NO_TAG) && tags.length === 0) return true;
  return tags.some(t => sel.has(t));
}
// Mirror of NO_TAG for the component dimension: match ADRs with no component.
export const NO_COMPONENT = '__nocomp__';
export function matchComponents(components: string[], sel: Set<string>): boolean {
  if (sel.size === 0) return true;
  if (sel.has(NO_COMPONENT) && components.length === 0) return true;
  return components.some(c => sel.has(c));
}
// Client-side sort (data is small — ~130 ADRs; ArcadeDB can't bind ORDER BY,
// and compose() can't AND-join filters, so all list logic lives here).
export type AdrSortKey = 'date' | 'id' | 'status' | 'component';
export function sortAdrs<T extends { adr_id: string; date_created: string | null; status: string | null; component: string | null }>(
  rows: T[], key: AdrSortKey, dir: 'asc' | 'desc',
): T[] {
  const sign = dir === 'asc' ? 1 : -1;
  return [...rows].sort((a, b) => {
    switch (key) {
      case 'date':      return sign * (a.date_created ?? '').localeCompare(b.date_created ?? '');
      case 'status':    return sign * (a.status ?? '').localeCompare(b.status ?? '');
      case 'component': return sign * (a.component ?? '').localeCompare(b.component ?? '');
      default:          return sign * a.adr_id.localeCompare(b.adr_id, undefined, { numeric: true });
    }
  });
}

const S = {
  root:  { flex: 1, overflowY: 'auto' as const, overflowX: 'hidden' as const, display: 'flex', flexDirection: 'column' as const },
  newBtn: {
    display: 'flex', alignItems: 'center', gap: 5,
    padding: '5px 10px', margin: '6px 8px',
    background: 'color-mix(in srgb, var(--acc) 10%, transparent)',
    color: 'var(--acc)', border: '1px dashed color-mix(in srgb, var(--acc) 40%, transparent)',
    borderRadius: 5, cursor: 'pointer', fontSize: 'var(--fs-sm)', fontWeight: 600,
  },
  list: { flex: 1, overflowY: 'auto' as const },
  row: {
    display: 'flex', flexDirection: 'column' as const, gap: 2,
    padding: '6px 10px', borderBottom: '1px solid var(--bd)',
    fontSize: 'var(--fs-sm)', cursor: 'pointer', minWidth: 0,
  },
  line1: { display: 'flex', alignItems: 'center', gap: 5, minWidth: 0 },
  line2: { display: 'flex', alignItems: 'center', gap: 5 },
  id: {
    color: 'var(--acc)', fontFamily: 'var(--mono)',
    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const,
    minWidth: 0, flexShrink: 0,
  },
  name: {
    flex: 1, color: 'var(--t2)', fontSize: 'var(--fs-xs)',
    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const,
    minWidth: 0,
  },
  statusDot: (color: string) => ({
    width: 6, height: 6, borderRadius: '50%', flexShrink: 0,
    background: color,
  }),
  statusBadge: (color: string) => ({
    fontSize: 'var(--fs-2xs)', padding: '1px 4px', borderRadius: 2, flexShrink: 0,
    color, background: `color-mix(in srgb, ${color} 14%, transparent)`,
    border: `1px solid color-mix(in srgb, ${color} 28%, transparent)`,
    whiteSpace: 'nowrap' as const,
  }),
  component: {
    fontSize: 'var(--fs-2xs)', padding: '1px 4px', borderRadius: 2, flexShrink: 0,
    background: 'var(--b2)', color: 'var(--t3)',
  },
  compIcon: (color: string) => ({
    display: 'inline-flex', alignItems: 'center', padding: '1px 3px', borderRadius: 3, flexShrink: 0,
    background: `color-mix(in srgb, ${color} 14%, transparent)`,
    border: `1px solid color-mix(in srgb, ${color} 32%, transparent)`,
  }),
  decCount: {
    fontSize: 'var(--fs-2xs)', padding: '1px 5px', borderRadius: 999, flexShrink: 0, fontFamily: 'var(--mono)',
    color: 'var(--section-decisions, var(--acc))',
    background: 'color-mix(in srgb, var(--acc) 10%, transparent)',
    border: '1px solid color-mix(in srgb, var(--acc) 25%, transparent)',
  },
  date: { fontSize: 'var(--fs-2xs)', color: 'var(--t3)', fontFamily: 'var(--mono)', flexShrink: 0 },
  empty: { padding: 24, color: 'var(--t3)', fontSize: 'var(--fs-base)' },
};

interface Props {
  module: string;
  q: string;
  statusSel: Set<string>;
  compSel: Set<string>;
  tagSel: Set<string>;
  sortKey: AdrSortKey;
  sortDir: 'asc' | 'desc';
  datePreset: DatePreset;
  selectedId?: string;
  onError: (e: unknown) => void;
  onOpen: (id: string) => void;
  onNew: () => void;
  onCounts: (counts: Record<string, number>) => void;
  onCompCounts: (counts: Record<string, number>) => void;
  onTagCounts: (counts: Record<string, number>) => void;
}

export default function LoreAdrList({ module, q, statusSel, compSel, tagSel, sortKey, sortDir, datePreset, selectedId, onError, onOpen, onNew, onCounts, onCompCounts, onTagCounts }: Props) {
  const { t } = useTranslation();
  const [rows, setRows]             = useState<LoreAdrRow[]>([]);
  const [loading, setLoading]       = useState(true);
  const [comps, setComps]           = useState<Record<string, CompMeta>>({});

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

  // Component icon/colour map (game_icon + area) — same source LoreSprintDetail
  // uses to render tasks' component tags as icons.
  useEffect(() => {
    const ctrl = new AbortController();
    fetchLoreSlice<{ component_id: string } & CompMeta>('components', {}, ctrl.signal)
      .then(cs => { const m: Record<string, CompMeta> = {}; cs.forEach(c => { m[c.component_id] = c; }); setComps(m); })
      .catch(() => { /* icons degrade to id text */ });
    return () => ctrl.abort();
  }, []);

  // Report facet counts (status / component / tag) from the full list
  useEffect(() => {
    const c: Record<string, number> = {};
    const cc: Record<string, number> = {};
    const tc: Record<string, number> = {};
    rows.forEach(r => {
      const k = (r.status ?? 'PROPOSED').toUpperCase();
      c[k] = (c[k] || 0) + 1;
      const comps = r.components ?? [];
      if (comps.length === 0) cc[NO_COMPONENT] = (cc[NO_COMPONENT] || 0) + 1;
      else comps.forEach(x => { cc[x] = (cc[x] || 0) + 1; });
      const tags = r.tags ?? [];
      if (tags.length === 0) tc[NO_TAG] = (tc[NO_TAG] || 0) + 1;
      else tags.forEach(tg => { tc[tg] = (tc[tg] || 0) + 1; });
    });
    onCounts(c); onCompCounts(cc); onTagCounts(tc);
  }, [rows, onCounts, onCompCounts, onTagCounts]);

  const shown = useMemo(() => {
    const ql     = q.trim().toLowerCase();
    const cutoff = cutoffDate(datePreset);
    const filtered = rows
      .filter(r => statusSel.size === 0 || statusSel.has((r.status ?? 'PROPOSED').toUpperCase()))
      .filter(r => matchComponents(r.components ?? [], compSel))
      .filter(r => matchTags(r.tags ?? [], tagSel))
      .filter(r => !cutoff || (r.date_created ?? '') >= cutoff)
      .filter(r => !ql || r.adr_id.toLowerCase().includes(ql) || (r.name ?? '').toLowerCase().includes(ql));
    return sortAdrs(filtered, sortKey, sortDir);
  }, [rows, q, [...statusSel].sort().join(','), [...compSel].sort().join(','), [...tagSel].sort().join(','), datePreset, sortKey, sortDir]);

  return (
    <div style={S.root}>
      <button style={S.newBtn} onClick={onNew}>{t('lore.adrList.newButton', '+ Новый ADR')}</button>
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
              {...a11yClick(() => onOpen(a.adr_id))}
            >
              <div style={S.line1}>
                <span style={S.statusDot(statusColor)} title={statusKey} />
                <span style={S.id}>{a.adr_id}</span>
                {a.name && <span style={S.name}>{a.name}</span>}
              </div>
              {(a.component || a.date_created || a.status || a.decision_count) && (
                <div style={S.line2}>
                  {a.status && <span style={S.statusBadge(statusColor)}>{adrStatusLabel(t, statusKey)}</span>}
                  {(a.components?.length ? a.components : (a.component ? [a.component] : [])).map(cid => {
                    const c = comps[cid];
                    const color = areaColor(c?.area ?? '');
                    return (
                      <span key={cid} title={c?.full_name ?? cid} style={S.compIcon(color)}>
                        <GameIcon slug={c?.game_icon ?? 'cog'} size={11} style={{ color }} />
                      </span>
                    );
                  })}
                  {!!a.decision_count && (
                    <span style={S.decCount} title={t('lore.adrList.decisionCount', 'решений: {{n}}', { n: a.decision_count })}>
                      DES {a.decision_count}
                    </span>
                  )}
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
