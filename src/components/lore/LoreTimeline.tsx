import { useEffect, useState } from 'react';
import { fetchLoreSlice, type LoreTimelineItem } from '../../api/lore';
import { StatusChip } from '../../pages/LorePage';
import { GameIcon } from './GameIcon';

// game-icons slugs per timeline kind (uniform with the sidebar sections)
const KIND_ICON: Record<string, string> = {
  adr: 'scroll-quill', decision: 'vote', release: 'rocket', sprint: 'sprint',
};

const S = {
  root:    { flex: 1, overflowY: 'auto' as const },
  item: {
    display: 'flex', alignItems: 'center', gap: 8,
    padding: '7px 16px', borderBottom: '1px solid var(--bd)',
    fontSize: 12, cursor: 'default',
  },
  date:    { color: 'var(--t3)', fontSize: 11, minWidth: 80, flexShrink: 0 },
  icon:    { fontSize: 14, flexShrink: 0 },
  kind:    { color: 'var(--t3)', fontSize: 10, minWidth: 62, flexShrink: 0, textTransform: 'uppercase' as const },
  ref:     { color: 'var(--acc)', fontSize: 11, minWidth: 130, flexShrink: 0 },
  title:   { flex: 1, color: 'var(--t1)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const },
  loading: { padding: 24, color: 'var(--t3)', fontSize: 12 },
  empty:   { padding: 24, color: 'var(--t3)', fontSize: 12 },
};

interface AdrRow  { adr_id: string; date_created: string; component?: string }
interface DecRow  { decision_id: string; title: string; date_created: string }
interface RelRow  { release_id: string; git_tag?: string; release_date?: string }
interface SprRow  { sprint_id: string; name?: string; valid_from?: string; status_raw?: string | null }

// Normalize sprint status by leading marker (a "DONE" later in the line must not flip it).
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
  const [items, setItems]     = useState<LoreTimelineItem[]>([]);
  const [loading, setLoading] = useState(true);

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

      const filtered = q
        ? merged.filter(i =>
            i.title.toLowerCase().includes(q.toLowerCase()) ||
            i.ref_id.toLowerCase().includes(q.toLowerCase()))
        : merged;

      const byModule = module
        ? filtered.filter(i => i.kind !== 'adr' || i.status === module)
        : filtered;

      setItems(byModule);
      setLoading(false);
    }).catch(e => { onError(e); setLoading(false); });

    return () => ctrl.abort();
  }, [module, q, onError]);

  if (loading) return <div style={S.loading}>Загрузка событий…</div>;
  if (!items.length) return <div style={S.empty}>Событий не найдено.</div>;

  return (
    <div style={S.root}>
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
  );
}
