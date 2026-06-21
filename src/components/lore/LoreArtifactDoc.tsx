import { useEffect, useState } from 'react';
import { fetchLoreSlice } from '../../api/lore';
import { MartProse } from '../bench/MartProse';
import SandboxedHtmlFrame from './SandboxedHtmlFrame';

// Generic single-artifact viewer for runbooks / docs / quality-gates opened from
// the unified list. Markdown bodies render via MartProse; KnowDoc HTML fragments
// render sandboxed. Preserves the rich bits of the old per-type views: the doc
// air-gap CDN warning (ADR-FE-001) and the QG metrics table. ADRs and specs keep
// their own dedicated viewers.

export type DocKind = 'runbook' | 'doc' | 'qg';

interface RawRow {
  runbook_id?: string; doc_id?: string; qg_id?: string;
  name?: string | null; title?: string | null;
  area?: string | null; status?: string | null; description?: string | null;
  kind?: string | null; has_ext_deps?: boolean | null;
  date_created?: string | null; valid_from?: string | null;
  content_md?: string | null; content_html?: string | null;
  component_id?: string | null;
}

interface QgMetricRow { metric_id: string; name: string; threshold: string; }

const SLICE: Record<DocKind, { slice: string; label: string }> = {
  runbook: { slice: 'runbook_by_id',      label: 'Runbook' },
  doc:     { slice: 'doc_by_id',          label: 'Документ' },
  qg:      { slice: 'quality_gate_by_id', label: 'Quality Gate' },
};

const S = {
  root: { flex: 1, overflowY: 'auto' as const, padding: '12px 20px' },
  back: { background: 'none', border: 'none', cursor: 'pointer', color: 'var(--acc)', fontSize: 12, padding: '0 0 12px', display: 'block' },
  header: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6, flexWrap: 'wrap' as const },
  kindTag: { fontSize: 10, padding: '2px 7px', borderRadius: 3, background: 'var(--b2)', color: 'var(--t3)', textTransform: 'uppercase' as const, letterSpacing: 0.3 },
  statusChip: { fontSize: 10, padding: '2px 7px', borderRadius: 3, background: 'color-mix(in srgb, var(--suc) 16%, transparent)', color: 'var(--suc)' },
  title: { fontSize: 16, fontWeight: 600, color: 'var(--t1)' },
  comp: { padding: '2px 7px', borderRadius: 3, fontSize: 11, background: 'color-mix(in srgb, var(--acc) 12%, transparent)', color: 'var(--acc)', whiteSpace: 'nowrap' as const },
  meta: { fontSize: 11, color: 'var(--t3)', marginBottom: 12 },
  cdnBanner: {
    marginBottom: 12, padding: '6px 10px', borderRadius: 3, fontSize: 10, lineHeight: 1.5,
    background: 'color-mix(in srgb, var(--danger) 8%, transparent)',
    border: '1px solid color-mix(in srgb, var(--danger) 30%, transparent)', color: 'var(--danger)',
  },
  desc: { fontSize: 12, color: 'var(--t2)', borderLeft: '2px solid var(--b3)', padding: '2px 0 2px 10px', marginBottom: 14 },
  table: { width: '100%', borderCollapse: 'collapse' as const, fontSize: 11, marginTop: 14 },
  th: { textAlign: 'left' as const, padding: '4px 8px', color: 'var(--t3)', fontWeight: 600, borderBottom: '1px solid var(--b2)' },
  td: { padding: '4px 8px', color: 'var(--t2)', verticalAlign: 'top' as const },
  tdCode: { padding: '4px 8px', color: 'var(--acc)', fontFamily: 'var(--mono)', whiteSpace: 'nowrap' as const },
  tdThresh: { padding: '4px 8px', color: 'var(--t1)', whiteSpace: 'pre-wrap' as const, maxWidth: 240 },
  idFoot: { marginTop: 18, paddingTop: 10, borderTop: '1px solid var(--b2)', fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--t3)' },
  empty: { padding: 24, color: 'var(--t3)', fontSize: 12 },
};

interface Props {
  kind: DocKind;
  id: string;
  onError: (e: unknown) => void;
  onBack: () => void;
}

export default function LoreArtifactDoc({ kind, id, onError, onBack }: Props) {
  const [row, setRow]         = useState<RawRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [metrics, setMetrics] = useState<QgMetricRow[] | null>(null);

  useEffect(() => {
    setLoading(true); setRow(null); setMetrics(null);
    const ctrl = new AbortController();
    fetchLoreSlice<RawRow>(SLICE[kind].slice, { id }, ctrl.signal)
      .then(rows => { if (!ctrl.signal.aborted) { setRow(rows[0] ?? null); setLoading(false); } })
      .catch(e => { onError(e); setLoading(false); });
    return () => ctrl.abort();
  }, [kind, id, onError]);

  // QG metrics (secondary slice) — parity with the old LoreQualityGateList table.
  useEffect(() => {
    if (kind !== 'qg') return;
    const ctrl = new AbortController();
    fetchLoreSlice<QgMetricRow>('qg_metrics', { qg_id: id }, ctrl.signal)
      .then(m => { if (!ctrl.signal.aborted) setMetrics(m); })
      .catch(() => setMetrics([]));
    return () => ctrl.abort();
  }, [kind, id]);

  if (loading) return <div style={S.empty}>Загрузка {id}…</div>;
  if (!row)    return <div style={S.empty}>Не найдено: {id}</div>;

  const title = row.name || row.title || id;
  const date  = row.date_created || row.valid_from;
  const metaBits: string[] = [];
  if (row.area) metaBits.push(row.area);
  if (row.kind) metaBits.push(row.kind);
  if (date)     metaBits.push(date.slice(0, 10));

  return (
    <div style={S.root}>
      <button style={S.back} onClick={onBack}>← К списку</button>
      <div style={S.header}>
        <span style={S.kindTag}>{SLICE[kind].label}</span>
        {row.status && <span style={S.statusChip}>{row.status}</span>}
        <span style={S.title}>{title}</span>
        {row.component_id && <span style={S.comp}>{row.component_id}</span>}
      </div>
      {metaBits.length > 0 && <div style={S.meta}>{metaBits.join(' · ')}</div>}

      {row.has_ext_deps && (
        <div style={S.cdnBanner}>
          ⚠ Документ ссылается на внешние ресурсы (CDN). В air-gap среде они недоступны —
          CSP блокирует внешние загрузки, внешние стили/скрипты не применятся.
        </div>
      )}

      {row.description && <div style={S.desc}>{row.description}</div>}

      {row.content_html
        ? <SandboxedHtmlFrame html={row.content_html} title={title} />
        : row.content_md
          ? <MartProse text={row.content_md} />
          : <div style={S.empty}>Контент пуст.</div>}

      {kind === 'qg' && metrics && metrics.length > 0 && (
        <table style={S.table}>
          <thead>
            <tr><th style={S.th}>Метрика</th><th style={S.th}>Описание</th><th style={S.th}>Порог</th></tr>
          </thead>
          <tbody>
            {metrics.map(m => (
              <tr key={m.metric_id}>
                <td style={S.tdCode}>{m.metric_id}</td>
                <td style={S.td}>{m.name}</td>
                <td style={S.tdThresh}>{m.threshold}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <div style={S.idFoot}>{id}</div>
    </div>
  );
}
