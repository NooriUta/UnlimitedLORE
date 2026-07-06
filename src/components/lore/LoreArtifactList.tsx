import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
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
  // DeepWiki-style page tree (doc kind only, from DOC_CHILD_OF/sort_order) —
  // undefined for every other kind.
  parentId?: string | null;
  sortOrder?: number | null;
}

// Path key for tree ordering: [own sort_order, parent's sort_order, ...] read
// root-to-leaf, e.g. deepwiki_5_1_1 -> [5, 1, 1]. Comparing these arrays
// lexicographically reproduces the exact "01, 01.1, 01.2, 02, ..." document
// order the tree represents, without needing a real recursive render.
// depthCap guards against a parent cycle (client-side only — the backend
// blocks direct self-parenting, but not longer cycles across docs) turning
// this into an infinite loop.
function docPath(id: string, byId: Map<string, Artifact>, depthCap = 12): number[] {
  const seen = new Set<string>();
  const path: number[] = [];
  let cur: string | undefined = id;
  while (cur && !seen.has(cur) && path.length < depthCap) {
    seen.add(cur);
    const a = byId.get(cur);
    if (!a) break;
    path.unshift(a.sortOrder ?? 0);
    cur = a.parentId ?? undefined;
  }
  return path;
}

interface RunbookRow { runbook_id: string; name: string | null; area: string | null; date_created: string | null; }

function exportRunbooksMd(rows: { id: string; title: string; component: string | null }[]) {
  const byArea: Record<string, typeof rows> = {};
  rows.forEach(r => { (byArea[r.component ?? '—'] ??= []).push(r); });
  const date = new Date().toISOString().slice(0, 10);
  const lines = [`# Runbook Checklist — ${date}`, ''];
  Object.entries(byArea).sort(([a], [b]) => a.localeCompare(b)).forEach(([area, rbs]) => {
    lines.push(`\n## ${area.toUpperCase()}\n`);
    rbs.forEach(r => lines.push(`- [ ] **${r.title}** \`${r.id}\``));
  });
  const a = document.createElement('a');
  a.href = 'data:text/markdown;charset=utf-8,' + encodeURIComponent(lines.join('\n'));
  a.download = `runbooks-checklist-${date}.md`;
  a.click();
}
interface QgRow { qg_id: string; name: string | null; component_id: string | null; status: string | null; date_created: string | null; }

export const ARTIFACT_KINDS_META: { kind: ArtifactKind; color: string; icon: string }[] = [
  { kind: 'adr',     color: '#4a90d9', icon: 'scroll-quill' },
  { kind: 'spec',    color: '#4caf50', icon: 'white-book' },
  { kind: 'runbook', color: '#e8923a', icon: 'spell-book' },
  { kind: 'doc',     color: '#a974d6', icon: 'papers' },
  { kind: 'qg',      color: '#3fb8a0', icon: 'checkered-flag' },
];
const KIND_ORDER = Object.fromEntries(ARTIFACT_KINDS_META.map((k, i) => [k.kind, i])) as Record<ArtifactKind, number>;

const S = {
  root:   { flex: 1, display: 'flex', flexDirection: 'column' as const, minWidth: 0, overflow: 'hidden' },
  head:   { padding: '10px 14px', borderBottom: '1px solid var(--bd)', flexShrink: 0, display: 'flex', flexDirection: 'column' as const, gap: 8 },
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
  // Two lines per row: title gets the full row width and can wrap (no more
  // single-line ellipsis truncating it to a few characters at narrow
  // widths); the component badge + date move to a second, smaller-font
  // line underneath instead of competing with the title for horizontal
  // space.
  row: (sel: boolean, indent: number) => ({
    display: 'flex', flexDirection: 'column' as const, gap: 3, padding: '6px 14px',
    paddingLeft: 14 + indent * 14,
    borderBottom: '1px solid var(--bd)', cursor: 'pointer',
    background: sel ? 'color-mix(in srgb, var(--acc) 10%, transparent)' : 'transparent',
  }),
  rowMain: { display: 'flex', alignItems: 'flex-start', gap: 8 },
  rowMeta: { display: 'flex', alignItems: 'center', gap: 6, paddingLeft: 26 },
  badge: (color: string) => ({
    flexShrink: 0, width: 18, height: 18, borderRadius: 4, display: 'flex', alignItems: 'center', justifyContent: 'center',
    color, background: `color-mix(in srgb, ${color} 16%, transparent)`,
  }),
  title:  { flex: 1, minWidth: 0, color: 'var(--t1)', fontSize: 11.5, lineHeight: 1.3, wordBreak: 'break-word' as const },
  comp:   { fontSize: 8, padding: '1px 6px', borderRadius: 3, flexShrink: 0, background: 'color-mix(in srgb, var(--acc) 12%, transparent)', color: 'var(--acc)', whiteSpace: 'nowrap' as const },
  noComp: { fontSize: 8, padding: '1px 6px', borderRadius: 3, flexShrink: 0, background: 'var(--b2)', color: 'var(--t3)', whiteSpace: 'nowrap' as const },
  date:   { color: 'var(--t3)', fontSize: 9, marginLeft: 'auto' as const },
  empty:  { padding: 24, color: 'var(--t3)', fontSize: 12 },
  exportBtn: {
    flexShrink: 0, height: 24, padding: '0 8px', border: '1px solid var(--b3)', borderRadius: 3,
    cursor: 'pointer', fontSize: 10, background: 'var(--b2)', color: 'var(--t2)', fontFamily: 'inherit',
  },
};

interface Props {
  onError: (e: unknown) => void;
  onOpen: (kind: ArtifactKind, id: string) => void;
  selectedKind?: string;
  selectedId?: string;
  // Restrict which artifact types are fetched/shown. Omit to show all five —
  // pass a subset when this list is embedded somewhere that already has its
  // own dedicated section for some kinds (e.g. ADR and QG each have a
  // top-level nav section, so the «Знания» embedding only wants runbook+doc).
  kinds?: ArtifactKind[];
  // Portal target for the Тип/Модуль/search header — when set, the header
  // renders full-width in the caller's own layout (e.g. LorePage's
  // full-width filter bar, same slot the sprints filters use) instead of
  // being squeezed into this component's own narrow resizable list column.
  // Falls back to rendering inline above the list when omitted.
  headerContainer?: HTMLElement | null;
}

export default function LoreArtifactList({ onError, onOpen, selectedKind, selectedId, kinds, headerContainer }: Props) {
  const { t } = useTranslation();
  const ALL_ARTIFACT_KINDS: { kind: ArtifactKind; label: string; color: string; icon: string }[] = [
    { kind: 'adr',     label: 'ADR', color: '#4a90d9', icon: 'scroll-quill' },
    { kind: 'spec',    label: t('lore.artifactList.kindSpec', 'Спеки'), color: '#4caf50', icon: 'white-book' },
    { kind: 'runbook', label: t('lore.artifactList.kindRunbook', 'Runbooks'), color: '#e8923a', icon: 'spell-book' },
    { kind: 'doc',     label: t('lore.artifactList.kindDoc', 'Документы'), color: '#a974d6', icon: 'papers' },
    { kind: 'qg',      label: t('lore.artifactList.kindQg', 'Quality Gates'), color: '#3fb8a0', icon: 'checkered-flag' },
  ];
  // kinds is typically passed as a fresh array literal on every parent render
  // (e.g. kinds={['runbook','doc']}) — keying on the array reference would
  // recreate kindsFilter (and retrigger the fetch effect) on every render.
  // Key on its contents instead.
  const kindsKey = kinds ? kinds.join(',') : '';
  const kindsFilter = useMemo(() => (kinds ? new Set(kinds) : null), [kindsKey]);
  const ARTIFACT_KINDS = kindsFilter ? ALL_ARTIFACT_KINDS.filter(k => kindsFilter.has(k.kind)) : ALL_ARTIFACT_KINDS;
  const KIND_META = Object.fromEntries(ALL_ARTIFACT_KINDS.map(k => [k.kind, k])) as Record<ArtifactKind, typeof ALL_ARTIFACT_KINDS[number]>;
  const [items, setItems]     = useState<Artifact[]>([]);
  const [comps, setComps]     = useState<LoreComponent[]>([]);
  const [loading, setLoading] = useState(true);
  const [enabled, setEnabled] = useState<Set<ArtifactKind>>(new Set(ARTIFACT_KINDS.map(k => k.kind)));
  const [compSel, setCompSel] = useState<Set<string>>(new Set());
  const [q, setQ]             = useState('');

  // Keep `enabled` in sync if the set of kinds this instance shows ever changes.
  useEffect(() => {
    setEnabled(new Set(kindsFilter ? ALL_ARTIFACT_KINDS.filter(k => kindsFilter.has(k.kind)).map(k => k.kind) : ALL_ARTIFACT_KINDS.map(k => k.kind)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kindsKey]);

  useEffect(() => {
    setLoading(true);
    const ctrl = new AbortController();
    // Resilient load: a slice that errors (e.g. a not-yet-ingested type → 502)
    // contributes nothing rather than failing the whole list.
    const safe = <T,>(p: Promise<T[]>): Promise<T[]> => p.catch(() => [] as T[]);
    const want = (k: ArtifactKind) => !kindsFilter || kindsFilter.has(k);
    Promise.all([
      want('adr')     ? safe(fetchLoreSlice<LoreAdrRow>('adrs', undefined, ctrl.signal))          : Promise.resolve([]),
      want('spec')    ? safe(fetchLoreSlice<LoreSpecRow>('specs', undefined, ctrl.signal))         : Promise.resolve([]),
      want('runbook') ? safe(fetchLoreSlice<RunbookRow>('runbooks', undefined, ctrl.signal))        : Promise.resolve([]),
      want('doc')     ? safe(fetchLoreSlice<LoreKnowDocRow>('docs', undefined, ctrl.signal))        : Promise.resolve([]),
      want('qg')      ? safe(fetchLoreSlice<QgRow>('quality_gates', undefined, ctrl.signal))        : Promise.resolve([]),
      safe(fetchLoreSlice<LoreComponent>('components', undefined, ctrl.signal)),
    ])
      .then(([adrs, specs, runbooks, docs, qgs, components]) => {
        if (ctrl.signal.aborted) return;
        const all: Artifact[] = [
          ...adrs.map(r => ({ kind: 'adr' as const, id: r.adr_id, title: r.adr_id, component: r.component ?? null, date: r.date_created ?? null })),
          ...specs.map(r => ({ kind: 'spec' as const, id: r.spec_id, title: (r.title && r.title.trim()) || r.spec_id.replace(/[_-]+/g, ' '), component: r.component_id ?? null, date: null })),
          // Runbooks have no component_id — reuse the `component` slot for
          // `area` so the existing "Модуль" facet also restores the
          // area-based filtering the old LoreRunbookList had.
          ...runbooks.map(r => ({ kind: 'runbook' as const, id: r.runbook_id, title: r.name || r.runbook_id, component: r.area ?? null, date: r.date_created ?? null })),
          ...docs.map(r => ({
            kind: 'doc' as const, id: r.doc_id, title: (r.title && r.title.trim()) || r.doc_id,
            component: r.component_id ?? null, date: null,
            parentId: r.parent_doc_id, sortOrder: r.sort_order,
          })),
          ...qgs.map(r => ({ kind: 'qg' as const, id: r.qg_id, title: r.name || r.qg_id, component: r.component_id ?? null, date: r.date_created ?? null })),
        ];
        setItems(all); setComps(components); setLoading(false);
      })
      .catch(e => { onError(e); setLoading(false); });
    return () => ctrl.abort();
  }, [onError, kindsFilter]);

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
      .map(([id, n]) => ({ id, name: id === '∅' ? t('lore.artifactList.noComponent', '— без компонента') : (nameOf[id] || id), n }))
      .sort((a, b) => b.n - a.n || a.name.localeCompare(b.name));
  }, [items, enabled, nameOf]);

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    items.forEach(a => { c[a.kind] = (c[a.kind] || 0) + 1; });
    return c;
  }, [items]);

  // doc-id -> Artifact, built from the unfiltered set so a page's tree
  // position is stable even when search/component filters hide its parent.
  const docById = useMemo(() => {
    const m = new Map<string, Artifact>();
    items.forEach(a => { if (a.kind === 'doc') m.set(a.id, a); });
    return m;
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
        // DeepWiki-style page tree: order docs by path (root sort_order,
        // then each ancestor's, root-to-leaf) so a parent is immediately
        // followed by its children instead of pure alphabetical — same idea
        // as LoreComponentTree's byParent recursion, but flattened into a
        // sort key since this list has no per-row expand/collapse state.
        if (a.kind === 'doc' && b.kind === 'doc') {
          const pa = docPath(a.id, docById);
          const pb = docPath(b.id, docById);
          const len = Math.min(pa.length, pb.length);
          for (let i = 0; i < len; i++) {
            if (pa[i] !== pb[i]) return pa[i] - pb[i];
          }
          if (pa.length !== pb.length) return pa.length - pb.length;
        }
        return a.title.localeCompare(b.title);
      });
  }, [items, enabled, compSel, q, nameOf, docById]);

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

  if (loading) return <div style={S.empty}>{t('lore.artifactList.loading', 'Загрузка артефактов…')}</div>;

  const header = (
    <div style={headerContainer ? { ...S.head, border: 'none' } : S.head}>
      <div style={S.chipRow}>
        <span style={S.flabel}>{t('lore.artifactList.typeLabel', 'Тип')}</span>
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
          <span style={S.flabel}>{t('lore.artifactList.moduleLabel', 'Модуль')}</span>
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
      <div style={S.chipRow}>
        <input
          style={S.search}
          placeholder={t('lore.artifactList.searchPlaceholder', 'Поиск по названию…')}
          value={q}
          onChange={e => setQ(e.target.value)}
        />
        {enabled.has('runbook') && shown.some(a => a.kind === 'runbook') && (
          <button
            style={S.exportBtn}
            title={t('lore.artifactList.exportRunbooksTitle', 'Экспорт чеклиста runbooks в Markdown')}
            onClick={() => exportRunbooksMd(shown.filter(a => a.kind === 'runbook'))}
          >
            ↓ MD
          </button>
        )}
      </div>
    </div>
  );

  return (
    <div style={S.root}>
      {headerContainer ? createPortal(header, headerContainer) : header}

      <div style={S.list}>
        {shown.length === 0 && <div style={S.empty}>{t('lore.artifactList.notFound', 'Ничего не найдено.')}</div>}
        {shown.map(a => {
          const meta = KIND_META[a.kind];
          const sel = selectedKind === a.kind && selectedId === a.id;
          const indent = a.kind === 'doc' ? Math.max(0, docPath(a.id, docById).length - 1) : 0;
          return (
            <div key={`${a.kind}:${a.id}`} style={S.row(sel, indent)} onClick={() => onOpen(a.kind, a.id)} title={`${meta.label} · ${a.id}`}>
              <div style={S.rowMain}>
                <span style={S.badge(meta.color)}><GameIcon slug={meta.icon} size={11} /></span>
                <span style={S.title}>{a.title}</span>
              </div>
              <div style={S.rowMeta}>
                {a.component
                  ? <span style={S.comp}>{nameOf[a.component] || a.component}</span>
                  : <span style={S.noComp}>—</span>}
                {a.date && <span style={S.date}>{a.date.slice(0, 10)}</span>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
