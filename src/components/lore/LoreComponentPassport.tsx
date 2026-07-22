import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { a11yClick } from './a11y';
import {
  fetchLoreSlice,
  updateLoreComponent,
  type LoreComponent,
  type LoreComponentDetail,
  type LoreAdrRow,
  type LoreAdrPassport,
  type LoreSpecRow,
  type LoreSpecPassport,
  type LoreSprintRow,
  type LoreSprintTask,
  type LoreKnowDocRow,
  type LoreKnowDoc,
} from '../../api/lore';
import { GameIcon } from './GameIcon';
import { statusMeta, taskTick } from './lore-status';
import { areaColor, compArea } from './LoreComponentList';
import { MartProse } from '../bench/MartProse';

interface QGRow {
  qg_id: string;
  name: string;
  description: string | null;
  component_id: string | null;
  status: string | null;
  date_created: string | null;
  content_md?: string | null;
}

interface QGPassport extends QGRow {
  content_md: string | null;
}

interface ComponentSprintRow {
  sprint_id: string;
  name: string | null;
  status_raw: string | null;
  release_ids: string[] | null;
}

type DocTab = 'adr' | 'spec' | 'qg' | 'doc' | 'sprint';

type DocContent =
  | { type: 'spec';   data: LoreSpecPassport }
  | { type: 'qg';    data: QGPassport }
  | { type: 'adr';   data: LoreAdrPassport }
  | { type: 'doc';   data: LoreKnowDoc }
  | { type: 'sprint'; data: LoreSprintRow; tasks: LoreSprintTask[] };

// QG status labels/colors (mirrors LoreQualityGateList)
type TFn = ReturnType<typeof useTranslation>['t'];

function qgStatusMeta(t: TFn, status: string): { color: string; label: string } {
  const map: Record<string, { color: string; key: string; fallback: string }> = {
    active:     { color: 'var(--suc)', key: 'lore.componentPassport.qgStatus.active',     fallback: 'активен'  },
    draft:      { color: 'var(--wrn)', key: 'lore.componentPassport.qgStatus.draft',      fallback: 'черновик' },
    archived:   { color: 'var(--t3)',  key: 'lore.componentPassport.qgStatus.archived',   fallback: 'архив'    },
    deprecated: { color: 'var(--dng)', key: 'lore.componentPassport.qgStatus.deprecated', fallback: 'устарел'  },
  };
  const m = map[status];
  if (!m) return { color: 'var(--t3)', label: status };
  return { color: m.color, label: t(m.key, m.fallback) };
}

// ── Styles ────────────────────────────────────────────────────────────────────
const S = {
  root: {
    flex: 1, display: 'flex', flexDirection: 'column' as const, overflow: 'hidden',
  },

  // ── TOP: passport + tabs + list ──────────────────────────────────────────
  top: {
    flexShrink: 0, borderBottom: '2px solid var(--bd)',
    display: 'flex', flexDirection: 'column' as const,
    background: 'color-mix(in srgb, var(--b1) 60%, transparent)',
  },
  hdr: {
    display: 'flex', alignItems: 'center', gap: 8,
    padding: '10px 14px 0',
  },
  iconLg: (color: string) => ({
    width: 28, height: 28, borderRadius: 6, flexShrink: 0,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    color, background: `color-mix(in srgb, ${color} 15%, transparent)`,
  }),
  compId:   { fontSize: 'var(--fs-lg)', fontWeight: 700, color: 'var(--t1)', fontFamily: 'var(--mono)' },
  fullName: { fontSize: 'var(--fs-sm)', color: 'var(--t2)', marginTop: 1 },
  titleCol: { flex: 1, minWidth: 0 },
  parentBtn: {
    padding: '2px 7px', borderRadius: 4, fontSize: 'var(--fs-xs)', flexShrink: 0,
    background: 'transparent', color: 'var(--acc)',
    border: '1px solid color-mix(in srgb, var(--acc) 30%, transparent)',
    cursor: 'pointer', whiteSpace: 'nowrap' as const, display: 'flex', alignItems: 'center', gap: 3,
  },
  editBtn: {
    padding: '2px 7px', borderRadius: 4, fontSize: 'var(--fs-xs)', flexShrink: 0,
    background: 'transparent', color: 'var(--t3)',
    border: '1px solid var(--bd)', cursor: 'pointer',
  },

  meta: {
    display: 'flex', gap: 6, padding: '6px 14px', flexWrap: 'wrap' as const,
    alignItems: 'center',
  },
  metaChip: (color?: string) => ({
    display: 'flex', alignItems: 'center', gap: 4,
    padding: '1px 7px', borderRadius: 3, fontSize: 'var(--fs-xs)',
    background: color
      ? `color-mix(in srgb, ${color} 12%, transparent)`
      : 'var(--b2)',
    color: color ?? 'var(--t2)',
    border: `1px solid ${color
      ? `color-mix(in srgb, ${color} 28%, transparent)`
      : 'var(--bd)'}`,
    whiteSpace: 'nowrap' as const,
  }),
  techChip: {
    fontFamily: 'var(--mono)', fontSize: 'var(--fs-2xs)',
    padding: '1px 6px', borderRadius: 3,
    background: 'var(--b2)', color: 'var(--t2)', border: '1px solid var(--bd)',
    whiteSpace: 'nowrap' as const,
  },
  childChip: (color: string) => ({
    fontFamily: 'var(--mono)', fontSize: 'var(--fs-2xs)', cursor: 'pointer',
    padding: '1px 6px', borderRadius: 3,
    color, background: `color-mix(in srgb, ${color} 12%, transparent)`,
    border: `1px solid color-mix(in srgb, ${color} 28%, transparent)`,
    whiteSpace: 'nowrap' as const,
  }),

  // ── Doc tabs ──────────────────────────────────────────────────────────────
  tabsRow: {
    display: 'flex', borderTop: '1px solid var(--bd)',
    marginTop: 2,
  },
  tab: (active: boolean) => ({
    padding: '5px 12px', fontSize: 'var(--fs-xs)', fontWeight: 600,
    letterSpacing: '0.03em', cursor: 'pointer',
    color: active ? 'var(--acc)' : 'var(--t3)',
    borderBottom: `2px solid ${active ? 'var(--acc)' : 'transparent'}`,
    background: active ? 'color-mix(in srgb, var(--acc) 6%, transparent)' : 'transparent',
    whiteSpace: 'nowrap' as const,
    display: 'flex', alignItems: 'center', gap: 4,
  }),
  tabCnt: { fontSize: 'var(--fs-2xs)', opacity: 0.65 },

  // ── Doc list ──────────────────────────────────────────────────────────────
  docList: { maxHeight: 160, overflowY: 'auto' as const },
  docRow: (sel: boolean) => ({
    display: 'flex', alignItems: 'center', gap: 8,
    padding: '4px 14px', cursor: 'pointer',
    borderBottom: '1px solid color-mix(in srgb, var(--bd) 50%, transparent)',
    background: sel ? 'color-mix(in srgb, var(--acc) 7%, transparent)' : 'transparent',
  }),
  docId:   { fontFamily: 'var(--mono)', fontSize: 'var(--fs-2xs)', color: 'var(--acc)', fontWeight: 600, flexShrink: 0, maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const },
  docTitle:{ flex: 1, fontSize: 'var(--fs-sm)', color: 'var(--t2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const, minWidth: 0 },
  docSt:   (color: string) => ({
    fontSize: 'var(--fs-2xs)', color, flexShrink: 0, display: 'flex', alignItems: 'center', gap: 3,
    padding: '1px 5px', borderRadius: 3,
    background: `color-mix(in srgb, ${color} 14%, transparent)`,
    border: `1px solid color-mix(in srgb, ${color} 28%, transparent)`,
  }),
  docHint: { fontSize: 'var(--fs-2xs)', color: 'var(--t3)', flexShrink: 0, whiteSpace: 'nowrap' as const, fontFamily: 'var(--mono)' },
  docEmpty:{ padding: '12px 14px', fontSize: 'var(--fs-sm)', color: 'var(--t3)' },

  // ── BOTTOM: reader ────────────────────────────────────────────────────────
  reader: {
    flex: 1, display: 'flex', flexDirection: 'column' as const, overflow: 'hidden',
  },
  readerHdr: {
    padding: '8px 14px', borderBottom: '1px solid var(--bd)', flexShrink: 0,
    display: 'flex', alignItems: 'flex-start', gap: 8,
  },
  readerTitle:{ fontSize: 'var(--fs-base)', fontWeight: 600, color: 'var(--t1)', flex: 1, minWidth: 0 },
  readerBadge: (color: string) => ({
    fontSize: 'var(--fs-2xs)', padding: '1px 6px', borderRadius: 3, fontWeight: 700,
    fontFamily: 'var(--mono)', flexShrink: 0,
    color, background: `color-mix(in srgb, ${color} 14%, transparent)`,
    border: `1px solid color-mix(in srgb, ${color} 28%, transparent)`,
  }),
  readerScroll: { flex: 1, overflowY: 'auto' as const, padding: '12px 16px' },
  rH1:  { fontSize: 'var(--fs-md)', fontWeight: 700, color: 'var(--t1)', marginTop: 14, marginBottom: 6 },
  rH2:  { fontSize: 'var(--fs-sm)', fontWeight: 700, color: 'var(--t2)', marginTop: 12, marginBottom: 4, textTransform: 'uppercase' as const, letterSpacing: '0.04em' },
  rH3:  { fontSize: 'var(--fs-xs)', fontWeight: 600, color: 'var(--t3)', marginTop: 10, marginBottom: 3, textTransform: 'uppercase' as const, letterSpacing: '0.05em' },
  rP:   { fontSize: 'var(--fs-sm)', color: 'var(--t2)', lineHeight: 1.65, marginBottom: 8 },
  rBullet: { fontSize: 'var(--fs-sm)', color: 'var(--t2)', lineHeight: 1.7, paddingLeft: 10, marginBottom: 2 },
  rCode:{ fontFamily: 'var(--mono)', fontSize: 'var(--fs-xs)', background: 'var(--b2)', border: '1px solid var(--bd)', borderRadius: 3, padding: '1px 5px', color: 'var(--inf)' },
  rPre: {
    fontFamily: 'var(--mono)', fontSize: 'var(--fs-xs)', color: 'var(--t2)',
    background: 'var(--b2)', border: '1px solid var(--bd)', borderRadius: 5,
    padding: '8px 12px', margin: '6px 0', whiteSpace: 'pre' as const,
    overflow: 'auto', lineHeight: 1.6,
  },
  placeholder: { flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--t3)', fontSize: 'var(--fs-sm)' },

  // ── Edit panel ────────────────────────────────────────────────────────────
  editPanel: { margin: '0 14px 10px', padding: '10px 12px', borderRadius: 6, background: 'var(--b2)', border: '1px solid var(--bd)' },
  editRow:   { display: 'flex', gap: 8, marginBottom: 6, alignItems: 'center' },
  editLabel: { fontSize: 'var(--fs-xs)', color: 'var(--t3)', width: 68, flexShrink: 0, textTransform: 'uppercase' as const },
  editInput: { flex: 1, padding: '3px 7px', borderRadius: 4, fontSize: 'var(--fs-sm)', background: 'var(--b1)', border: '1px solid var(--bd)', color: 'var(--t1)', fontFamily: 'inherit', outline: 'none' },
  editActions:{ display: 'flex', gap: 6, marginTop: 6, justifyContent: 'flex-end' as const },
  saveBtn:   { padding: '3px 10px', borderRadius: 4, fontSize: 'var(--fs-sm)', cursor: 'pointer', background: 'var(--acc)', color: 'var(--on-accent)', border: 'none', fontFamily: 'inherit' },
  cancelBtn: { padding: '3px 10px', borderRadius: 4, fontSize: 'var(--fs-sm)', cursor: 'pointer', background: 'transparent', color: 'var(--t3)', border: '1px solid var(--bd)', fontFamily: 'inherit' },
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function stLabel(s: string | null | undefined) {
  return (s ?? '').toUpperCase().replace('_', ' ');
}

function MdBlock({ md, label }: { md: string | null | undefined; label: string }) {
  if (!md?.trim()) return null;
  return (
    <>
      <div style={S.rH2}>{label}</div>
      <MartProse text={md} style={S.rP} />
    </>
  );
}

// ── Component ─────────────────────────────────────────────────────────────────

interface Props {
  componentId: string;
  onError: (e: unknown) => void;
  onNavigateComponent?: (id: string) => void;
}

export default function LoreComponentPassport({
  componentId, onError, onNavigateComponent,
}: Props) {
  const { t, i18n } = useTranslation();
  const [comp, setComp]       = useState<LoreComponentDetail | null>(null);
  const [adrs, setAdrs]       = useState<LoreAdrRow[]>([]);
  const [specs, setSpecs]     = useState<LoreSpecRow[]>([]);
  const [qgs, setQgs]         = useState<QGRow[]>([]);
  const [docs, setDocs]       = useState<LoreKnowDocRow[]>([]);
  const [sprints, setSprints] = useState<ComponentSprintRow[]>([]);
  const [loading, setLoading] = useState(true);

  const [editing, setEditing]           = useState(false);
  const [saving, setSaving]             = useState(false);
  const [editOwner, setEditOwner]       = useState('');
  const [editTeam, setEditTeam]         = useState('');
  const [editIcon, setEditIcon]         = useState('');
  const [editFullName, setEditFullName] = useState('');
  const [editParentId, setEditParentId] = useState<string>('');
  const [allComponents, setAllComponents] = useState<LoreComponent[]>([]);

  const [docTab, setDocTab]           = useState<DocTab>('adr');
  const [selDocId, setSelDocId]       = useState<string | null>(null);
  const [docContent, setDocContent]   = useState<DocContent | null>(null);
  const [docLoading, setDocLoading]   = useState(false);
  const [selTaskUid, setSelTaskUid]         = useState<string | null>(null);
  const [sprintStatusFilter, setSprintStatusFilter] = useState<Set<string>>(new Set());
  const [taskStatusFilter, setTaskStatusFilter]     = useState<Set<string>>(new Set());

  // ── Resizable split ────────────────────────────────────────────────────────
  const [topHeight, setTopHeight] = useState(280);
  const dragState = useRef<{ startY: number; startH: number } | null>(null);

  useEffect(() => {
    function onMove(e: MouseEvent) {
      if (!dragState.current) return;
      const delta = e.clientY - dragState.current.startY;
      setTopHeight(Math.max(120, Math.min(600, dragState.current.startH + delta)));
    }
    function onUp() { dragState.current = null; document.body.style.cursor = ''; }
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
  }, []);

  // ── Data load ──────────────────────────────────────────────────────────────
  useEffect(() => {
    setLoading(true); setComp(null); setAdrs([]); setSpecs([]); setQgs([]); setDocs([]);
    setSprints([]); setEditing(false); setSelDocId(null); setDocContent(null); setSelTaskUid(null);
    setSprintStatusFilter(new Set()); setTaskStatusFilter(new Set());
    const ctrl = new AbortController();

    Promise.all([
      fetchLoreSlice<LoreComponentDetail>('component',      { id: componentId },        ctrl.signal),
      fetchLoreSlice<LoreAdrRow>          ('adrs',           { component: componentId }, ctrl.signal),
      fetchLoreSlice<LoreSpecRow>         ('specs',          { component: componentId }, ctrl.signal),
      fetchLoreSlice<QGRow>               ('quality_gates',  { component: componentId }, ctrl.signal),
      // 'docs' has no server-side component filter (LoreArtifactList fetches it
      // unfiltered too) — filter client-side below.
      fetchLoreSlice<LoreKnowDocRow>      ('docs',           undefined,                 ctrl.signal),
    ])
      .then(([compRows, adrRows, specRows, qgRows, docRows]) => {
        const c = compRows[0] ?? null;
        setComp(c); setAdrs(adrRows); setSpecs(specRows); setQgs(qgRows);
        setDocs(docRows.filter(d => d.component_id === componentId));
        setEditOwner(c?.owner ?? '');
        setEditTeam(c?.team ?? '');
        setEditIcon(c?.game_icon ?? '');
        setEditFullName(c?.full_name ?? '');
        setEditParentId(c?.parent_id ?? '');
        setLoading(false);
        const key = componentId.length < 4
          ? (c?.full_name?.split(/\s+/)[0]?.toUpperCase() ?? componentId)
          : componentId;
        return fetchLoreSlice<ComponentSprintRow>('component_sprints', { pattern: `%${key}%`, cid: componentId }, ctrl.signal);
      })
      .then(rows => setSprints(rows ?? []))
      .catch(e => { onError(e); setLoading(false); });
    return () => ctrl.abort();
  }, [componentId, onError]);

  // ── Doc content load ───────────────────────────────────────────────────────
  useEffect(() => {
    if (!selDocId) { setDocContent(null); return; }
    setDocLoading(true);
    const ctrl = new AbortController();

    const load = async () => {
      if (docTab === 'spec') {
        const rows = await fetchLoreSlice<LoreSpecPassport>('spec_by_id', { id: selDocId }, ctrl.signal);
        if (rows[0]) setDocContent({ type: 'spec', data: rows[0] });
      } else if (docTab === 'qg') {
        const rows = await fetchLoreSlice<QGPassport>('quality_gate_by_id', { id: selDocId }, ctrl.signal);
        if (rows[0]) setDocContent({ type: 'qg', data: rows[0] });
      } else if (docTab === 'adr') {
        const rows = await fetchLoreSlice<LoreAdrPassport>('adr', { id: selDocId }, ctrl.signal);
        if (rows[0]) setDocContent({ type: 'adr', data: rows[0] });
      } else if (docTab === 'doc') {
        const rows = await fetchLoreSlice<LoreKnowDoc>('doc_by_id', { id: selDocId }, ctrl.signal);
        if (rows[0]) setDocContent({ type: 'doc', data: rows[0] });
      } else {
        const [sprintRows, taskRows] = await Promise.all([
          fetchLoreSlice<LoreSprintRow>('sprint_tree', { id: selDocId }, ctrl.signal),
          fetchLoreSlice<LoreSprintTask>('tasks_of_sprint', { sprint_id: selDocId }, ctrl.signal),
        ]);
        const sprintData = sprintRows[0] ?? (sprints.find(s => s.sprint_id === selDocId) as unknown as LoreSprintRow);
        if (sprintData) setDocContent({ type: 'sprint', data: sprintData, tasks: taskRows });
      }
    };
    load().catch(onError).finally(() => setDocLoading(false));
    return () => ctrl.abort();
  }, [selDocId, docTab, sprints, onError]);

  // ── Load all components for parent selector ────────────────────────────────
  const openEdit = async () => {
    setEditing(e => !e);
    if (allComponents.length === 0) {
      try {
        const rows = await fetchLoreSlice<LoreComponent>('components');
        setAllComponents(rows.sort((a, b) => a.component_id.localeCompare(b.component_id)));
      } catch { /* non-critical */ }
    }
  };

  // ── Save ───────────────────────────────────────────────────────────────────
  const handleSave = async () => {
    if (!comp) return;
    setSaving(true);
    try {
      const newParent = editParentId || null;
      await updateLoreComponent({
        component_id: comp.component_id,
        owner: editOwner || null, team: editTeam || null,
        game_icon: editIcon || null, full_name: editFullName || null,
        parent_id: newParent,
      });
      setComp(prev => prev ? { ...prev, owner: editOwner, team: editTeam, game_icon: editIcon, full_name: editFullName, parent_id: newParent } : prev);
      setEditing(false);
    } catch (e) { onError(e); }
    finally { setSaving(false); }
  };

  if (loading) return <div style={{ padding: 24, color: 'var(--t3)', fontSize: 'var(--fs-base)' }}>{t('lore.componentPassport.loading', 'Загрузка')} {componentId}…</div>;
  if (!comp)   return <div style={{ padding: 24, color: 'var(--t3)', fontSize: 'var(--fs-base)' }}>{t('lore.componentPassport.notFound', 'Не найден:')} {componentId}</div>;

  const color   = areaColor(compArea(comp));
  const tech    = comp.tech ?? [];
  const children = comp.children ?? [];

  const tabList: { key: DocTab; label: string; count: number }[] = [
    { key: 'adr',    label: t('lore.componentPassport.tabs.adr', 'ADR'),     count: adrs.length    },
    { key: 'spec',   label: t('lore.componentPassport.tabs.spec', 'Spec'),    count: specs.length   },
    { key: 'qg',     label: t('lore.componentPassport.tabs.qg', 'QG'),      count: qgs.length     },
    { key: 'doc',    label: t('lore.componentPassport.tabs.doc', 'Знания'),  count: docs.length    },
    { key: 'sprint', label: t('lore.componentPassport.tabs.sprints', 'Спринты'), count: sprints.length },
  ];

  const docRows: { id: string; title: string; status: string | null; hint?: string | null; releases?: string[] | null }[] =
    docTab === 'adr'    ? adrs.map(a => ({ id: a.adr_id, title: a.name ?? a.adr_id, status: a.status }))
    : docTab === 'spec' ? specs.map(s => ({ id: s.spec_id, title: s.title ?? s.spec_id, status: null, hint: s.file_path?.split('/').pop() ?? null }))
    : docTab === 'qg'   ? qgs.map(q => ({ id: q.qg_id, title: q.name, status: q.status, hint: q.date_created?.slice(0, 10) ?? null }))
    : docTab === 'doc'  ? docs.map(d => ({ id: d.doc_id, title: d.title ?? d.doc_id, status: null, hint: d.kind }))
    : sprints
        .map(s => { const { status } = taskTick(s.status_raw); return { id: s.sprint_id, title: s.name ?? s.sprint_id, status, releases: s.release_ids }; })
        .filter(r => sprintStatusFilter.size === 0 || sprintStatusFilter.has(r.status ?? ''));

  return (
    <div style={S.root}>
      {/* ── TOP ──────────────────────────────────────────────────────────── */}
      <div style={{ ...S.top, height: topHeight, flexShrink: 0, overflow: 'hidden' }}>
        {/* Header row */}
        <div style={S.hdr}>
          <div style={S.iconLg(color)}>
            {comp.game_icon
              ? <GameIcon slug={comp.game_icon} size={16} style={{ color: 'inherit' }} />
              : <span style={{ fontFamily: 'var(--mono)', fontSize: 'var(--fs-base)', fontWeight: 700 }}>{comp.component_id[0]}</span>}
          </div>
          <div style={S.titleCol}>
            <div style={S.compId}>{comp.component_id}</div>
            {comp.full_name && <div style={S.fullName}>{comp.full_name}</div>}
          </div>
          {comp.parent_id && (
            <button style={S.parentBtn} onClick={() => onNavigateComponent?.(comp.parent_id!)}>
              ↑ {comp.parent_id}
            </button>
          )}
          <button style={S.editBtn} onClick={openEdit} title={t('lore.componentPassport.editButtonTitle', 'Редактировать')} aria-label={t('lore.componentPassport.editButtonTitle', 'Редактировать')}>✎</button>
        </div>

        {/* Meta row: owner, team, children */}
        <div style={S.meta}>
          {comp.owner && <span style={S.metaChip()}>👤 {comp.owner}</span>}
          {comp.team  && <span style={S.metaChip(color)}>⬡ {comp.team}</span>}
          {children.length > 0 && children.map(c => (
            <span key={c} style={S.childChip(color)} onClick={() => onNavigateComponent?.(c)}>{c}</span>
          ))}
          {tech.length > 0 && tech.map(t => <span key={t} style={S.techChip}>{t}</span>)}
        </div>

        {/* Edit panel */}
        {editing && (
          <div style={S.editPanel}>
            {[
              { label: t('lore.componentPassport.edit.nameLabel', 'Название'), val: editFullName, set: setEditFullName, ph: t('lore.componentPassport.edit.namePlaceholder', 'Full name') },
              { label: t('lore.componentPassport.edit.ownerLabel', 'Owner'),    val: editOwner,    set: setEditOwner,    ph: t('lore.componentPassport.edit.ownerPlaceholder', 'owner') },
              { label: t('lore.componentPassport.edit.teamLabel', 'Team'),     val: editTeam,     set: setEditTeam,     ph: t('lore.componentPassport.edit.teamPlaceholder', 'team') },
              { label: t('lore.componentPassport.edit.iconLabel', 'Icon'),     val: editIcon,     set: setEditIcon,     ph: t('lore.componentPassport.edit.iconPlaceholder', 'game-icon slug') },
            ].map(f => (
              <div key={f.label} style={S.editRow}>
                <span style={S.editLabel}>{f.label}</span>
                <input style={S.editInput} value={f.val} placeholder={f.ph} onChange={e => f.set(e.target.value)} />
              </div>
            ))}
            <div style={S.editRow}>
              <span style={S.editLabel}>{t('lore.componentPassport.edit.parentLabel', 'Родитель')}</span>
              <select
                style={{ ...S.editInput, cursor: 'pointer' }}
                value={editParentId}
                onChange={e => setEditParentId(e.target.value)}
              >
                <option value="">{t('lore.componentPassport.edit.noParentOption', '— нет родителя —')}</option>
                {allComponents
                  .filter(c => c.component_id !== comp.component_id)
                  .map(c => (
                    <option key={c.component_id} value={c.component_id}>
                      {c.component_id}{c.full_name ? ` — ${c.full_name}` : ''}
                    </option>
                  ))}
              </select>
            </div>
            <div style={S.editActions}>
              <button style={S.cancelBtn} onClick={() => setEditing(false)}>{t('lore.componentPassport.edit.cancel', 'Отмена')}</button>
              <button style={S.saveBtn} disabled={saving} onClick={handleSave}>{saving ? '…' : t('lore.componentPassport.edit.save', 'Сохранить')}</button>
            </div>
          </div>
        )}

        {/* Doc tabs */}
        <div style={S.tabsRow}>
          {tabList.map(t => (
            <div key={t.key} style={S.tab(docTab === t.key)} aria-pressed={docTab === t.key}
              {...a11yClick(() => {
                setDocTab(t.key); setSelDocId(null); setDocContent(null); setSelTaskUid(null);
                setSprintStatusFilter(new Set()); setTaskStatusFilter(new Set());
              })}>
              {t.label}
              {t.count > 0 && <span style={S.tabCnt}>{t.count}</span>}
            </div>
          ))}
        </div>

        {/* Sprint status stats */}
        {docTab === 'sprint' && sprints.length > 0 && (() => {
          const cnt = new Map<string, number>();
          sprints.forEach(s => { const { status } = taskTick(s.status_raw); cnt.set(status, (cnt.get(status) ?? 0) + 1); });
          const toggleSprint = (st: string) => {
            setSprintStatusFilter(prev => {
              const next = new Set(prev);
              next.has(st) ? next.delete(st) : next.add(st);
              return next;
            });
            setSelDocId(null); setDocContent(null); setSelTaskUid(null);
          };
          return (
            <div style={{ display: 'flex', flexWrap: 'wrap' as const, gap: 4, padding: '5px 8px', borderBottom: '1px solid var(--bd)', background: 'var(--b1)' }}>
              {Array.from(cnt.entries()).map(([st, n]) => {
                const sm = statusMeta(st);
                const active = sprintStatusFilter.has(st);
                return (
                  <div
                    key={st}
                    onClick={() => toggleSprint(st)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 3,
                      padding: '2px 6px', borderRadius: 4, cursor: 'pointer',
                      background: active ? `color-mix(in srgb, ${sm.color} 22%, transparent)` : `color-mix(in srgb, ${sm.color} 8%, transparent)`,
                      border: `1px solid color-mix(in srgb, ${sm.color} ${active ? 50 : 20}%, transparent)`,
                      opacity: sprintStatusFilter.size > 0 && !active ? 0.45 : 1,
                    }}
                  >
                    <GameIcon slug={sm.icon} size={9} style={{ color: sm.color }} />
                    <span style={{ fontSize: 'var(--fs-2xs)', color: sm.color, fontFamily: 'var(--mono)', fontWeight: active ? 700 : 600 }}>{n}</span>
                  </div>
                );
              })}
            </div>
          );
        })()}

        {/* Doc list */}
        <div style={S.docList}>
          {docRows.length === 0
            ? <div style={S.docEmpty}>{t('lore.componentPassport.docList.empty', 'Нет документов')}</div>
            : docRows.map(d => {
              const sm = d.status ? (
                docTab === 'qg'
                  ? { icon: statusMeta(d.status).icon, color: qgStatusMeta(t, d.status).color }
                  : statusMeta(d.status)
              ) : null;
              return (
                <div
                  key={d.id}
                  style={S.docRow(selDocId === d.id)}
                  onClick={() => setSelDocId(d.id)}
                  onMouseEnter={e => { if (selDocId !== d.id) (e.currentTarget as HTMLElement).style.background = 'var(--b2)'; }}
                  onMouseLeave={e => { if (selDocId !== d.id) (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
                >
                  <span style={S.docId}>{d.id}</span>
                  <span style={S.docTitle}>{d.title}</span>
                  {d.hint && <span style={S.docHint}>{d.hint}</span>}
                  {d.releases && d.releases.length > 0 && (
                    <span style={{ display: 'flex', gap: 2, flexShrink: 0 }}>
                      {d.releases.slice(0, 2).map(r => (
                        <span key={r} style={{ fontSize: 'var(--fs-2xs)', padding: '1px 4px', borderRadius: 3, background: 'color-mix(in srgb, var(--inf) 12%, transparent)', color: 'var(--inf)', border: '1px solid color-mix(in srgb, var(--inf) 25%, transparent)', fontFamily: 'var(--mono)', whiteSpace: 'nowrap' as const }}>
                          {r}
                        </span>
                      ))}
                      {d.releases.length > 2 && <span style={{ fontSize: 'var(--fs-2xs)', color: 'var(--t3)' }}>+{d.releases.length - 2}</span>}
                    </span>
                  )}
                  {sm && (
                    <span style={S.docSt(sm.color)}>
                      <GameIcon slug={sm.icon} size={9} style={{ color: 'inherit' }} />
                    </span>
                  )}
                </div>
              );
            })}
        </div>
      </div>

      {/* ── Resize handle ────────────────────────────────────────────────── */}
      <div
        onMouseDown={e => { dragState.current = { startY: e.clientY, startH: topHeight }; document.body.style.cursor = 'ns-resize'; e.preventDefault(); }}
        style={{
          height: 5, flexShrink: 0, cursor: 'ns-resize',
          background: 'transparent',
          borderTop: '1px solid var(--bd)',
          borderBottom: '1px solid var(--bd)',
          transition: 'background 0.15s',
        }}
        onMouseEnter={e => { (e.currentTarget as HTMLDivElement).style.background = 'color-mix(in srgb, var(--acc) 20%, transparent)'; }}
        onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.background = 'transparent'; }}
      />

      {/* ── BOTTOM: reader ───────────────────────────────────────────────── */}
      <div style={S.reader}>
        {!selDocId ? (
          <div style={S.placeholder}>{t('lore.componentPassport.reader.selectDoc', 'Выберите документ выше')}</div>
        ) : docLoading ? (
          <div style={S.placeholder}>{t('lore.componentPassport.reader.loading', 'Загрузка…')}</div>
        ) : !docContent ? (
          <div style={S.placeholder}>{t('lore.componentPassport.reader.noContent', 'Нет содержимого')}</div>
        ) : (
          <>
            <div style={S.readerHdr}>
              <div style={S.readerTitle}>
                {docContent.type === 'adr'    && (docContent.data.name ?? docContent.data.adr_id)}
                {docContent.type === 'spec'   && (docContent.data.title ?? docContent.data.spec_id)}
                {docContent.type === 'qg'     && docContent.data.name}
                {docContent.type === 'doc'    && (docContent.data.title ?? docContent.data.doc_id)}
                {docContent.type === 'sprint' && (docContent.data.name ?? docContent.data.sprint_id)}
              </div>
              <span style={S.readerBadge(
                docContent.type === 'adr'    ? 'var(--acc)' :
                docContent.type === 'spec'   ? 'var(--inf)' :
                docContent.type === 'qg'     ? 'var(--wrn)' :
                docContent.type === 'doc'    ? 'var(--kind-doc)' : 'var(--suc)'
              )}>
                {docContent.type.toUpperCase()}
              </span>
            </div>
            <div style={S.readerScroll}>
              {docContent.type === 'adr' && (
                <>
                  <MdBlock md={docContent.data.context_md}      label={t('lore.componentPassport.reader.context', 'Контекст')} />
                  <MdBlock md={docContent.data.decision_md}     label={t('lore.componentPassport.reader.decision', 'Решение')} />
                  <MdBlock md={docContent.data.consequences_md} label={t('lore.componentPassport.reader.consequences', 'Последствия')} />
                  {!docContent.data.context_md && !docContent.data.decision_md && (
                    <p style={S.rP}>{t('lore.componentPassport.reader.contentEmpty', 'Содержимое не заполнено.')}</p>
                  )}
                </>
              )}
              {docContent.type === 'spec' && (
                <>
                  <MdBlock md={docContent.data.content_md} label={t('lore.componentPassport.reader.content', 'Содержимое')} />
                  {!docContent.data.content_md && (
                    <p style={S.rP}>{t('lore.componentPassport.reader.contentEmpty', 'Содержимое не заполнено.')}</p>
                  )}
                </>
              )}
              {docContent.type === 'doc' && (() => {
                const preferred = i18n.language?.startsWith('ru') ? docContent.data.content_md_ru : docContent.data.content_md_en;
                const md = preferred ?? docContent.data.content_md_en ?? docContent.data.content_md_ru;
                if (md) return <MartProse text={md} style={S.rP} />;
                if (docContent.data.content_html) {
                  return <p style={S.rP}>{t('lore.componentPassport.reader.docHtmlOnly', 'Документ хранится как HTML — откройте его во вкладке «Знания» для просмотра.')}</p>;
                }
                return <p style={S.rP}>{t('lore.componentPassport.reader.contentEmpty', 'Содержимое не заполнено.')}</p>;
              })()}
              {docContent.type === 'qg' && (
                <>
                  {docContent.data.description && <p style={S.rP}>{docContent.data.description}</p>}
                  <MdBlock md={docContent.data.content_md} label={t('lore.componentPassport.reader.content', 'Содержимое')} />
                  {!docContent.data.description && !docContent.data.content_md && (
                    <p style={S.rP}>{t('lore.componentPassport.reader.contentEmpty', 'Содержимое не заполнено.')}</p>
                  )}
                </>
              )}
              {docContent.type === 'sprint' && (() => {
                const { status } = taskTick(docContent.data.status_raw);
                const sm = statusMeta(status);
                const tasks = docContent.tasks ?? [];
                return (
                  <>
                    {status !== 'todo' && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 8 }}>
                        <GameIcon slug={sm.icon} size={12} style={{ color: sm.color }} />
                        <span style={{ fontSize: 'var(--fs-xs)', color: sm.color, fontWeight: 600, textTransform: 'uppercase' as const, letterSpacing: '0.04em' }}>
                          {stLabel(status)}
                        </span>
                      </div>
                    )}
                    <MdBlock md={docContent.data.context_md} label={t('lore.componentPassport.reader.context', 'Контекст')} />
                    {tasks.length > 0 && (
                      <>
                        <div style={S.rH2}>{t('lore.componentPassport.reader.tasks', 'Задачи')}</div>
                        {(() => {
                          const tc = new Map<string, number>();
                          tasks.forEach(t => { const { status } = taskTick(t.status_raw); tc.set(status, (tc.get(status) ?? 0) + 1); });
                          const toggleTask = (st: string) => {
                            setTaskStatusFilter(prev => {
                              const next = new Set(prev);
                              next.has(st) ? next.delete(st) : next.add(st);
                              return next;
                            });
                            setSelTaskUid(null);
                          };
                          return (
                            <div style={{ display: 'flex', flexWrap: 'wrap' as const, gap: 3, marginBottom: 8, padding: '4px 7px', background: 'var(--b2)', borderRadius: 5, border: '1px solid var(--bd)' }}>
                              {Array.from(tc.entries()).map(([st, n]) => {
                                const sm = statusMeta(st);
                                const active = taskStatusFilter.has(st);
                                return (
                                  <div
                                    key={st}
                                    onClick={() => toggleTask(st)}
                                    style={{
                                      display: 'flex', alignItems: 'center', gap: 3,
                                      padding: '1px 5px', borderRadius: 3, cursor: 'pointer',
                                      background: active ? `color-mix(in srgb, ${sm.color} 18%, transparent)` : `color-mix(in srgb, ${sm.color} 7%, transparent)`,
                                      border: `1px solid color-mix(in srgb, ${sm.color} ${active ? 45 : 18}%, transparent)`,
                                      opacity: taskStatusFilter.size > 0 && !active ? 0.4 : 1,
                                    }}
                                  >
                                    <GameIcon slug={sm.icon} size={8} style={{ color: sm.color }} />
                                    <span style={{ fontSize: 'var(--fs-2xs)', color: sm.color, fontFamily: 'var(--mono)', fontWeight: active ? 700 : 400 }}>{n}</span>
                                  </div>
                                );
                              })}
                            </div>
                          );
                        })()}
                        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                          {/* task list */}
                          <div style={{ flex: '0 0 auto', width: selTaskUid ? '44%' : '100%', transition: 'width 0.15s' }}>
                            {tasks
                              .filter(t => { if (!taskStatusFilter.size) return true; const { status } = taskTick(t.status_raw); return taskStatusFilter.has(status); })
                              .sort((a, b) => a.order_index - b.order_index).map(t => {
                              const { status: ts } = taskTick(t.status_raw);
                              const tsm = statusMeta(ts);
                              const sel = selTaskUid === t.task_uid;
                              return (
                                <div
                                  key={t.task_uid}
                                  onClick={() => setSelTaskUid(sel ? null : t.task_uid)}
                                  style={{
                                    display: 'flex', alignItems: 'center', gap: 5,
                                    marginBottom: 3, padding: '3px 5px', borderRadius: 4,
                                    cursor: 'pointer',
                                    background: sel ? 'color-mix(in srgb, var(--acc) 8%, transparent)' : 'transparent',
                                    border: `1px solid ${sel ? 'color-mix(in srgb, var(--acc) 25%, transparent)' : 'transparent'}`,
                                  }}
                                >
                                  <GameIcon slug={tsm.icon} size={10} style={{ color: tsm.color, flexShrink: 0 }} />
                                  <span style={{ fontFamily: 'var(--mono)', fontSize: 'var(--fs-2xs)', color: 'var(--acc)', flexShrink: 0 }}>{t.task_id}</span>
                                  <span style={{ fontSize: 'var(--fs-sm)', color: ts === 'done' ? 'var(--t3)' : 'var(--t2)', flex: 1, lineHeight: 1.4, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const }}>{t.title}</span>
                                </div>
                              );
                            })}
                          </div>
                          {/* note panel */}
                          {selTaskUid && (() => {
                            const activeTask = tasks.find(x => x.task_uid === selTaskUid);
                            if (!activeTask) return null;
                            const { status: ts } = taskTick(activeTask.status_raw);
                            const tsm = statusMeta(ts);
                            return (
                              <div style={{ flex: 1, minWidth: 0, borderLeft: `2px solid color-mix(in srgb, ${tsm.color} 35%, transparent)`, paddingLeft: 10 }}>
                                <div style={{ fontSize: 'var(--fs-xs)', fontFamily: 'var(--mono)', color: 'var(--acc)', marginBottom: 4 }}>{activeTask.task_id}</div>
                                <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--t1)', fontWeight: 500, marginBottom: 6, lineHeight: 1.4 }}>{activeTask.title}</div>
                                {activeTask.note_md?.trim()
                                  ? <MartProse text={activeTask.note_md} style={S.rP} />
                                  : <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--t3)' }}>{t('lore.componentPassport.reader.notesEmpty', 'Заметки не заполнены')}</span>}
                              </div>
                            );
                          })()}
                        </div>
                      </>
                    )}
                    {!docContent.data.context_md && tasks.length === 0 && (
                      <p style={S.rP}>{t('lore.componentPassport.reader.sprintContentEmpty', 'Содержимое спринта не заполнено.')}</p>
                    )}
                  </>
                );
              })()}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
