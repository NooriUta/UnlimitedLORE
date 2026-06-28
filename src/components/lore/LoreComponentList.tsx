import { useEffect, useMemo, useState } from 'react';
import { fetchLoreSlice, type LoreComponent } from '../../api/lore';
import { GameIcon } from './GameIcon';
import LoreSkeleton from './LoreSkeleton';

export const AREA_COLOR: Record<string, string> = {
  engine:        '#e8923a',
  frontend:      '#4a90d9',
  api:           '#a974d6',
  data:          '#3fb8a0',
  platform:      '#6b91c1',
  algorithm:     '#e07a5f',
  security:      '#E24B4A',
  observability: '#ef9f27',
  infra:         '#7c7c7c',
  service:       '#4caf50',
  ai:            '#9b59b6',
};

export const areaColor = (a: string) => AREA_COLOR[a] ?? 'var(--t3)';

const S = {
  root:  { flex: 1, display: 'flex', flexDirection: 'column' as const, overflow: 'hidden' },
  list:  { flex: 1, overflowY: 'auto' as const },
  row: (sel: boolean, indent = 0) => ({
    display: 'flex', alignItems: 'center', gap: 8,
    padding: `6px 12px 6px ${12 + indent * 16}px`,
    borderBottom: '1px solid var(--bd)', cursor: 'pointer',
    background: sel ? 'color-mix(in srgb, var(--acc) 10%, transparent)' : 'transparent',
  }),
  iconBox: (color: string) => ({
    width: 22, height: 22, borderRadius: 4, flexShrink: 0,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    color, background: `color-mix(in srgb, ${color} 15%, transparent)`,
  }),
  compId: {
    fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--acc)',
    flexShrink: 0, width: 90, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const,
  },
  name: {
    flex: 1, fontSize: 11, color: 'var(--t1)',
    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const, minWidth: 0,
  },
  areaChip: (color: string) => ({
    fontSize: 9, padding: '1px 5px', borderRadius: 3, flexShrink: 0,
    color, background: `color-mix(in srgb, ${color} 14%, transparent)`,
    border: `1px solid color-mix(in srgb, ${color} 28%, transparent)`,
    whiteSpace: 'nowrap' as const,
  }),
  empty: { padding: 24, color: 'var(--t3)', fontSize: 12 },
};

interface Props {
  q: string;
  areaSel: Set<string>;
  selectedId?: string;
  onSelect: (id: string) => void;
  onCounts: (counts: Record<string, number>) => void;
  onError: (e: unknown) => void;
}

export default function LoreComponentList({ q, areaSel, selectedId, onSelect, onCounts, onError }: Props) {
  const [rows, setRows]       = useState<LoreComponent[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const ctrl = new AbortController();
    fetchLoreSlice<LoreComponent>('components', undefined, ctrl.signal)
      .then(r => { setRows(r); setLoading(false); })
      .catch(e => { onError(e); setLoading(false); });
    return () => ctrl.abort();
  }, [onError]);

  useEffect(() => {
    const c: Record<string, number> = {};
    rows.forEach(r => { c[r.area] = (c[r.area] || 0) + 1; });
    onCounts(c);
  }, [rows, onCounts]);

  const isFiltered = q.trim() !== '' || areaSel.size > 0;

  const shown = useMemo(() => {
    const ql = q.trim().toLowerCase();
    return rows
      .filter(r => areaSel.size === 0 || areaSel.has(r.area))
      .filter(r => !ql || r.component_id.toLowerCase().includes(ql) || (r.full_name ?? '').toLowerCase().includes(ql))
      .sort((a, b) =>
        a.area !== b.area ? a.area.localeCompare(b.area) : a.component_id.localeCompare(b.component_id)
      );
  }, [rows, q, areaSel]);

  const treeOrder = useMemo(() => {
    if (isFiltered) return null;
    const byParent = new Map<string | null, LoreComponent[]>();
    rows.forEach(r => {
      const key = r.parent_id ?? null;
      if (!byParent.has(key)) byParent.set(key, []);
      byParent.get(key)!.push(r);
    });
    byParent.forEach(arr => arr.sort((a, b) =>
      a.area !== b.area ? a.area.localeCompare(b.area) : a.component_id.localeCompare(b.component_id)
    ));
    const result: { comp: LoreComponent; indent: number }[] = [];
    function walk(parentId: string | null, depth: number) {
      (byParent.get(parentId) ?? []).forEach(c => {
        result.push({ comp: c, indent: depth });
        walk(c.component_id, depth + 1);
      });
    }
    walk(null, 0);
    return result;
  }, [rows, isFiltered]);

  if (loading) return <LoreSkeleton />;

  const renderRow = (r: LoreComponent, indent = 0) => {
    const color = areaColor(r.area);
    return (
      <div
        key={r.component_id}
        style={S.row(selectedId === r.component_id, indent)}
        onClick={() => onSelect(r.component_id)}
      >
        <div style={S.iconBox(color)}>
          {r.game_icon
            ? <GameIcon slug={r.game_icon} size={13} style={{ color: 'inherit' }} />
            : <span style={{ fontFamily: 'var(--mono)', fontSize: 10 }}>{r.component_id[0]}</span>}
        </div>
        <span style={S.compId}>{r.component_id}</span>
        <span style={S.name}>{r.full_name || r.component_id}</span>
        <span style={S.areaChip(color)}>{r.area}</span>
      </div>
    );
  };

  return (
    <div style={S.root}>
      <div style={S.list}>
        {treeOrder !== null ? (
          treeOrder.length === 0
            ? <div style={S.empty}>Компоненты не найдены.</div>
            : treeOrder.map(({ comp, indent }) => renderRow(comp, indent))
        ) : (
          shown.length === 0
            ? <div style={S.empty}>Компоненты не найдены.</div>
            : shown.map(r => renderRow(r, 0))
        )}
      </div>
    </div>
  );
}
