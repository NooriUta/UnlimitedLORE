import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { a11yClick } from './a11y';
import { fetchLoreSlice, type LoreComponent } from '../../api/lore';
import { GameIcon } from './GameIcon';
import LoreSkeleton from './LoreSkeleton';

export const AREA_COLOR: Record<string, string> = {
  platform:      'var(--acc)',
  api:           'color-mix(in srgb,var(--acc) 55%,var(--inf))',
  marketing:     'color-mix(in srgb,var(--acc) 55%,var(--wrn))',
  ai:            'var(--inf)',
  frontend:      'color-mix(in srgb,var(--suc) 70%,var(--bg0))',
  db:            'color-mix(in srgb,var(--inf) 70%,var(--bg0))',
  algorithm:     'color-mix(in srgb,var(--acc) 60%,var(--dng))',
  data:          'var(--suc)',
  service:       'color-mix(in srgb,var(--suc) 55%,var(--wrn))',
  infra:         'var(--t2)',
  observability: 'var(--wrn)',
  engine:        'color-mix(in srgb,var(--wrn) 60%,var(--dng))',
  security:      'var(--dng)',
};

export const AREA_STYLE: Record<string, 'B'> = {
  api: 'B', frontend: 'B', algorithm: 'B', service: 'B', engine: 'B',
};

export const areaColor  = (a: string | null | undefined) => AREA_COLOR[a ?? ''] ?? 'var(--t3)';
export const areaInvert = (a: string | null | undefined) => !!(a && AREA_STYLE[a]);
export const compArea   = (r: { area?: string | null; team?: string | null }) => r.area || r.team || '';

const S = {
  root:  { flex: 1, display: 'flex', flexDirection: 'column' as const, overflow: 'hidden' },
  list:  { flex: 1, overflowY: 'auto' as const, padding: '4px 6px' },
  card: (sel: boolean, indent: number, accentColor: string) => ({
    display: 'flex', alignItems: 'center', gap: 7,
    padding: '5px 8px',
    marginBottom: 3,
    marginLeft: indent * 10,
    borderRadius: indent > 0 ? '0 6px 6px 0' : 6,
    background: sel ? 'color-mix(in srgb, var(--acc) 10%, transparent)' : 'var(--b2)',
    border: `1px solid ${sel ? 'color-mix(in srgb, var(--acc) 35%, transparent)' : 'var(--bd)'}`,
    borderLeft: indent > 0
      ? `2px solid color-mix(in srgb, ${accentColor} 45%, transparent)`
      : `1px solid ${sel ? 'color-mix(in srgb, var(--acc) 35%, transparent)' : 'var(--bd)'}`,
    cursor: 'pointer',
  }),
  iconBox: (color: string, invert = false) => ({
    width: 20, height: 20, borderRadius: 4, flexShrink: 0,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    color:      invert ? `color-mix(in srgb, ${color} 22%, var(--bg1))` : color,
    background: invert ? color : `color-mix(in srgb, ${color} 15%, transparent)`,
  }),
  compId: {
    fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--acc)',
    whiteSpace: 'nowrap' as const, fontWeight: 600,
  },
  compName: {
    fontSize: 9, color: 'var(--t3)',
    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const,
  },
  compBlock: {
    flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' as const,
  },
  countBadge: {
    fontSize: 8, padding: '1px 4px', borderRadius: 3, flexShrink: 0,
    color: 'var(--t3)', background: 'var(--b2)', border: '1px solid var(--bd)',
    whiteSpace: 'nowrap' as const, fontFamily: 'var(--mono)',
  },
  sprintBadge: {
    fontSize: 8, padding: '1px 4px', borderRadius: 3, flexShrink: 0,
    color: 'var(--acc)', background: 'color-mix(in srgb, var(--acc) 12%, transparent)',
    border: '1px solid color-mix(in srgb, var(--acc) 30%, transparent)',
    whiteSpace: 'nowrap' as const, fontFamily: 'var(--mono)',
  },
  empty: { padding: 24, color: 'var(--t3)', fontSize: 12 },
  sectionHdr: {
    padding: '8px 4px 3px', fontSize: 9, fontWeight: 700, letterSpacing: '0.07em',
    textTransform: 'uppercase' as const, color: 'var(--t3)', flexShrink: 0,
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
  const { t } = useTranslation();
  const [rows, setRows]         = useState<LoreComponent[]>([]);
  const [loading, setLoading]   = useState(true);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  function toggleArea(area: string) {
    setCollapsed(prev => { const n = new Set(prev); n.has(area) ? n.delete(area) : n.add(area); return n; });
  }

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
    const area   = compArea(r);
    const color  = areaColor(area);
    const invert = areaInvert(area);
    const name   = r.full_name && r.full_name !== r.component_id ? r.full_name : null;
    const sel    = selectedId === r.component_id;
    return (
      <div
        key={r.component_id}
        style={{ ...S.card(sel, indent, color), opacity: dimmed ? 0.4 : 1 }}
        {...(dimmed ? {} : a11yClick(() => onSelect(r.component_id)))}
      >
        <div style={S.iconBox(color, invert)}>
          {r.game_icon
            ? <GameIcon slug={r.game_icon} size={12} style={{ color: 'inherit' }} />
            : <span style={{ fontFamily: 'var(--mono)', fontSize: 9, fontWeight: 700 }}>{r.component_id[0]}</span>}
        </div>
        <div style={S.compBlock}>
          <span style={S.compId}>{r.component_id}</span>
          {name && <span style={S.compName}>{name}</span>}
        </div>
        {(r.sprint_count != null && r.sprint_count > 0) && (
          <span style={S.sprintBadge} title={t('lore.componentList.sprintCountTitle', 'Привязанных спринтов')}>{r.sprint_count}Sp</span>
        )}
        {(r.spec_count != null && r.spec_count > 0) && (
          <span style={S.countBadge}>{r.spec_count}S</span>
        )}
        {(r.qg_count != null && r.qg_count > 0) && (
          <span style={S.countBadge}>{r.qg_count}Q</span>
        )}
        {(r.adr_count != null && r.adr_count > 0) && (
          <span style={S.countBadge}>{r.adr_count}A</span>
        )}
      </div>
    );
  };

  // Render tree with collapsible section headers when the root-level area changes.
  function renderWithGroups(items: { comp: LoreComponent; indent: number; dimmed: boolean }[]) {
    const nodes: React.ReactNode[] = [];
    let curArea = '';
    items.forEach(({ comp, indent, dimmed }) => {
      const area = indent === 0 ? compArea(comp) : curArea;
      if (indent === 0 && compArea(comp) !== curArea) {
        curArea = compArea(comp);
        if (curArea) {
          const thisArea = curArea; // capture for closure — curArea is mutated each iteration
          const isCollapsed = collapsed.has(thisArea);
          nodes.push(
            <div key={`hdr-${thisArea}`}
              style={{ ...S.sectionHdr, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4, userSelect: 'none' }}
              {...a11yClick(() => toggleArea(thisArea))}
            >
              <span style={{ fontSize: 7, color: 'var(--t3)', lineHeight: 1 }}>{isCollapsed ? '▶' : '▼'}</span>
              {curArea}
            </div>
          );
        }
      }
      if (!area || !collapsed.has(area)) {
        nodes.push(renderRow(comp, indent, dimmed));
      }
    });
    return nodes;
  }

  return (
    <div style={S.root}>
      <div style={S.list}>
        {treeOrder !== null ? (
          treeOrder.length === 0
            ? <div style={S.empty}>{t('lore.componentList.empty', 'Компоненты не найдены.')}</div>
            : renderWithGroups(treeOrder)
        ) : (
          shown.length === 0
            ? <div style={S.empty}>{t('lore.componentList.empty', 'Компоненты не найдены.')}</div>
            : shown.map(r => renderRow(r, 0))
        )}
        <div style={{ height: 4 }} />
      </div>
    </div>
  );
}
