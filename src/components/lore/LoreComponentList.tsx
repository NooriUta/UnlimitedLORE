import React, { useEffect, useMemo, useState } from 'react';
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

export const areaColor = (a: string | null | undefined) => AREA_COLOR[a ?? ''] ?? 'var(--t3)';
export const compArea  = (r: { area?: string | null; team?: string | null }) => r.area || r.team || '';

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
    whiteSpace: 'nowrap' as const,
  },
  compName: {
    fontSize: 10, color: 'var(--t3)',
    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const,
  },
  compBlock: {
    flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' as const,
  },
  areaChip: (color: string) => ({
    fontSize: 9, padding: '1px 5px', borderRadius: 3, flexShrink: 0,
    color, background: `color-mix(in srgb, ${color} 14%, transparent)`,
    border: `1px solid color-mix(in srgb, ${color} 28%, transparent)`,
    whiteSpace: 'nowrap' as const,
  }),
  countBadge: {
    fontSize: 9, padding: '1px 5px', borderRadius: 3, flexShrink: 0,
    color: 'var(--t3)', background: 'var(--b2)', border: '1px solid var(--bd)',
    whiteSpace: 'nowrap' as const, fontFamily: 'var(--mono)',
  },
  empty: { padding: 24, color: 'var(--t3)', fontSize: 12 },
  sectionHdr: {
    padding: '3px 12px', fontSize: 9, fontWeight: 700, letterSpacing: '0.07em',
    textTransform: 'uppercase' as const, color: 'var(--t3)',
    background: 'color-mix(in srgb, var(--b2) 60%, transparent)',
    borderBottom: '1px solid var(--bd)', flexShrink: 0,
  },
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
    rows.forEach(r => { const a = compArea(r); if (a) c[a] = (c[a] || 0) + 1; });
    onCounts(c);
  }, [rows, onCounts]);

  const isFiltered = q.trim() !== '' || areaSel.size > 0;

  const shown = useMemo(() => {
    const ql = q.trim().toLowerCase();
    return rows
      .filter(r => areaSel.size === 0 || areaSel.has(compArea(r)))
      .filter(r => !ql || r.component_id.toLowerCase().includes(ql) || (r.full_name ?? '').toLowerCase().includes(ql))
      .sort((a, b) => {
        const aa = compArea(a), ab = compArea(b);
        return aa !== ab ? aa.localeCompare(ab) : a.component_id.localeCompare(b.component_id);
      });
  }, [rows, q, areaSel]);

  const treeOrder = useMemo(() => {
    const byId = new Map(rows.map(r => [r.component_id, r]));
    // Derive parent from children[] arrays (parent_id is null for all components in DB)
    const parentOf = new Map<string, string>();
    rows.forEach(r => r.children?.forEach(c => parentOf.set(c, r.component_id)));

    function buildTree(include: Set<string>, matchSet?: Set<string>) {
      const byParent = new Map<string | null, LoreComponent[]>();
      rows.filter(r => include.has(r.component_id)).forEach(r => {
        const p = parentOf.get(r.component_id);
        const key = p && include.has(p) ? p : null;
        if (!byParent.has(key)) byParent.set(key, []);
        byParent.get(key)!.push(r);
      });
      byParent.forEach(arr => arr.sort((a, b) => {
        const aa = compArea(a), ab = compArea(b);
        return aa !== ab ? aa.localeCompare(ab) : a.component_id.localeCompare(b.component_id);
      }));
      const result: { comp: LoreComponent; indent: number; dimmed: boolean }[] = [];
      function walk(parentId: string | null, depth: number) {
        (byParent.get(parentId) ?? []).forEach(c => {
          result.push({ comp: c, indent: depth, dimmed: matchSet ? !matchSet.has(c.component_id) : false });
          walk(c.component_id, depth + 1);
        });
      }
      walk(null, 0);
      return result;
    }

    if (isFiltered) {
      const matchSet = new Set(shown.map(r => r.component_id));
      if (matchSet.size === 0) return null;
      // collect ancestors of every match
      const ancestorSet = new Set<string>();
      matchSet.forEach(id => {
        let cur = byId.get(id);
        while (cur?.parent_id) { ancestorSet.add(cur.parent_id); cur = byId.get(cur.parent_id); }
      });
      return buildTree(new Set([...matchSet, ...ancestorSet]), matchSet);
    }

    return buildTree(new Set(rows.map(r => r.component_id)));
  }, [rows, isFiltered, shown]);

  if (loading) return <LoreSkeleton />;

  const renderRow = (r: LoreComponent, indent = 0, dimmed = false) => {
    const color = areaColor(compArea(r));
    const name  = r.full_name && r.full_name !== r.component_id ? r.full_name : null;
    return (
      <div
        key={r.component_id}
        style={{ ...S.row(selectedId === r.component_id, indent), opacity: dimmed ? 0.4 : 1 }}
        onClick={() => !dimmed && onSelect(r.component_id)}
      >
        <div style={S.iconBox(color)}>
          {r.game_icon
            ? <GameIcon slug={r.game_icon} size={13} style={{ color: 'inherit' }} />
            : <span style={{ fontFamily: 'var(--mono)', fontSize: 10 }}>{r.component_id[0]}</span>}
        </div>
        <div style={S.compBlock}>
          <span style={S.compId}>{r.component_id}</span>
          {name && <span style={S.compName}>{name}</span>}
        </div>
        {(r.spec_count != null && r.spec_count > 0) && (
          <span style={S.countBadge}>{r.spec_count} Spec</span>
        )}
        {(r.qg_count != null && r.qg_count > 0) && (
          <span style={S.countBadge}>{r.qg_count} QG</span>
        )}
        {(r.adr_count != null && r.adr_count > 0) && (
          <span style={S.countBadge}>{r.adr_count} ADR</span>
        )}
      </div>
    );
  };

  // Render tree with section headers when the root-level area changes.
  function renderWithGroups(items: { comp: LoreComponent; indent: number; dimmed: boolean }[]) {
    const nodes: React.ReactNode[] = [];
    let lastArea = '';
    items.forEach(({ comp, indent, dimmed }) => {
      const area = indent === 0 ? compArea(comp) : '';
      if (indent === 0 && area !== lastArea) {
        lastArea = area;
        if (area) nodes.push(<div key={`hdr-${area}`} style={S.sectionHdr}>{area}</div>);
      }
      nodes.push(renderRow(comp, indent, dimmed));
    });
    return nodes;
  }

  return (
    <div style={S.root}>
      <div style={S.list}>
        {treeOrder !== null ? (
          treeOrder.length === 0
            ? <div style={S.empty}>Компоненты не найдены.</div>
            : renderWithGroups(treeOrder)
        ) : (
          shown.length === 0
            ? <div style={S.empty}>Компоненты не найдены.</div>
            : shown.map(r => renderRow(r, 0))
        )}
      </div>
    </div>
  );
}
