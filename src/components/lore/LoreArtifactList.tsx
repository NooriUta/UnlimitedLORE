import { useEffect, useMemo, useState } from 'react';
import {
  fetchLoreSlice,
  type LoreAdrRow, type LoreSpecRow, type LoreKnowDocRow, type LoreComponent,
} from '../../api/lore';
import { GameIcon } from './GameIcon';

// Unified knowledge listing under «Компоненты»: ADR / specs / runbooks / docs /
// quality-gates in one flat, typed, component-linked list. Replaces the per-component
// master-detail tree — most artifacts (~90%) belong to a component, so a single
// type-filterable list beats drilling component by component.

export type ArtifactKind = 'adr' | 'spec' | 'runbook' | 'doc' | 'qg';

interface Artifact {
  kind: ArtifactKind;
  id: string;
  title: string;
  component: string | null;
  date: string | null;
}

interface RunbookRow { runbook_id: string; name: string | null; area: string | null; date_created: string | null; }
interface QgRow { qg_id: string; name: string | null; component_id: string | null; status: string | null; date_created: string | null; }

export const ARTIFACT_KINDS: { kind: ArtifactKind; label: string; color: string; icon: string }[] = [
  { kind: 'adr',     label: 'ADR',           color: '#4a90d9', icon: 'scroll-quill' },
  { kind: 'spec',    label: 'Спеки',         color: '#4caf50', icon: 'white-book' },
  { kind: 'runbook', label: 'Runbooks',      color: '#e8923a', icon: 'spell-book' },
  { kind: 'doc',     label: 'Документы',     color: '#a974d6', icon: 'papers' },
  { kind: 'qg',      label: 'Quality Gates', color: '#3fb8a0', icon: 'checkered-flag' },
];
const KIND_META  = Object.fromEntries(ARTIFACT_KINDS.map(k => [k.kind, k])) as Record<ArtifactKind, typeof ARTIFACT_KINDS[number]>;
const KIND_ORDER = Object.fromEntries(ARTIFACT_KINDS.map((k, i) => [k.kind, i])) as Record<ArtifactKind, number>;

const S = {
  root:   { flex: 1, display: 'flex', flexDirection: 'column' as const, minWidth: 0, overflow: 'hidden' },
  head:   { padding: '10px 14px', borderBottom: '1px solid var(--b2)', flexShrink: 0, display: 'flex', flexDirection: 'column' as const, gap: 8 },
  chips:  { display: 'flex', flexWrap: 'wrap' as const, gap: 6 },
  chip: (on: boolean, color: string) => ({
    display: 'flex', alignItems: 'center', gap: 5, cursor: 'pointer', userSelect: 'none' as const,
    padding: '3px 9px', borderRadius: 12, fontSize: 11, whiteSpace: 'nowrap' as const,
    border: `1px solid ${on ? color : 'var(--b3)'}`,
    background: on ? `color-mix(in srgb, ${color} 18%, transparent)` : 'transparent',
    color: on ? 'var(--t1)' : 'var(--t3)',
    transition: 'all 0.1s',
  }),
  chipCount: (on: boolean) => ({ fontSize: 9, opacity: on ? 0.8 : 0.6 }),
  chipRow: { display: 'flex', alignItems: 'flex-start', gap: 8 },
  flabel:  { fontSize: 9, color: 'var(--t3)', textTransform: 'uppercase' as const, letterSpacing: 0.5, width: 58, flexShrink: 0, paddingTop: 5 },
  search: {
    flex: 1, minWidth: 100, background: 'var(--b1)', border: '1px solid var(--b3)', borderRadius: 4,
    color: 'var(--t1)', fontSize: 11, fontFamily: 'inherit', padding: '4px 8px', outline: 'none',
  },
  list:   { flex: 1, overflowY: 'auto' as const },
  row: (sel: boolean) => ({
    display: 'flex', alignItems: 'center', gap: 8, padding: '6px 14px',
    borderBottom: '1px solid var(--b2)', fontSize: 12, cursor: 'pointer',
    background: sel ? 'color-mix(in srgb, var(--acc) 10%, transparent)' : 'transparent',
  }),
  badge: (color: string) => ({
    flexShrink: 0, width: 18, height: 18, borderRadius: 4, display: 'flex', alignItems: 'center', justifyContent: 'center',
    color, background: `color-mix(in srgb, ${color} 16%, transparent)`,
  }),
  title:  { flex: 1, minWidth: 0, color: 'var(--t1)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const },
  comp:   { fontSize: 9, padding: '1px 6px', borderRadius: 3, flexShrink: 0, background: 'color-mix(in srgb, var(--acc) 12%, transparent)', color: 'var(--acc)', whiteSpace: 'nowrap' as const },
  noComp: { fontSize: 9, padding: '1px 6px', borderRadius: 3, flexShrink: 0, background: 'var(--b2)', color: 'var(--t3)', whiteSpace: 'nowrap' as const },
  date:   { color: 'var(--t3)', fontSize: 10, flexShrink: 0, width: 72, textAlign: 'right' as const },
  empty:  { padding: 24, color: 'var(--t3)', fontSize: 12 },
};

interface Props {
  onError: (e: unknown) => void;
  onOpen: (kind: ArtifactKind, id: string) => void;
  selectedKind?: string;
  selectedId?: string;
}

export default function LoreArtifactList({ onError, onOpen, selectedKind, selectedId }: Props) {
  const [items, setItems]     = useState<Artifact[]>([]);
  const [comps, setComps]     = useState<LoreComponent[]>([]);
  const [loading, setLoading] = useState(true);
  const [enabled, setEnabled] = useState<Set<ArtifactKind>>(new Set(ARTIFACT_KINDS.map(k => k.kind)));
  const [compSel, setCompSel] = useState<Set<string>>(new Set());
  const [q, setQ]             = useState('');

  useEffect(() => {
    setLoading(true);
    const ctrl = new AbortController();
    // Resilient load: a slice that errors (e.g. a not-yet-ingested type → 502)
    // contributes nothing rather than failing the whole list.
    const safe = <T,>(p: Promise<T[]>): Promise<T[]> => p.catch(() => [] as T[]);
    Promise.all([
      safe(fetchLoreSlice<LoreAdrRow>('adrs', undefined, ctrl.signal)),
      safe(fetchLoreSlice<LoreSpecRow>('specs', undefined, ctrl.signal)),
      safe(fetchLoreSlice<RunbookRow>('runbooks', undefined, ctrl.signal)),
      safe(fetchLoreSlice<LoreKnowDocRow>('docs', undefined, ctrl.signal)),
      safe(fetchLoreSlice<QgRow>('quality_gates', undefined, ctrl.signal)),
      safe(fetchLoreSlice<LoreComponent>('components', undefined, ctrl.signal)),
    ])
      .then(([adrs, specs, runbooks, docs, qgs, components]) => {
        if (ctrl.signal.aborted) return;
        const all: Artifact[] = [
          ...adrs.map(r => ({ kind: 'adr' as const, id: r.adr_id, title: r.adr_id, component: r.component ?? null, date: r.date_created ?? null })),
          ...specs.map(r => ({ kind: 'spec' as const, id: r.spec_id, title: (r.title && r.title.trim()) || r.spec_id.replace(/[_-]+/g, ' '), component: r.component_id ?? null, date: null })),
          ...runbooks.map(r => ({ kind: 'runbook' as const, id: r.runbook_id, title: r.name || r.runbook_id, component: null, date: r.date_created ?? null })),
          ...docs.map(r => ({ kind: 'doc' as const, id: r.doc_id, title: (r.title && r.title.trim()) || r.doc_id, component: r.component_id ?? null, date: null })),
          ...qgs.map(r => ({ kind: 'qg' as const, id: r.qg_id, title: r.name || r.qg_id, component: r.component_id ?? null, date: r.date_created ?? null })),
        ];
        setItems(all); setComps(components); setLoading(false);
      })
      .catch(e => { onError(e); setLoading(false); });
    return () => ctrl.abort();
  }, [onError]);

  const nameOf = useMemo(() => {
    const m: Record<string, string> = {};
    comps.forEach(c => { m[c.component_id] = c.full_name || c.component_id; });
    return m;
  }, [comps]);

  // Component chips: only components that actually have artifacts (of the currently
  // enabled types) — not every LoreComponent. Counts reflect the active type filter.
  const compChips = useMemo(() => {
    const cnt: Record<string, number> = {};
    items.filter(a => enabled.has(a.kind)).forEach(a => {
      const k = a.component ?? '∅';
      cnt[k] = (cnt[k] || 0) + 1;
    });
    return Object.entries(cnt)
      .map(([id, n]) => ({ id, name: id === '∅' ? '— без компонента' : (nameOf[id] || id), n }))
      .sort((a, b) => b.n - a.n || a.name.localeCompare(b.name));
  }, [items, enabled, nameOf]);

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    items.forEach(a => { c[a.kind] = (c[a.kind] || 0) + 1; });
    return c;
  }, [items]);

  const shown = useMemo(() => {
    const ql = q.trim().toLowerCase();
    return items
      .filter(a => enabled.has(a.kind))
      .filter(a => compSel.size === 0 || compSel.has(a.component ?? '∅'))
      .filter(a => !ql || a.title.toLowerCase().includes(ql) || a.id.toLowerCase().includes(ql))
      .sort((a, b) => {
        const ca = a.component ? (nameOf[a.component] || a.component) : '￿';
        const cb = b.component ? (nameOf[b.component] || b.component) : '￿';
        if (ca !== cb) return ca.localeCompare(cb);
        if (a.kind !== b.kind) return KIND_ORDER[a.kind] - KIND_ORDER[b.kind];
        return a.title.localeCompare(b.title);
      });
  }, [items, enabled, compSel, q, nameOf]);

  const toggle = (k: ArtifactKind) => setEnabled(p => {
    const n = new Set(p);
    if (n.has(k)) n.delete(k); else n.add(k);
    return n;
  });
  const toggleComp = (id: string) => setCompSel(p => {
    const n = new Set(p);
    if (n.has(id)) n.delete(id); else n.add(id);
    return n;
  });

  if (loading) return <div style={S.empty}>Загрузка артефактов…</div>;

  return (
    <div style={S.root}>
      <div style={S.head}>
        <div style={S.chipRow}>
          <span style={S.flabel}>Тип</span>
          <div style={S.chips}>
            {ARTIFACT_KINDS.map(k => {
              const on = enabled.has(k.kind);
              return (
                <span key={k.kind} style={S.chip(on, k.color)} onClick={() => toggle(k.kind)}>
                  <GameIcon slug={k.icon} size={12} />
                  {k.label}
                  <span style={S.chipCount(on)}>{counts[k.kind] ?? 0}</span>
                </span>
              );
            })}
          </div>
        </div>
        {compChips.length > 1 && (
          <div style={S.chipRow}>
            <span style={S.flabel}>Модуль</span>
            <div style={S.chips}>
              {compChips.map(c => {
                const on = compSel.has(c.id);
                return (
                  <span key={c.id} style={S.chip(on, 'var(--acc)')} onClick={() => toggleComp(c.id)}>
                    {c.name}
                    <span style={S.chipCount(on)}>{c.n}</span>
                  </span>
                );
              })}
            </div>
          </div>
        )}
        <input
          style={S.search}
          placeholder="Поиск по названию…"
          value={q}
          onChange={e => setQ(e.target.value)}
        />
      </div>

      <div style={S.list}>
        {shown.length === 0 && <div style={S.empty}>Ничего не найдено.</div>}
        {shown.map(a => {
          const meta = KIND_META[a.kind];
          const sel = selectedKind === a.kind && selectedId === a.id;
          return (
            <div key={`${a.kind}:${a.id}`} style={S.row(sel)} onClick={() => onOpen(a.kind, a.id)} title={`${meta.label} · ${a.id}`}>
              <span style={S.badge(meta.color)}><GameIcon slug={meta.icon} size={11} /></span>
              <span style={S.title}>{a.title}</span>
              {a.component
                ? <span style={S.comp}>{nameOf[a.component] || a.component}</span>
                : <span style={S.noComp}>—</span>}
              <span style={S.date}>{a.date?.slice(0, 10) ?? ''}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
