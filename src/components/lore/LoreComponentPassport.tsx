import { useEffect, useState } from 'react';
import { fetchLoreSlice, type LoreComponentDetail } from '../../api/lore';
import { GameIcon } from './GameIcon';
import { areaColor } from './LoreComponentList';

const S = {
  root:   { flex: 1, overflowY: 'auto' as const, padding: '16px 20px 40px' },
  header: { display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 },
  iconLg: (color: string) => ({
    width: 36, height: 36, borderRadius: 7, flexShrink: 0,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    color, background: `color-mix(in srgb, ${color} 15%, transparent)`,
  }),
  titleCol: { flex: 1, minWidth: 0 },
  compId:  { fontSize: 13, fontWeight: 700, color: 'var(--t1)', fontFamily: 'var(--mono)' },
  fullName:{ fontSize: 12, color: 'var(--t2)', marginTop: 2 },
  areaChip: (color: string) => ({
    padding: '3px 8px', borderRadius: 4, fontSize: 11, flexShrink: 0,
    color, background: `color-mix(in srgb, ${color} 14%, transparent)`,
    border: `1px solid color-mix(in srgb, ${color} 28%, transparent)`,
    whiteSpace: 'nowrap' as const,
  }),
  parentBtn: {
    padding: '3px 8px', borderRadius: 4, fontSize: 11, flexShrink: 0,
    background: 'transparent', color: 'var(--acc)',
    border: '1px solid color-mix(in srgb, var(--acc) 30%, transparent)',
    cursor: 'pointer', whiteSpace: 'nowrap' as const,
  },
  section: { marginTop: 16 },
  sLabel:  { fontSize: 10, color: 'var(--t3)', textTransform: 'uppercase' as const, letterSpacing: '0.05em', marginBottom: 6 },
  chips:   { display: 'flex', flexWrap: 'wrap' as const, gap: 5 },
  chip: {
    padding: '2px 7px', borderRadius: 3, fontSize: 11,
    background: 'var(--b2)', color: 'var(--t2)', border: '1px solid var(--b3)',
    whiteSpace: 'nowrap' as const,
  },
  childChip: (color: string) => ({
    padding: '2px 7px', borderRadius: 3, fontSize: 11, cursor: 'pointer',
    color, background: `color-mix(in srgb, ${color} 12%, transparent)`,
    border: `1px solid color-mix(in srgb, ${color} 28%, transparent)`,
    whiteSpace: 'nowrap' as const,
    fontFamily: 'var(--mono)',
  }),
  adrList: { display: 'flex', flexDirection: 'column' as const, gap: 2 },
  adrRow:  {
    display: 'flex', alignItems: 'center', gap: 8, padding: '4px 8px',
    borderRadius: 4, cursor: 'pointer', fontSize: 11,
    background: 'transparent',
  },
  adrId:   { fontFamily: 'var(--mono)', color: 'var(--acc)', fontSize: 11, flex: 1 },
  adrDate: { color: 'var(--t3)', fontSize: 10, fontFamily: 'var(--mono)', flexShrink: 0 },
  empty:   { padding: 24, color: 'var(--t3)', fontSize: 12 },
};

interface Props {
  componentId: string;
  onError: (e: unknown) => void;
  onNavigateAdr?: (id: string) => void;
  onNavigateComponent?: (id: string) => void;
  onOpenSpec?: (id: string) => void;
}

export default function LoreComponentPassport({ componentId, onError, onNavigateAdr, onNavigateComponent, onOpenSpec }: Props) {
  const [comp, setComp]       = useState<LoreComponentDetail | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    setComp(null);
    const ctrl = new AbortController();
    fetchLoreSlice<LoreComponentDetail>('component', { id: componentId }, ctrl.signal)
      .then(rows => { setComp(rows[0] ?? null); setLoading(false); })
      .catch(e => { onError(e); setLoading(false); });
    return () => ctrl.abort();
  }, [componentId, onError]);

  if (loading) return <div style={S.empty}>Загрузка {componentId}…</div>;
  if (!comp)   return <div style={S.empty}>Компонент не найден: {componentId}</div>;

  const color       = areaColor(comp.area);
  const subComps    = comp.sub_components ?? [];
  const tech        = comp.tech           ?? [];
  const adrs        = (comp.adrs ?? []).filter(Boolean) as string[];
  const specs       = [
    ...new Set([...(comp.specs ?? []), ...(comp.spec_docs ?? [])].filter(Boolean) as string[])
  ];

  return (
    <div style={S.root}>
      {/* Header */}
      <div style={S.header}>
        <div style={S.iconLg(color)}>
          {comp.game_icon
            ? <GameIcon slug={comp.game_icon} size={20} style={{ color: 'inherit' }} />
            : <span style={{ fontFamily: 'var(--mono)', fontSize: 14, fontWeight: 700 }}>{comp.component_id[0]}</span>}
        </div>
        <div style={S.titleCol}>
          <div style={S.compId}>{comp.component_id}</div>
          <div style={S.fullName}>{comp.full_name}</div>
        </div>
        <span style={S.areaChip(color)}>{comp.area}</span>
        {comp.parent_id && (
          <button style={S.parentBtn} onClick={() => onNavigateComponent?.(comp.parent_id!)}>
            ↑ {comp.parent_id}
          </button>
        )}
      </div>

      {/* Tech stack */}
      {tech.length > 0 && (
        <div style={S.section}>
          <div style={S.sLabel}>Стек технологий</div>
          <div style={S.chips}>
            {tech.map(t => <span key={t} style={S.chip}>{t}</span>)}
          </div>
        </div>
      )}

      {/* Sub-components */}
      {subComps.length > 0 && (
        <div style={S.section}>
          <div style={S.sLabel}>Подмодули ({subComps.length})</div>
          <div style={S.chips}>
            {subComps.map(c => (
              <span key={c} style={S.childChip(color)} onClick={() => onNavigateComponent?.(c)}>
                {c}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* ADRs */}
      {adrs.length > 0 && (
        <div style={S.section}>
          <div style={S.sLabel}>ADR ({adrs.length})</div>
          <div style={S.adrList}>
            {adrs.map(id => (
              <div
                key={id}
                style={{ ...S.adrRow, ...(onNavigateAdr ? { ':hover': { background: 'var(--b2)' } } : {}) }}
                onClick={() => onNavigateAdr?.(id)}
                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'var(--b2)'; }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
              >
                <span style={S.adrId}>{id}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Specs */}
      {specs.length > 0 && (
        <div style={S.section}>
          <div style={S.sLabel}>Спецификации ({specs.length})</div>
          <div style={S.adrList}>
            {specs.map(id => (
              <div
                key={id}
                style={{ ...S.adrRow, cursor: onOpenSpec ? 'pointer' : 'default' }}
                onClick={() => onOpenSpec?.(id)}
                onMouseEnter={e => { if (onOpenSpec) (e.currentTarget as HTMLElement).style.background = 'var(--b2)'; }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
              >
                <span style={{ ...S.adrId, color: 'var(--t2)' }}>{id}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {adrs.length === 0 && specs.length === 0 && tech.length === 0 && subComps.length === 0 && (
        <div style={{ ...S.empty, padding: '24px 0' }}>Нет связанных артефактов.</div>
      )}
    </div>
  );
}
