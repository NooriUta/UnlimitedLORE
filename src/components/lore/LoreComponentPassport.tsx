import { useEffect, useState } from 'react';
import {
  fetchLoreSlice,
  updateLoreComponent,
  type LoreComponentDetail,
  type LoreAdrRow,
} from '../../api/lore';
import { GameIcon } from './GameIcon';
import { statusMeta } from './lore-status';
import { normalizeStatus } from './loreUtils';
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
  editBtn: {
    padding: '3px 8px', borderRadius: 4, fontSize: 11, flexShrink: 0,
    background: 'transparent', color: 'var(--t3)',
    border: '1px solid var(--bd)', cursor: 'pointer', whiteSpace: 'nowrap' as const,
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
  adrId:   { fontFamily: 'var(--mono)', color: 'var(--acc)', fontSize: 11, flexShrink: 0, width: 80 },
  adrName: { flex: 1, color: 'var(--t1)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const, minWidth: 0 },
  adrDate: { color: 'var(--t3)', fontSize: 10, fontFamily: 'var(--mono)', flexShrink: 0 },
  adrStatus: (color: string) => ({ color, fontSize: 10, flexShrink: 0 }),
  empty:   { padding: 24, color: 'var(--t3)', fontSize: 12 },
  // Edit panel
  editPanel: {
    marginTop: 16, padding: '12px 14px', borderRadius: 6,
    background: 'var(--b2)', border: '1px solid var(--bd)',
  },
  editRow:  { display: 'flex', gap: 8, marginBottom: 8, alignItems: 'center' },
  editLabel:{ fontSize: 10, color: 'var(--t3)', width: 72, flexShrink: 0, textTransform: 'uppercase' as const },
  editInput: {
    flex: 1, padding: '3px 7px', borderRadius: 4, fontSize: 11,
    background: 'var(--b1)', border: '1px solid var(--bd)', color: 'var(--t1)',
  },
  editActions: { display: 'flex', gap: 8, marginTop: 8, justifyContent: 'flex-end' as const },
  saveBtn: {
    padding: '4px 12px', borderRadius: 4, fontSize: 11, cursor: 'pointer',
    background: 'var(--acc)', color: '#fff', border: 'none',
  },
  cancelBtn: {
    padding: '4px 12px', borderRadius: 4, fontSize: 11, cursor: 'pointer',
    background: 'transparent', color: 'var(--t3)', border: '1px solid var(--bd)',
  },
};

interface Props {
  componentId: string;
  onError: (e: unknown) => void;
  onNavigateAdr?: (id: string) => void;
  onNavigateComponent?: (id: string) => void;
  onOpenSpec?: (id: string) => void;
}

export default function LoreComponentPassport({ componentId, onError, onNavigateAdr, onNavigateComponent, onOpenSpec }: Props) {
  const [comp, setComp]         = useState<LoreComponentDetail | null>(null);
  const [adrs, setAdrs]         = useState<LoreAdrRow[]>([]);
  const [loading, setLoading]   = useState(true);
  const [editing, setEditing]   = useState(false);
  const [saving, setSaving]     = useState(false);
  const [editOwner, setEditOwner]     = useState('');
  const [editTeam, setEditTeam]       = useState('');
  const [editIcon, setEditIcon]       = useState('');
  const [editFullName, setEditFullName] = useState('');

  useEffect(() => {
    setLoading(true);
    setComp(null);
    setAdrs([]);
    setEditing(false);
    const ctrl = new AbortController();
    Promise.all([
      fetchLoreSlice<LoreComponentDetail>('component', { id: componentId }, ctrl.signal),
      fetchLoreSlice<LoreAdrRow>('adrs', { component: componentId }, ctrl.signal),
    ])
      .then(([compRows, adrRows]) => {
        const c = compRows[0] ?? null;
        setComp(c);
        setAdrs(adrRows);
        setEditOwner(c?.owner ?? '');
        setEditTeam(c?.team ?? '');
        setEditIcon(c?.game_icon ?? '');
        setEditFullName(c?.full_name ?? '');
        setLoading(false);
      })
      .catch(e => { onError(e); setLoading(false); });
    return () => ctrl.abort();
  }, [componentId, onError]);

  const handleSave = async () => {
    if (!comp) return;
    setSaving(true);
    try {
      await updateLoreComponent({
        component_id: comp.component_id,
        owner: editOwner || null,
        team: editTeam || null,
        game_icon: editIcon || null,
        full_name: editFullName || null,
      });
      setComp(prev => prev ? { ...prev, owner: editOwner, team: editTeam, game_icon: editIcon, full_name: editFullName } : prev);
      setEditing(false);
    } catch (e) {
      onError(e);
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div style={S.empty}>Загрузка {componentId}…</div>;
  if (!comp)   return <div style={S.empty}>Компонент не найден: {componentId}</div>;

  const color    = areaColor(comp.area);
  const subComps = comp.sub_components ?? [];
  const tech     = comp.tech           ?? [];
  const specs    = [...new Set([...(comp.specs ?? []), ...(comp.spec_docs ?? [])].filter(Boolean) as string[])];

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
        <button style={S.editBtn} onClick={() => setEditing(e => !e)}>✎</button>
      </div>

      {/* Edit panel */}
      {editing && (
        <div style={S.editPanel}>
          <div style={S.editRow}>
            <span style={S.editLabel}>Название</span>
            <input style={S.editInput} value={editFullName} onChange={e => setEditFullName(e.target.value)} placeholder="Full name" />
          </div>
          <div style={S.editRow}>
            <span style={S.editLabel}>Owner</span>
            <input style={S.editInput} value={editOwner} onChange={e => setEditOwner(e.target.value)} placeholder="owner" />
          </div>
          <div style={S.editRow}>
            <span style={S.editLabel}>Team</span>
            <input style={S.editInput} value={editTeam} onChange={e => setEditTeam(e.target.value)} placeholder="team" />
          </div>
          <div style={S.editRow}>
            <span style={S.editLabel}>Icon</span>
            <input style={S.editInput} value={editIcon} onChange={e => setEditIcon(e.target.value)} placeholder="game-icon slug" />
          </div>
          <div style={S.editActions}>
            <button style={S.cancelBtn} onClick={() => setEditing(false)}>Отмена</button>
            <button style={S.saveBtn} disabled={saving} onClick={handleSave}>{saving ? '…' : 'Сохранить'}</button>
          </div>
        </div>
      )}

      {/* Owner/team */}
      {(comp.owner || comp.team) && (
        <div style={S.section}>
          <div style={S.sLabel}>Команда</div>
          <div style={S.chips}>
            {comp.owner && <span style={S.chip}>👤 {comp.owner}</span>}
            {comp.team  && <span style={S.chip}>🏷 {comp.team}</span>}
          </div>
        </div>
      )}

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

      {/* ADRs — rich rows with name + status + date */}
      {adrs.length > 0 && (
        <div style={S.section}>
          <div style={S.sLabel}>ADR ({adrs.length})</div>
          <div style={S.adrList}>
            {adrs.map(adr => {
              const norm = normalizeStatus(adr.status);
              const meta = statusMeta(norm);
              return (
                <div
                  key={adr.adr_id}
                  style={S.adrRow}
                  onClick={() => onNavigateAdr?.(adr.adr_id)}
                  onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'var(--b2)'; }}
                  onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
                >
                  <span style={S.adrId}>{adr.adr_id}</span>
                  <span style={S.adrName}>{adr.name ?? adr.adr_id}</span>
                  {adr.status && (
                    <span style={S.adrStatus(meta.color)}>
                      <GameIcon slug={meta.icon} size={10} style={{ color: meta.color }} />
                      {' '}{adr.status}
                    </span>
                  )}
                  <span style={S.adrDate}>{adr.date_created?.slice(0, 10) ?? ''}</span>
                </div>
              );
            })}
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
                <span style={{ ...S.adrId, color: 'var(--t2)', width: 'auto' }}>{id}</span>
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
