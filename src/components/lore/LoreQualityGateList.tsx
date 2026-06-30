import { useEffect, useState } from 'react';
import { fetchLoreSlice } from '../../api/lore';

interface QGRow {
  qg_id: string;
  name: string;
  description: string | null;
  component_id: string | null;
  status: string | null;
  date_created: string | null;
  sprint_id?: string | null;
}

interface QGMetricRow {
  metric_id: string;
  name: string;
  threshold: string;
}

const STATUS_META: Record<string, { color: string; label: string }> = {
  active:     { color: 'var(--suc)',    label: 'активен'  },
  draft:      { color: 'var(--wrn)',    label: 'черновик' },
  archived:   { color: 'var(--t3)',     label: 'архив'    },
  deprecated: { color: 'var(--danger)', label: 'устарел'  },
};

function exportHtml(rows: QGRow[]) {
  const active = rows.filter(r => r.status === 'active' || !r.status);
  const date   = new Date().toISOString().slice(0, 10);
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
<div class="sub">Дата: ${date} · Активных: ${active.length} / всего: ${rows.length}</div>
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
  const [rows, setRows]           = useState<QGRow[]>([]);
  const [loading, setLoading]     = useState(true);
  const [expanded, setExpanded]   = useState<string | null>(null);
  const [metrics, setMetrics]     = useState<Record<string, QGMetricRow[]>>({});
  const [statusSel, setStatusSel] = useState<Set<string>>(new Set());
  const [compSel, setCompSel]     = useState<Set<string>>(new Set());

  useEffect(() => {
    setLoading(true);
    const ctrl = new AbortController();
    fetchLoreSlice<QGRow>('quality_gates', undefined, ctrl.signal)
      .then(r => { setRows(r); setLoading(false); })
      .catch(e => { onError(e); setLoading(false); });
    return () => ctrl.abort();
  }, [onError]);

  const handleRowClick = (qgId: string) => {
    if (onOpen) { onOpen(qgId); return; }
    if (expanded === qgId) { setExpanded(null); return; }
    setExpanded(qgId);
    if (!metrics[qgId]) {
      fetchLoreSlice<QGMetricRow>('qg_metrics', { qg_id: qgId })
        .then(r => setMetrics(m => ({ ...m, [qgId]: r })))
        .catch(onError);
    }
  };

  // Derived filter options
  const allStatuses = [...new Set(rows.map(r => r.status).filter(Boolean))] as string[];
  const allComps    = [...new Set(rows.map(r => r.component_id).filter(Boolean))].sort() as string[];

  // Stats by status — T03
  const statsByStatus = allStatuses.map(s => ({
    s, n: rows.filter(r => r.status === s).length,
    m: STATUS_META[s] ?? { color: 'var(--t3)', label: s },
  }));

  const shown = rows.filter(r =>
    (statusSel.size === 0 || statusSel.has(r.status ?? '')) &&
    (compSel.size   === 0 || compSel.has(r.component_id ?? ''))
  );

  const toggleStatus = (s: string) =>
    setStatusSel(prev => { const n = new Set(prev); n.has(s) ? n.delete(s) : n.add(s); return n; });
  const toggleComp = (c: string) =>
    setCompSel(prev => { const n = new Set(prev); n.has(c) ? n.delete(c) : n.add(c); return n; });

  if (loading) return <div style={S.state}>Загрузка quality gates…</div>;

  return (
    <div style={S.root}>
      {/* Stats bar — T03 */}
      <div style={S.statsBar}>
        <span style={S.statTotal}>{rows.length}</span>
        <span style={{ color: 'var(--t3)', fontSize: 10 }}>всего</span>
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
        <button style={S.exportBtn} onClick={() => exportHtml(rows)} title="Экспорт активных QG в HTML">
          ↓ HTML
        </button>
      </div>

      {/* Filters — T01: status chips */}
      {allStatuses.length > 1 && (
        <div style={S.filterRow}>
          <span style={S.filterLabel}>Статус</span>
          {allStatuses.map(s => {
            const m  = STATUS_META[s] ?? { color: 'var(--t3)', label: s };
            const on = statusSel.has(s);
            return (
              <span key={s} style={S.chip(on, m.color)} onClick={() => toggleStatus(s)}>
                {m.label}
                <span style={{ fontSize: 9, opacity: 0.6 }}>{rows.filter(r => r.status === s).length}</span>
              </span>
            );
          })}
          {statusSel.size > 0 && <span style={S.reset} onClick={() => setStatusSel(new Set())}>✕</span>}
        </div>
      )}

      {/* Filters — T01: component chips */}
      {allComps.length > 1 && (
        <div style={S.filterRow}>
          <span style={S.filterLabel}>Модуль</span>
          {allComps.map(c => {
            const on = compSel.has(c);
            return (
              <span key={c} style={S.chip(on, 'var(--acc)')} onClick={() => toggleComp(c)}>
                {c}
                <span style={{ fontSize: 9, opacity: 0.6 }}>{rows.filter(r => r.component_id === c).length}</span>
              </span>
            );
          })}
          {compSel.size > 0 && <span style={S.reset} onClick={() => setCompSel(new Set())}>✕</span>}
        </div>
      )}

      {/* List */}
      <div style={S.list}>
        {shown.map(qg => (
          <div key={qg.qg_id}>
            <div style={S.row(expanded === qg.qg_id)} onClick={() => handleRowClick(qg.qg_id)}>
              <span style={S.arrow}>{onOpen ? '→' : expanded === qg.qg_id ? '▾' : '▸'}</span>
              {qg.status && (
                <span style={S.statusChip(qg.status)}>
                  {(STATUS_META[qg.status] ?? { label: qg.status }).label}
                </span>
              )}
              <span style={S.id}>{qg.qg_id}</span>
              <span style={S.name}>{qg.name}</span>
              {qg.component_id && <span style={S.comp}>{qg.component_id}</span>}
              <span style={S.date}>{qg.date_created?.slice(0, 10) ?? ''}</span>
            </div>
            {!onOpen && expanded === qg.qg_id && (
              <div style={S.detail}>
                {qg.description && <div style={S.desc}>{qg.description}</div>}
                {qg.sprint_id && (
                  <div style={S.sprint}>Спринт: <b>{qg.sprint_id}</b></div>
                )}
                {(metrics[qg.qg_id] ?? []).length > 0 ? (
                  <table style={S.table}>
                    <thead><tr>
                      <th style={S.th}>Метрика</th>
                      <th style={S.th}>Описание</th>
                      <th style={S.th}>Порог</th>
                    </tr></thead>
                    <tbody>
                      {(metrics[qg.qg_id] ?? []).map(m => (
                        <tr key={m.metric_id}>
                          <td style={S.tdCode}>{m.metric_id}</td>
                          <td style={S.td}>{m.name}</td>
                          <td style={S.tdThreshold}>{m.threshold}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : metrics[qg.qg_id] ? (
                  <div style={S.noMetrics}>Метрики не найдены.</div>
                ) : (
                  <div style={S.noMetrics}>Загрузка метрик…</div>
                )}
              </div>
            )}
          </div>
        ))}
        {shown.length === 0 && <div style={S.state}>Quality Gates не найдены.</div>}
      </div>
    </div>
  );
}

const S = {
  root:  { flex: 1, display: 'flex', flexDirection: 'column' as const, overflow: 'hidden' },
  state: { padding: 24, color: 'var(--t3)', fontSize: 12 },
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
  row: (expanded: boolean) => ({
    display: 'flex', alignItems: 'center', gap: 8,
    padding: '7px 14px', borderBottom: '1px solid var(--bd)',
    fontSize: 12, cursor: 'pointer',
    background: expanded ? 'color-mix(in srgb, var(--acc) 5%, transparent)' : 'transparent',
  }),
  arrow:  { color: 'var(--t3)', fontSize: 11, width: 12, flexShrink: 0 },
  statusChip: (s: string) => {
    const m = STATUS_META[s] ?? { color: 'var(--t3)' };
    return {
      fontSize: 9, padding: '1px 5px', borderRadius: 3, flexShrink: 0,
      background: `color-mix(in srgb, ${m.color} 16%, transparent)`,
      color: m.color,
      border: `1px solid color-mix(in srgb, ${m.color} 28%, transparent)`,
    };
  },
  id:          { color: 'var(--t3)', fontSize: 11, minWidth: 140, flexShrink: 0 },
  name:        { flex: 1, color: 'var(--t1)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const },
  comp:        { color: 'var(--acc)', fontSize: 11, flexShrink: 0 },
  date:        { color: 'var(--t3)', fontSize: 11, flexShrink: 0 },
  detail: {
    padding: '8px 14px 12px 38px',
    background: 'color-mix(in srgb, var(--b2) 40%, transparent)',
    borderBottom: '1px solid var(--bd)',
  },
  desc:        { color: 'var(--t2)', fontSize: 11, marginBottom: 6 },
  sprint:      { color: 'var(--t3)', fontSize: 10, marginBottom: 6 },
  noMetrics:   { color: 'var(--t3)', fontSize: 11, fontStyle: 'italic' as const },
  table:       { width: '100%', borderCollapse: 'collapse' as const, fontSize: 11 },
  th: {
    textAlign: 'left' as const, padding: '4px 8px',
    color: 'var(--t3)', fontWeight: 600, borderBottom: '1px solid var(--bd)',
  },
  td:          { padding: '4px 8px', color: 'var(--t2)', verticalAlign: 'top' as const },
  tdCode:      { padding: '4px 8px', color: 'var(--acc)', fontFamily: 'monospace', whiteSpace: 'nowrap' as const },
  tdThreshold: { padding: '4px 8px', color: 'var(--t1)', whiteSpace: 'pre-wrap' as const, maxWidth: 240 },
};
