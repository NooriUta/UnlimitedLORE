import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { fetchLoreSlice } from '../../api/lore';
import { FilterBar, type FilterTagData } from './FilterPrimitives';
import { EmptyState } from './EmptyState';

interface QGRow {
  qg_id: string;
  name: string;
  description: string | null;
  component_id: string | null;
  status: string | null;          // lifecycle: active/draft/deprecated/closed
  last_run_status: string | null; // run result: active/blocked
  date_created: string | null;
  sprint_id?: string | null;
}

type TFn = (key: string, fallback: string) => string;

const STATUS_COLOR: Record<string, string> = {
  active:     'var(--suc)',
  draft:      'var(--wrn)',
  archived:   'var(--t3)',
  deprecated: 'var(--t3)',
  closed:     'var(--t3)',
};

const statusMetaOf = (t: TFn, s: string): { color: string; label: string } => ({
  color: STATUS_COLOR[s] ?? 'var(--t3)',
  label: t(`lore.qualityGateList.status.${s}`, {
    active: 'активен', draft: 'черновик', archived: 'архив', deprecated: 'устарел', closed: 'закрыт',
  }[s] ?? s),
});

const RUN_COLOR: Record<string, string> = {
  active:  'var(--suc)',
  blocked: 'var(--danger)',
};

const runMetaOf = (t: TFn, s: string): { color: string; label: string } | undefined => {
  if (!(s in RUN_COLOR)) return undefined;
  return {
    color: RUN_COLOR[s],
    label: t(`lore.qualityGateList.run.${s}`, { active: '✓ pass', blocked: '✗ fail' }[s] ?? s),
  };
};

function exportHtml(rows: QGRow[], t: TFn) {
  const active = rows.filter(r => r.status === 'active' || !r.status);
  const date   = new Date().toISOString().slice(0, 10);
  const dateLabel   = t('lore.qualityGateList.export.date', 'Дата');
  const activeLabel = t('lore.qualityGateList.export.active', 'Активных');
  const totalLabel  = t('lore.qualityGateList.export.total', 'всего');
  const html = `<!DOCTYPE html>
<html lang="ru">
<head><meta charset="utf-8"><title>Quality Gates Report ${date}</title>
<style>
body{font-family:monospace;padding:24px;max-width:960px;margin:0 auto;color:#ccc;background:#1a1a1a}
h1{font-size:16px;margin-bottom:4px;color:#fff}
.sub{font-size:11px;color:#888;margin-bottom:20px}
.gate{border:1px solid #333;border-radius:4px;margin-bottom:10px;padding:12px}
.gate-id{color:#666;font-size:10px}
.gate-name{font-weight:600;color:#fff;margin:3px 0}
.gate-meta{font-size:10px;color:#777}
.gate-desc{font-size:11px;color:#bbb;margin-top:6px}
</style></head>
<body>
<h1>Quality Gates — Snapshot</h1>
<div class="sub">${dateLabel}: ${date} · ${activeLabel}: ${active.length} / ${totalLabel}: ${rows.length}</div>
${active.map(qg => `<div class="gate">
  <div class="gate-id">${qg.qg_id}</div>
  <div class="gate-name">${qg.name}</div>
  <div class="gate-meta">${[qg.component_id, qg.sprint_id, qg.date_created?.slice(0,10)].filter(Boolean).join(' · ')}</div>
  ${qg.description ? `<div class="gate-desc">${qg.description}</div>` : ''}
</div>`).join('\n')}
</body></html>`;
  const a = document.createElement('a');
  a.href = 'data:text/html;charset=utf-8,' + encodeURIComponent(html);
  a.download = `qg-report-${date}.html`;
  a.click();
}

interface Props {
  onError: (e: unknown) => void;
  onOpen?: (id: string) => void;
}

export default function LoreQualityGateList({ onError, onOpen }: Props) {
  const { t } = useTranslation();
  const [rows, setRows]           = useState<QGRow[]>([]);
  const [loading, setLoading]     = useState(true);
  const [statusSel, setStatusSel] = useState<Set<string>>(new Set());
  const [compSel, setCompSel]     = useState<Set<string>>(new Set());
  const [q, setQ]                 = useState('');
  // T34: same collapsible-band pattern as the sprint/ADR/component bars in LorePage.tsx
  const [filterOpen, setFilterOpen] = useState(false);

  useEffect(() => {
    setLoading(true);
    const ctrl = new AbortController();
    fetchLoreSlice<QGRow>('quality_gates', undefined, ctrl.signal)
      .then(r => { setRows(r); setLoading(false); })
      .catch(e => { onError(e); setLoading(false); });
    return () => ctrl.abort();
  }, [onError]);

  // Derived filter options
  const allStatuses = [...new Set(rows.map(r => r.status).filter(Boolean))] as string[];
  const allComps    = [...new Set(rows.map(r => r.component_id).filter(Boolean))].sort() as string[];

  // Stats by status — T03
  const statsByStatus = allStatuses.map(s => ({
    s, n: rows.filter(r => r.status === s).length,
    m: statusMetaOf(t, s),
  }));

  const ql = q.trim().toLowerCase();
  const shown = rows.filter(r =>
    (statusSel.size === 0 || statusSel.has(r.status ?? '')) &&
    (compSel.size   === 0 || compSel.has(r.component_id ?? '')) &&
    (ql === '' ||
      r.qg_id.toLowerCase().includes(ql) ||
      r.name.toLowerCase().includes(ql) ||
      (r.description ?? '').toLowerCase().includes(ql) ||
      (r.component_id ?? '').toLowerCase().includes(ql))
  );

  const toggleStatus = (s: string) =>
    setStatusSel(prev => { const n = new Set(prev); n.has(s) ? n.delete(s) : n.add(s); return n; });
  const toggleComp = (c: string) =>
    setCompSel(prev => { const n = new Set(prev); n.has(c) ? n.delete(c) : n.add(c); return n; });

  if (loading) return <div style={S.state}>{t('lore.qualityGateList.loading', 'Загрузка quality gates…')}</div>;

  return (
    <div style={S.root}>
      {/* Search — unifies with ADR/sprint/component list panels (F-03) */}
      <div style={S.searchRow}>
        <span style={{ color: 'var(--t3)', fontSize: 12, flexShrink: 0 }}>🔍</span>
        <input
          style={S.searchInput}
          placeholder={t('lore.qualityGateList.searchPlaceholder', 'quality gate…')}
          aria-label={t('lore.qualityGateList.searchAriaLabel', 'поиск по quality gates')}
          value={q}
          onChange={e => setQ(e.target.value)}
        />
        {q && (
          <span onClick={() => setQ('')} role="button" tabIndex={0}
            onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setQ(''); } }}
            aria-label={t('lore.qualityGateList.searchClear', 'очистить поиск')}
            style={{ color: 'var(--t3)', cursor: 'pointer', fontSize: 11, flexShrink: 0 }}>✕</span>
        )}
      </div>

      {/* Stats bar — T03 */}
      <div style={S.statsBar}>
        <span style={S.statTotal}>{rows.length}</span>
        <span style={{ color: 'var(--t3)', fontSize: 10 }}>{t('lore.qualityGateList.total', 'всего')}</span>
        {statsByStatus.map(({ s, n, m }) => {
          const on = statusSel.has(s);
          return (
            <span
              key={s}
              onClick={() => toggleStatus(s)}
              style={{
                ...S.statBadge(m.color),
                cursor: 'pointer',
                background: on ? `color-mix(in srgb, ${m.color} 22%, transparent)` : `color-mix(in srgb, ${m.color} 10%, transparent)`,
                border: `1px solid color-mix(in srgb, ${m.color} ${on ? 45 : 25}%, transparent)`,
                fontWeight: on ? 700 : 400,
                opacity: statusSel.size > 0 && !on ? 0.45 : 1,
              }}
            >
              {m.label} <b>{n}</b>
            </span>
          );
        })}
        <span style={{ flex: 1 }} />
        <button style={S.exportBtn} onClick={() => exportHtml(rows, t)} title={t('lore.qualityGateList.exportTitle', 'Экспорт активных QG в HTML')}>
          {t('lore.qualityGateList.exportBtn', '↓ HTML')}
        </button>
      </div>

      {/* Filters — one collapsible band, one-line summary when closed (T34) */}
      {(allStatuses.length > 1 || allComps.length > 1) && (
        <FilterBar
          tier="local"
          label={t('lore.qualityGateList.filtersLabel', 'Фильтры')}
          activeCount={statusSel.size + compSel.size}
          summaryTags={[
            ...[...statusSel].map((s): FilterTagData => ({
              key: 's:' + s, label: statusMetaOf(t, s).label, color: statusMetaOf(t, s).color,
              onRemove: () => setStatusSel(prev => { const n = new Set(prev); n.delete(s); return n; }),
            })),
            ...[...compSel].map((c): FilterTagData => ({
              key: 'c:' + c, label: c,
              onRemove: () => setCompSel(prev => { const n = new Set(prev); n.delete(c); return n; }),
            })),
          ]}
          onClear={() => { setStatusSel(new Set()); setCompSel(new Set()); }}
          open={filterOpen}
          onToggleOpen={() => setFilterOpen(v => !v)}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {allStatuses.length > 1 && (
              <div style={S.filterRow}>
                <span style={S.filterLabel}>{t('lore.qualityGateList.statusLabel', 'Статус')}</span>
                {allStatuses.map(s => {
                  const m  = statusMetaOf(t, s);
                  const on = statusSel.has(s);
                  return (
                    <span key={s} style={S.chip(on, m.color)} onClick={() => toggleStatus(s)}>
                      {m.label}
                      <span style={{ fontSize: 9, opacity: 0.6 }}>{rows.filter(r => r.status === s).length}</span>
                    </span>
                  );
                })}
              </div>
            )}
            {allComps.length > 1 && (
              <div style={S.filterRow}>
                <span style={S.filterLabel}>{t('lore.qualityGateList.moduleLabel', 'Модуль')}</span>
                {allComps.map(c => {
                  const on = compSel.has(c);
                  return (
                    <span key={c} style={S.chip(on, 'var(--acc)')} onClick={() => toggleComp(c)}>
                      {c}
                      <span style={{ fontSize: 9, opacity: 0.6 }}>{rows.filter(r => r.component_id === c).length}</span>
                    </span>
                  );
                })}
              </div>
            )}
          </div>
        </FilterBar>
      )}

      {/* List — selecting a row opens the full ADR-QG-004 report in LoreQGDetail */}
      <div style={S.list}>
        {shown.map(qg => (
          <div key={qg.qg_id} style={S.row} onClick={() => onOpen?.(qg.qg_id)}>
            <span style={S.arrow}>→</span>
            {qg.status && (
              <span style={S.statusChip(qg.status)}>
                {statusMetaOf(t, qg.status).label}
              </span>
            )}
            {qg.last_run_status && runMetaOf(t, qg.last_run_status) && (
              <span style={{ fontSize: 9, fontWeight: 700, padding: '1px 5px', borderRadius: 3,
                color: runMetaOf(t, qg.last_run_status)!.color,
                background: `color-mix(in srgb,${runMetaOf(t, qg.last_run_status)!.color} 12%,transparent)` }}>
                {runMetaOf(t, qg.last_run_status)!.label}
              </span>
            )}
            <span style={S.id}>{qg.qg_id}</span>
            <span style={S.name}>{qg.name}</span>
            {qg.component_id && <span style={S.comp}>{qg.component_id}</span>}
            <span style={S.date}>{qg.date_created?.slice(0, 10) ?? ''}</span>
          </div>
        ))}
        {shown.length === 0 && <EmptyState message={t('lore.qualityGateList.empty', 'Quality Gates не найдены.')} />}
      </div>
    </div>
  );
}

const S = {
  root:  { flex: 1, display: 'flex', flexDirection: 'column' as const, overflow: 'hidden' },
  state: { padding: 24, color: 'var(--t3)', fontSize: 12 },
  searchRow: {
    display: 'flex', alignItems: 'center', gap: 6,
    padding: '0 12px', height: 30, flexShrink: 0,
    borderBottom: '1px solid var(--bd)',
  },
  searchInput: {
    flex: 1, background: 'transparent', border: 'none', outline: 'none',
    color: 'var(--t1)', fontSize: 11, fontFamily: 'var(--mono)',
  },
  // Stats bar — T03
  statsBar: {
    display: 'flex', alignItems: 'center', gap: 8,
    padding: '5px 14px', borderBottom: '1px solid var(--bd)', flexShrink: 0,
    flexWrap: 'wrap' as const,
  },
  statTotal: { fontSize: 15, fontWeight: 600, color: 'var(--t1)', lineHeight: 1 },
  statBadge: (color: string) => ({
    fontSize: 10, padding: '1px 7px', borderRadius: 10,
    background: `color-mix(in srgb, ${color} 14%, transparent)`,
    color, border: `1px solid color-mix(in srgb, ${color} 28%, transparent)`,
  }),
  exportBtn: {
    height: 22, padding: '0 8px', border: '1px solid var(--b3)', borderRadius: 3,
    cursor: 'pointer', fontSize: 10, background: 'var(--b2)', color: 'var(--t2)',
    fontFamily: 'inherit',
  },
  // Filter chips — T01
  filterRow: {
    display: 'flex', alignItems: 'center', gap: 5, flexWrap: 'wrap' as const,
    padding: '4px 14px', borderBottom: '1px solid var(--bd)', flexShrink: 0,
  },
  filterLabel: { fontSize: 9, color: 'var(--t3)', textTransform: 'uppercase' as const, letterSpacing: 0.5, flexShrink: 0 },
  chip: (on: boolean, color: string) => ({
    display: 'inline-flex', alignItems: 'center', gap: 4,
    fontSize: 10, padding: '1px 7px', borderRadius: 10, cursor: 'pointer', userSelect: 'none' as const,
    border: `1px solid ${on ? color : 'var(--b3)'}`,
    background: on ? `color-mix(in srgb, ${color} 20%, transparent)` : 'transparent',
    color: on ? color : 'var(--t3)',
  }),
  reset: { fontSize: 10, color: 'var(--t3)', cursor: 'pointer', padding: '0 4px' },
  list:  { flex: 1, overflowY: 'auto' as const },
  row: {
    display: 'flex', alignItems: 'center', gap: 8,
    padding: '7px 14px', borderBottom: '1px solid var(--bd)',
    fontSize: 12, cursor: 'pointer',
  },
  arrow:  { color: 'var(--t3)', fontSize: 11, width: 12, flexShrink: 0 },
  statusChip: (s: string) => {
    const color = STATUS_COLOR[s] ?? 'var(--t3)';
    return {
      fontSize: 9, padding: '1px 5px', borderRadius: 3, flexShrink: 0,
      background: `color-mix(in srgb, ${color} 16%, transparent)`,
      color,
      border: `1px solid color-mix(in srgb, ${color} 28%, transparent)`,
    };
  },
  id:          { color: 'var(--t3)', fontSize: 11, minWidth: 140, flexShrink: 0 },
  name:        { flex: 1, color: 'var(--t1)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const },
  comp:        { color: 'var(--acc)', fontSize: 11, flexShrink: 0 },
  date:        { color: 'var(--t3)', fontSize: 11, flexShrink: 0 },
};
