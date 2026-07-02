// LoreBragiAnalytics — FE-04: "Аналитика" tab of LoreBragiScreen. KPI cards +
// "доля в ИИ" bar chart (live agg over MetricSnapshot, no mocks) + recent
// metric feed. Hand-rolled (div-width bars, like LoreAnalytics.tsx elsewhere
// in this app) — no charting library dependency in this repo.
import { useEffect, useState } from 'react';
import { fetchBragiMetrics, type BragiMetricPoint } from '../../api/lore';

interface AggRow { object_type: string; object_id: string; metric: string; agg_value: number; n: number }

const COMPETITOR_NAME: Record<string, string> = {
  'COMP-COLLIBRA': 'Collibra', 'COMP-MANTA': 'Manta', 'COMP-ARENADATA': 'Arenadata',
  'COMP-DATAHUB': 'DataHub', 'COMP-SEIDR': 'Сейдр Студия',
};

async function sumMetric(metric: string): Promise<number> {
  const rows = await fetchBragiMetrics({ metric, agg: 'sum' }) as unknown as AggRow[];
  return rows.reduce((s, r) => s + (r.agg_value ?? 0), 0);
}

export default function LoreBragiAnalytics() {
  const [loading, setLoading] = useState(true);
  const [views, setViews] = useState(0);
  const [clicks, setClicks] = useState(0);
  const [demo, setDemo] = useState(0);
  const [position, setPosition] = useState<number | null>(null);
  const [aiShare, setAiShare] = useState<AggRow[]>([]);
  const [recent, setRecent] = useState<BragiMetricPoint[]>([]);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      sumMetric('views'),
      sumMetric('clicks'),
      sumMetric('demo_conv'),
      fetchBragiMetrics({ object_id: 'KW-08', metric: 'position', limit: '1' }),
      fetchBragiMetrics({ object_type: 'competitor', metric: 'ai_share', agg: 'sum' }) as unknown as Promise<AggRow[]>,
      fetchBragiMetrics({ limit: '30' }),
    ]).then(([v, c, d, posRows, share, rec]) => {
      if (cancelled) return;
      setViews(v); setClicks(c); setDemo(d);
      setPosition(posRows[0]?.value ?? null);
      setAiShare(share.sort((a, b) => b.agg_value - a.agg_value));
      setRecent(rec);
      setLoading(false);
    }).catch(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  if (loading) return <div style={S.hint}>загрузка…</div>;

  const maxShare = Math.max(1, ...aiShare.map(r => r.agg_value));

  return (
    <div>
      <div style={S.desc}>воронка (Метрика), позиции (Keys.so), доля в ИИ (Трекер ИИ), конкуренты.</div>
      <div style={S.kpis}>
        <div style={S.kpi}><div style={S.kpiLab}>показы/просмотры</div><div style={S.kpiVal}>{views.toLocaleString('ru-RU')}</div></div>
        <div style={S.kpi}><div style={S.kpiLab}>переходы</div><div style={S.kpiVal}>{clicks.toLocaleString('ru-RU')}</div></div>
        <div style={S.kpi}><div style={S.kpiLab}>демо</div><div style={S.kpiVal}>{demo}</div></div>
        <div style={S.kpi}><div style={S.kpiLab}>ср. позиция бренда</div><div style={S.kpiVal}>{position ?? '—'}</div></div>
      </div>

      <div style={S.card}>
        <h2 style={S.cardH2}>доля в ИИ vs конкуренты</h2>
        {aiShare.length === 0 ? <div style={S.hint}>замеров пока нет</div> : aiShare.map(r => {
          const isBrand = r.object_id === 'COMP-SEIDR';
          return (
            <div key={r.object_id} style={S.shareRow}>
              <div style={S.shareTop}>
                <span style={{ color: isBrand ? 'var(--acc)' : 'var(--t2)' }}>{COMPETITOR_NAME[r.object_id] ?? r.object_id}</span>
                <span>{r.agg_value}%</span>
              </div>
              <div style={S.shareTrack}>
                <div style={shareFillStyle(r.agg_value / maxShare, isBrand)} />
              </div>
            </div>
          );
        })}
      </div>

      <div style={S.card}>
        <h2 style={S.cardH2}>последние замеры <span style={S.meta}>{recent.length}</span></h2>
        {recent.length === 0 ? <div style={S.hint}>замеров пока нет</div> : (
          <table style={S.table}>
            <thead>
              <tr><th style={S.th}>объект</th><th style={S.th}>метрика</th><th style={S.thNum}>значение</th><th style={S.th}>источник</th></tr>
            </thead>
            <tbody>
              {recent.map((r, i) => (
                <tr key={i}>
                  <td style={S.td}>{r.object_type} · {r.object_id}</td>
                  <td style={S.td}>{r.metric}</td>
                  <td style={S.tdNum}>{r.value}</td>
                  <td style={S.td}>{r.source ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function shareFillStyle(ratio: number, isBrand: boolean): React.CSSProperties {
  return { height: 6, borderRadius: 3, width: `${Math.round(ratio * 100)}%`, background: isBrand ? 'var(--acc)' : 'var(--t3)' };
}

const S: Record<string, React.CSSProperties> = {
  desc:    { color: 'var(--t2)', fontSize: 14, marginBottom: 18 },
  hint:    { fontSize: 12, color: 'var(--t3)' },
  kpis:    { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 14, marginBottom: 18 },
  kpi:     { background: 'var(--b1)', border: '1px solid var(--bd)', borderRadius: 10, padding: '14px 16px' },
  kpiLab:  { fontSize: 12, color: 'var(--t3)' },
  kpiVal:  { fontFamily: 'var(--display)', fontWeight: 700, fontSize: 25, marginTop: 8, lineHeight: 1 },
  card:    { background: 'var(--b1)', border: '1px solid var(--bd)', borderRadius: 12, padding: '16px 18px', marginBottom: 16 },
  cardH2:  { fontFamily: 'var(--font)', fontWeight: 600, fontSize: 14, margin: '0 0 12px', display: 'flex',
             justifyContent: 'space-between', alignItems: 'center' },
  meta:    { fontFamily: 'var(--mono)', fontWeight: 400, fontSize: 11, color: 'var(--t3)' },
  shareRow:{ marginBottom: 11 },
  shareTop:{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: 'var(--t2)', marginBottom: 4 },
  shareTrack: { height: 6, borderRadius: 3, background: 'var(--b2)' },
  table:   { width: '100%', borderCollapse: 'collapse', fontSize: 13 },
  th:      { textAlign: 'left', color: 'var(--t3)', fontWeight: 400, fontSize: 11, padding: '8px 10px',
             borderBottom: '1px solid var(--bd)', fontFamily: 'var(--mono)' },
  thNum:   { textAlign: 'right', color: 'var(--t3)', fontWeight: 400, fontSize: 11, padding: '8px 10px',
             borderBottom: '1px solid var(--bd)', fontFamily: 'var(--mono)' },
  td:      { padding: '8px 10px', borderBottom: '1px solid var(--bd)' },
  tdNum:   { padding: '8px 10px', borderBottom: '1px solid var(--bd)', textAlign: 'right', fontFamily: 'var(--mono)' },
};
