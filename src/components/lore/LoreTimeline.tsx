import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { a11yClick } from './a11y';
import { fetchLoreSlice, type LoreTimelineItem } from '../../api/lore';
import { StatusChip } from '../../pages/LorePage';
import { GameIcon } from './GameIcon';

// game-icons slugs per timeline kind (uniform with the sidebar sections)
const KIND_ICON: Record<string, string> = {
  adr: 'scroll-quill', decision: 'vote', release: 'rocket', sprint: 'sprint',
};
const ALL_KINDS = ['adr', 'decision', 'release', 'sprint'] as const;
type Kind = typeof ALL_KINDS[number];

const S = {
  root:    { flex: 1, display: 'flex', flexDirection: 'column' as const, overflow: 'hidden' },
  toolbar: {
    display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' as const,
    padding: '6px 12px', borderBottom: '1px solid var(--bd)', flexShrink: 0,
  },
  chip: (on: boolean) => ({
    display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer',
    padding: '2px 8px', borderRadius: 10, fontSize: 'var(--fs-xs)',
    border: `1px solid ${on ? 'var(--acc)' : 'var(--b3)'}`,
    background: on ? 'color-mix(in srgb, var(--acc) 14%, transparent)' : 'transparent',
    color: on ? 'var(--t1)' : 'var(--t3)',
    userSelect: 'none' as const,
  }),
  list:    { flex: 1, overflowY: 'auto' as const },
  item: {
    display: 'flex', alignItems: 'center', gap: 8,
    padding: '7px 16px', borderBottom: '1px solid var(--bd)',
    fontSize: 'var(--fs-base)', cursor: 'default',
  },
  date:    { color: 'var(--t3)', fontSize: 'var(--fs-sm)', minWidth: 80, flexShrink: 0 },
  icon:    { fontSize: 'var(--fs-lg)', flexShrink: 0 },
  kind:    { color: 'var(--t3)', fontSize: 'var(--fs-xs)', minWidth: 62, flexShrink: 0, textTransform: 'uppercase' as const },
  ref:     { color: 'var(--acc)', fontSize: 'var(--fs-sm)', minWidth: 130, flexShrink: 0 },
  title:   { flex: 1, color: 'var(--t1)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const },
  loading: { padding: 24, color: 'var(--t3)', fontSize: 'var(--fs-base)' },
  empty:   { padding: 24, color: 'var(--t3)', fontSize: 'var(--fs-base)' },
};

interface AdrRow  { adr_id: string; date_created: string; component?: string }
interface DecRow  { decision_id: string; title: string; date_created: string }
interface RelRow  { release_id: string; git_tag?: string; release_date?: string }
interface SprRow  { sprint_id: string; name?: string; valid_from?: string; status_raw?: string | null }

function normalizeSprintStatus(raw: string | null | undefined): string {
  if (!raw) return '';
  const s = raw.trimStart();
  if (s.startsWith('✅') || /^(DONE|CLOSED|ЗАВЕРШ|MERGED|ЗАКРЫТ)/i.test(s)) return 'done';
  if (s.startsWith('🔄') || s.startsWith('🟡') || s.startsWith('🟢') ||
      /^(IN.?PROGRESS|WIP|ACTIVE|PARTIAL|READY)/i.test(s)) return 'in_progress';
  if (s.startsWith('📋') || s.startsWith('⬜') || /^(TODO|PLANNED|STUB|DRAFT)/i.test(s)) return 'planned';
  if (s.startsWith('🟣') || s.startsWith('⏸') || /^(BACKLOG|DEFERRED|BLOCKED|ARCHIVED)/i.test(s)) return 'deferred';
  return '';
}

interface Props {
  module: string;
  q: string;
  onError: (e: unknown) => void;
  onSelect: (id: string) => void;
  onSelectSprint?: (id: string) => void;
}

export default function LoreTimeline({ module, q, onError, onSelect, onSelectSprint }: Props) {
  const { t } = useTranslation();
  const KIND_LABEL: Record<string, string> = {
    adr: 'ADR',
    decision: t('lore.timeline.kindDecision', 'Решения'),
    release: t('lore.timeline.kindRelease', 'Релизы'),
    sprint: t('lore.timeline.kindSprint', 'Спринты'),
  };
  const [allItems, setAllItems] = useState<LoreTimelineItem[]>([]);
  const [loading, setLoading]   = useState(true);
  const [kindSel, setKindSel]   = useState<Set<Kind>>(new Set());

  useEffect(() => {
    setLoading(true);
    const ctrl = new AbortController();

    Promise.all([
      fetchLoreSlice<AdrRow>('timeline_adrs', undefined, ctrl.signal),
      fetchLoreSlice<DecRow>('timeline_decisions', undefined, ctrl.signal),
      fetchLoreSlice<RelRow>('timeline_releases', undefined, ctrl.signal),
      fetchLoreSlice<SprRow>('timeline_sprints', undefined, ctrl.signal),
    ]).then(([adrs, decs, rels, sprs]) => {
      const merged: LoreTimelineItem[] = [
        ...adrs.map(a => ({
          date: a.date_created ?? '',
          kind: 'adr' as const,
          ref_id: a.adr_id,
          title: a.adr_id,
          status: a.component ?? '',
        })),
        ...decs.map(d => ({
          date: d.date_created ?? '',
          kind: 'decision' as const,
          ref_id: d.decision_id,
          title: d.title ?? d.decision_id,
          status: '',
        })),
        ...rels.map(r => ({
          date: r.release_date?.slice(0, 10) ?? '',
          kind: 'release' as const,
          ref_id: r.release_id,
          title: r.git_tag ?? r.release_id,
          status: '',
        })),
        ...sprs.map(s => ({
          date: s.valid_from?.slice(0, 10) ?? '',
          kind: 'sprint' as const,
          ref_id: s.sprint_id,
          title: s.name ?? s.sprint_id,
          status: normalizeSprintStatus(s.status_raw),
        })),
      ];
      merged.sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''));
      setAllItems(merged);
      setLoading(false);
    }).catch(e => { onError(e); setLoading(false); });

    return () => ctrl.abort();
  }, [onError]);

  const items = useMemo(() => {
    const ql = q.toLowerCase();
    return allItems
      .filter(i => kindSel.size === 0 || kindSel.has(i.kind as Kind))
      .filter(i => !module || i.kind !== 'adr' || i.status === module)
      .filter(i => !ql || i.title.toLowerCase().includes(ql) || i.ref_id.toLowerCase().includes(ql));
  }, [allItems, kindSel, module, q]);

  function toggleKind(k: Kind) {
    setKindSel(prev => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k); else next.add(k);
      return next;
    });
  }

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    allItems.forEach(i => { c[i.kind] = (c[i.kind] || 0) + 1; });
    return c;
  }, [allItems]);

  return (
    <div style={S.root}>
      <div style={S.toolbar}>
        {ALL_KINDS.map(k => {
          const on = kindSel.has(k);
          return (
            <span key={k} style={S.chip(on)} {...a11yClick(() => toggleKind(k))} aria-pressed={on}>
              <GameIcon slug={KIND_ICON[k]} size={11} />
              {KIND_LABEL[k]}
              <span style={{ opacity: 0.6, fontSize: 'var(--fs-2xs)' }}>{counts[k] ?? 0}</span>
            </span>
          );
        })}
        {module && (
          <span style={{ fontSize: 'var(--fs-2xs)', color: 'var(--t3)', marginLeft: 4 }}>
            {t('lore.timeline.moduleFilter', '· фильтр по модулю {{module}} — только ADR', { module })}
          </span>
        )}
      </div>
      <div style={S.list}>
        {loading && <div style={S.loading}>{t('lore.timeline.loading', 'Загрузка событий…')}</div>}
        {!loading && !items.length && <div style={S.empty}>{t('lore.timeline.empty', 'Событий не найдено.')}</div>}
        {items.map((item, i) => {
          const isSprint  = item.kind === 'sprint';
          const clickable = item.kind === 'adr' || item.kind === 'decision'
            || (isSprint && !!onSelectSprint);
          return (
            <div
              key={`${item.kind}-${item.ref_id}-${i}`}
              style={{ ...S.item, cursor: clickable ? 'pointer' : 'default' }}
              onClick={() => {
                if (isSprint) onSelectSprint?.(item.ref_id);
                else if (item.kind === 'adr' || item.kind === 'decision') onSelect(item.ref_id);
              }}
            >
              <span style={S.date}>{item.date?.slice(0, 10)}</span>
              <span style={S.icon}><GameIcon slug={KIND_ICON[item.kind]} size={14} /></span>
              <span style={S.kind}>{item.kind}</span>
              <span style={S.ref}>{item.ref_id}</span>
              <span style={S.title}>{item.title}</span>
              {item.status && <StatusChip status={item.status} />}
            </div>
          );
        })}
      </div>
    </div>
  );
}
