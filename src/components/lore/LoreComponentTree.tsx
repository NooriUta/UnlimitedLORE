import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { fetchLoreSlice, type LoreComponent, type LoreSpecRow } from '../../api/lore';
import { GameIcon } from './GameIcon';
import { specTitle } from './LoreSpecView';
// T16: this file used to carry its own hex-hardcoded area palette, independent
// of (and inconsistent with) LoreComponentList's token-based one — same area
// name, two different colors depending which surface you were looking at.
// Reuse the one source of truth instead.
import { areaColor } from './LoreComponentList';

const S = {
  root:  { flex: 1, overflowY: 'auto' as const, padding: '4px 0' },
  row: (indent: number, clickable: boolean, selected: boolean) => ({
    display: 'flex', alignItems: 'center', gap: 6,
    padding: '5px 10px', paddingLeft: 6 + indent * 14,
    fontSize: 12, lineHeight: 1.3,
    cursor: clickable ? 'pointer' : 'default',
    background: selected ? 'color-mix(in srgb, var(--acc) 14%, transparent)' : 'transparent',
    borderLeft: `2px solid ${selected ? 'var(--acc)' : 'transparent'}`,
    transition: 'background 0.1s',
  }),
  chevron: (open: boolean) => ({
    flexShrink: 0, width: 12, textAlign: 'center' as const, fontSize: 9,
    color: 'var(--t3)', cursor: 'pointer', userSelect: 'none' as const,
    transform: open ? 'rotate(90deg)' : 'none', transition: 'transform 0.1s',
  }),
  chevronSpacer: { flexShrink: 0, width: 12 },
  icon: { flexShrink: 0, width: 16, display: 'flex', alignItems: 'center' as const, justifyContent: 'center' as const },
  name: {
    flex: 1, minWidth: 0, color: 'var(--t1)',
    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const,
  },
  specName: {
    flex: 1, minWidth: 0, color: 'var(--t2)',
    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const,
  },
  count: { color: 'var(--t3)', fontSize: 9, flexShrink: 0 },
  area: (a: string) => {
    const c = areaColor(a);
    return {
      fontSize: 9, padding: '1px 5px', borderRadius: 3, flexShrink: 0, whiteSpace: 'nowrap' as const,
      color: c, background: `color-mix(in srgb, ${c} 14%, transparent)`,
    };
  },
  empty:   { padding: 24, color: 'var(--t3)', fontSize: 12 },
};

interface Props {
  onError:        (e: unknown) => void;
  selectedId?:    string;
  selectedSpec?:  string;
  onSelect?:      (componentId: string) => void;
  onSelectSpec?:  (specId: string, componentId: string | null) => void;
}

export default function LoreComponentTree({ onError, selectedId, selectedSpec, onSelect, onSelectSpec }: Props) {
  const { t } = useTranslation();
  const [rows, setRows]   = useState<LoreComponent[]>([]);
  const [specs, setSpecs] = useState<LoreSpecRow[]>([]);
  const [open, setOpen]   = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    const ctrl = new AbortController();
    Promise.all([
      fetchLoreSlice<LoreComponent>('components', undefined, ctrl.signal),
      fetchLoreSlice<LoreSpecRow>('specs', undefined, ctrl.signal),
    ])
      .then(([cs, sp]) => { setRows(cs); setSpecs(sp); setLoading(false); })
      .catch(e => { onError(e); setLoading(false); });
    return () => ctrl.abort();
  }, [onError]);

  // selecting a component reveals its specs inline
  useEffect(() => {
    if (selectedId) setOpen(p => (p.has(selectedId) ? p : new Set(p).add(selectedId)));
  }, [selectedId]);

  if (loading) return <div style={S.empty}>{t('lore.componentTree.loading', 'Загрузка компонентов…')}</div>;
  if (!rows.length) return <div style={S.empty}>{t('lore.componentTree.empty', 'Компоненты не найдены.')}</div>;

  const byParent: Record<string, LoreComponent[]> = {};
  rows.forEach(c => {
    if (c.parent_id) byParent[c.parent_id] = [...(byParent[c.parent_id] ?? []), c];
  });
  const specsByComp: Record<string, LoreSpecRow[]> = {};
  specs.forEach(s => {
    if (s.component_id) specsByComp[s.component_id] = [...(specsByComp[s.component_id] ?? []), s];
  });

  const toggle = (id: string) => setOpen(p => {
    const n = new Set(p);
    if (n.has(id)) n.delete(id); else n.add(id);
    return n;
  });

  function renderNode(c: LoreComponent, indent: number): React.ReactNode {
    const children   = byParent[c.component_id] ?? [];
    const compSpecs  = specsByComp[c.component_id] ?? [];
    const clickable  = !!onSelect;
    const isSelected = selectedId === c.component_id;
    const isOpen     = open.has(c.component_id);
    return (
      <div key={c.component_id}>
        <div
          style={S.row(indent, clickable, isSelected)}
          onClick={() => onSelect?.(c.component_id)}
          title={`${c.component_id} · ${c.full_name}`}
          onMouseEnter={e => { if (clickable && !isSelected) (e.currentTarget as HTMLDivElement).style.background = 'color-mix(in srgb, var(--acc) 8%, transparent)'; }}
          onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.background = isSelected ? 'color-mix(in srgb, var(--acc) 14%, transparent)' : 'transparent'; }}
        >
          {compSpecs.length > 0
            ? <span style={S.chevron(isOpen)} onClick={e => { e.stopPropagation(); toggle(c.component_id); }}>▶</span>
            : <span style={S.chevronSpacer} />}
          <span style={S.icon}><GameIcon slug={c.game_icon} size={14} /></span>
          <span style={S.name}>{c.full_name || c.component_id}</span>
          {compSpecs.length > 0 && <span style={S.count}>{compSpecs.length}</span>}
          <span style={S.area(c.area)}>{c.area}</span>
        </div>

        {isOpen && compSpecs.map(s => {
          const specSel = selectedSpec === s.spec_id;
          return (
            <div
              key={s.spec_id}
              style={S.row(indent + 1, !!onSelectSpec, specSel)}
              onClick={() => onSelectSpec?.(s.spec_id, s.component_id)}
              title={s.spec_id}
              onMouseEnter={e => { if (onSelectSpec && !specSel) (e.currentTarget as HTMLDivElement).style.background = 'color-mix(in srgb, var(--acc) 8%, transparent)'; }}
              onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.background = specSel ? 'color-mix(in srgb, var(--acc) 14%, transparent)' : 'transparent'; }}
            >
              <span style={S.chevronSpacer} />
              <span style={S.icon}><GameIcon slug="white-book" size={12} /></span>
              <span style={S.specName}>{specTitle(s)}</span>
            </div>
          );
        })}

        {children.map(child => renderNode(child, indent + 1))}
      </div>
    );
  }

  const roots = rows.filter(c => !c.parent_id);
  return (
    <div style={S.root}>
      {roots.map(c => renderNode(c, 0))}
    </div>
  );
}
