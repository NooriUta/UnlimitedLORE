import { useEffect, useState } from 'react';
import { fetchLoreSlice } from '../../api/lore';

interface QGRow {
  qg_id: string;
  name: string;
  description: string | null;
  component_id: string | null;
  status: string | null;
  date_created: string | null;
}

interface QGMetricRow {
  metric_id: string;
  name: string;
  threshold: string;
}

const STATUS_COLORS: Record<string, string> = {
  active:   'var(--suc)',
  draft:    'var(--wrn)',
  archived: 'var(--t3)',
};

export default function LoreQualityGateList({ onError }: { onError: (e: unknown) => void }) {
  const [rows, setRows]         = useState<QGRow[]>([]);
  const [loading, setLoading]   = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [metrics, setMetrics]   = useState<Record<string, QGMetricRow[]>>({});

  useEffect(() => {
    setLoading(true);
    const ctrl = new AbortController();
    fetchLoreSlice<QGRow>('quality_gates', undefined, ctrl.signal)
      .then(r => { setRows(r); setLoading(false); })
      .catch(e => { onError(e); setLoading(false); });
    return () => ctrl.abort();
  }, [onError]);

  const toggle = (qgId: string) => {
    if (expanded === qgId) { setExpanded(null); return; }
    setExpanded(qgId);
    if (metrics[qgId]) return;
    fetchLoreSlice<QGMetricRow>('qg_metrics', { qg_id: qgId })
      .then(r => setMetrics(m => ({ ...m, [qgId]: r })))
      .catch(onError);
  };

  if (loading) return <div style={S.state}>Загрузка quality gates…</div>;

  return (
    <div style={S.root}>
      {rows.map(qg => (
        <div key={qg.qg_id}>
          <div style={S.row} onClick={() => toggle(qg.qg_id)}>
            <span style={S.arrow}>{expanded === qg.qg_id ? '▾' : '▸'}</span>
            {qg.status && (
              <span style={S.status(qg.status)}>{qg.status}</span>
            )}
            <span style={S.id}>{qg.qg_id}</span>
            <span style={S.name}>{qg.name}</span>
            {qg.component_id && <span style={S.comp}>{qg.component_id}</span>}
            <span style={S.date}>{qg.date_created?.slice(0, 10) ?? ''}</span>
          </div>
          {expanded === qg.qg_id && (
            <div style={S.detail}>
              {qg.description && <div style={S.desc}>{qg.description}</div>}
              {(metrics[qg.qg_id] ?? []).length > 0 ? (
                <table style={S.table}>
                  <thead>
                    <tr>
                      <th style={S.th}>Метрика</th>
                      <th style={S.th}>Описание</th>
                      <th style={S.th}>Порог</th>
                    </tr>
                  </thead>
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
      {rows.length === 0 && <div style={S.state}>Quality Gates не найдены.</div>}
    </div>
  );
}

const S = {
  root:  { flex: 1, overflowY: 'auto' as const },
  state: { padding: 24, color: 'var(--t3)', fontSize: 12 },
  row: {
    display: 'flex', alignItems: 'center', gap: 8,
    padding: '7px 16px', borderBottom: '1px solid var(--b2)',
    fontSize: 12, cursor: 'pointer',
    background: 'transparent',
  },
  arrow:  { color: 'var(--t3)', fontSize: 11, width: 12, flexShrink: 0 },
  status: (s: string) => ({
    fontSize: 10, padding: '1px 5px', borderRadius: 3, flexShrink: 0,
    background: `color-mix(in srgb, ${STATUS_COLORS[s] ?? '#9e9e9e'} 18%, transparent)`,
    color: STATUS_COLORS[s] ?? 'var(--t3)',
    border: `1px solid color-mix(in srgb, ${STATUS_COLORS[s] ?? '#9e9e9e'} 30%, transparent)`,
  }),
  id:   { color: 'var(--t3)', fontSize: 11, minWidth: 160, flexShrink: 0 },
  name: { flex: 1, color: 'var(--t1)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const },
  comp: { color: 'var(--acc)', fontSize: 11, flexShrink: 0 },
  date: { color: 'var(--t3)', fontSize: 11, flexShrink: 0 },
  detail: {
    padding: '8px 16px 12px 40px',
    background: 'color-mix(in srgb, var(--b2) 40%, transparent)',
    borderBottom: '1px solid var(--b2)',
  },
  desc: { color: 'var(--t2)', fontSize: 11, marginBottom: 8 },
  table: { width: '100%', borderCollapse: 'collapse' as const, fontSize: 11 },
  th: {
    textAlign: 'left' as const, padding: '4px 8px',
    color: 'var(--t3)', fontWeight: 600, borderBottom: '1px solid var(--b2)',
  },
  td:         { padding: '4px 8px', color: 'var(--t2)', verticalAlign: 'top' as const },
  tdCode:     { padding: '4px 8px', color: 'var(--acc)', fontFamily: 'monospace', whiteSpace: 'nowrap' as const },
  tdThreshold:{ padding: '4px 8px', color: 'var(--t1)', whiteSpace: 'pre-wrap' as const, maxWidth: 240 },
  noMetrics:  { color: 'var(--t3)', fontSize: 11, fontStyle: 'italic' as const },
};
