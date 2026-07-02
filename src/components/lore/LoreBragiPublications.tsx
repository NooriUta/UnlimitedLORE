// LoreBragiPublications — FE-02: "Публикации" tab of LoreBragiScreen.
// Card per BragiPublication grouping its BragiVariant children by channel,
// matching bragi-archive-prototype.html's .pubcard/.variants layout. Clicking
// a variant expands it (full text + live BragiMetric points for that variant).
import { useEffect, useMemo, useState, useCallback } from 'react';
import { fetchLoreSlice, fetchBragiMetrics, type BragiMetricPoint } from '../../api/lore';
import LoreBragiPublicationEditor, { type LoreBragiPublicationEditData } from './LoreBragiPublicationEditor';

interface PublicationRow {
  publication_id: string;
  title: string;
  topic: string | null;
  main_text_md: string | null;
  type: string | null;
  status_general: string | null;
  variant_ids: string[];
  variant_statuses: string[];
  variant_urls: (string | null)[];
  variant_texts: (string | null)[];
  variant_channels: string[];
  variant_asset_urls: (string | null)[];
  keyword_ids: string[];
}

const STATUS_COLOR: Record<string, string> = {
  ready: 'var(--acc)', published: 'var(--suc)', draft: 'var(--t3)', planned: 'var(--t3)',
};

export default function LoreBragiPublications() {
  const [rows, setRows] = useState<PublicationRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('все');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [metrics, setMetrics] = useState<BragiMetricPoint[]>([]);
  const [metricsLoading, setMetricsLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [editingRow, setEditingRow] = useState<PublicationRow | null>(null);
  const [showMainText, setShowMainText] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    return fetchLoreSlice<PublicationRow>('bragi_publications')
      .then(rs => { setRows(rs); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  const channels = useMemo(() => {
    const s = new Set<string>();
    rows.forEach(r => r.variant_channels.forEach(c => c && s.add(c)));
    return Array.from(s).sort();
  }, [rows]);

  const filtered = useMemo(() => {
    if (filter === 'все') return rows;
    if (filter === 'черновики') return rows.filter(r => r.status_general === 'draft');
    return rows.filter(r => r.variant_channels.includes(filter));
  }, [rows, filter]);

  const toggleVariant = (variantId: string, objectId: string) => {
    if (expanded === variantId) { setExpanded(null); return; }
    setExpanded(variantId);
    setMetricsLoading(true);
    fetchBragiMetrics({ object_id: objectId, limit: '20' })
      .then(setMetrics)
      .catch(() => setMetrics([]))
      .finally(() => setMetricsLoading(false));
  };

  if (creating) {
    return (
      <LoreBragiPublicationEditor
        onSaved={() => { setCreating(false); load(); }}
        onCancel={() => setCreating(false)}
      />
    );
  }

  if (editingRow) {
    const editData: LoreBragiPublicationEditData = {
      publication_id: editingRow.publication_id, title: editingRow.title, topic: editingRow.topic,
      main_text_md: editingRow.main_text_md, type: editingRow.type, status_general: editingRow.status_general,
      keyword_ids: editingRow.keyword_ids, variant_ids: editingRow.variant_ids,
      variant_channels: editingRow.variant_channels, variant_statuses: editingRow.variant_statuses,
      variant_urls: editingRow.variant_urls, variant_texts: editingRow.variant_texts,
    };
    return (
      <LoreBragiPublicationEditor
        editing={editData}
        onSaved={() => { setEditingRow(null); load(); }}
        onCancel={() => setEditingRow(null)}
      />
    );
  }

  if (loading) return <div style={S.hint}>загрузка…</div>;

  return (
    <div>
      <div style={S.descRow}>
        <div style={S.desc}>main-текст + вариации под площадки: одна публикация группирует свои версии; у каждой — свой текст, статус и картинка.</div>
        <button style={S.newBtn} onClick={() => setCreating(true)}>+ новая публикация</button>
      </div>
      <div style={S.filters}>
        {['все', ...channels, 'черновики'].map(f => (
          <span key={f} style={filterChipStyle(filter === f)} onClick={() => setFilter(f)}>{f}</span>
        ))}
      </div>

      {filtered.map(pub => (
        <div key={pub.publication_id} style={S.pubcard}>
          <div style={S.pubhead}>
            <div style={S.thumb} />
            <div style={{ flex: 1 }}>
              <div style={S.pubttlRow}>
                <div style={S.pubttl}>{pub.title}</div>
                <button style={S.editBtn} onClick={() => setEditingRow(pub)}>✎ редактировать</button>
              </div>
              <div style={S.pubmeta}>
                {pub.topic && <span>ключ · {pub.topic}</span>}
                {pub.main_text_md && (
                  <span style={S.mainTextLink} onClick={() => setShowMainText(showMainText === pub.publication_id ? null : pub.publication_id)}>
                    main-текст {showMainText === pub.publication_id ? '▲' : '▼'}
                  </span>
                )}
                <span style={S.statusTag}>
                  <span style={statusDotStyle(STATUS_COLOR[pub.status_general ?? ''] ?? 'var(--t3)')} />
                  {pub.status_general ?? '—'}
                </span>
              </div>
              {showMainText === pub.publication_id && (
                <div style={S.mainTextBox}>{pub.main_text_md}</div>
              )}
            </div>
          </div>

          <div style={S.variants}>
            {pub.variant_ids.map((vid, i) => (
              <div key={vid}>
                <div
                  style={S.variantChip}
                  onClick={() => toggleVariant(vid, vid)}
                >
                  <span style={S.thumbSm} />
                  <div>
                    <div style={S.variantTop}>
                      {pub.variant_channels[i] ?? '—'} ·{' '}
                      <span style={{ color: STATUS_COLOR[pub.variant_statuses[i] ?? ''] ?? 'var(--t3)' }}>
                        {pub.variant_statuses[i] ?? '—'}
                      </span>
                    </div>
                    <div style={S.variantMeta}>
                      {pub.variant_asset_urls[i] ?? '—'}
                    </div>
                  </div>
                </div>
                {expanded === vid && (
                  <div style={S.expandBox}>
                    {pub.variant_texts[i] ? (
                      <div style={S.expandText}>{pub.variant_texts[i]}</div>
                    ) : (
                      <>
                        <div style={S.sameAsMainTag}>как в main-тексте</div>
                        <div style={S.expandText}>{pub.main_text_md ?? 'текст не задан'}</div>
                      </>
                    )}
                    {pub.variant_urls[i] && (
                      <div style={S.hint}>
                        <a href={pub.variant_urls[i]!} target="_blank" rel="noreferrer" style={S.link} onClick={e => e.stopPropagation()}>
                          → перейти к опубликованному
                        </a>
                      </div>
                    )}
                    <div style={S.expandMetricsLabel}>метрики площадки</div>
                    {metricsLoading ? (
                      <div style={S.hint}>загрузка метрик…</div>
                    ) : metrics.length === 0 ? (
                      <div style={S.hint}>замеров пока нет</div>
                    ) : (
                      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                        {metrics.map((m, mi) => (
                          <span key={mi} style={S.metricChip}>{m.metric}: {m.value}</span>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
            <div style={S.addSlot}>+ площадка</div>
          </div>
        </div>
      ))}
      {filtered.length === 0 && <div style={S.hint}>ничего не найдено под этим фильтром</div>}
    </div>
  );
}

function filterChipStyle(active: boolean): React.CSSProperties {
  return {
    fontSize: 12, border: '1px solid', borderRadius: 6, padding: '3px 10px', cursor: 'pointer',
    color: active ? 'var(--acc)' : 'var(--t2)',
    borderColor: active ? 'var(--acc)' : 'var(--bd)',
  };
}

function statusDotStyle(color: string): React.CSSProperties {
  return { width: 7, height: 7, borderRadius: '50%', display: 'inline-block', background: color, marginRight: 6 };
}

const S: Record<string, React.CSSProperties> = {
  descRow:   { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, marginBottom: 18 },
  newBtn:    { flex: 'none', height: 28, padding: '0 12px', borderRadius: 5, border: 'none', cursor: 'pointer',
               background: 'var(--acc)', color: '#fff', fontSize: 12, fontWeight: 600 },
  desc:      { color: 'var(--t2)', fontSize: 14, margin: 0 },
  hint:      { fontSize: 12, color: 'var(--t3)' },
  filters:   { display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 14 },
  pubcard:   { background: 'var(--b1)', border: '1px solid var(--bd)', borderRadius: 12, padding: '14px 16px', marginBottom: 14 },
  pubhead:   { display: 'flex', gap: 14, alignItems: 'flex-start' },
  thumb:     { flex: 'none', width: 76, height: 54, background: 'var(--b2)', border: '1px solid var(--bd)', borderRadius: 8 },
  thumbSm:   { flex: 'none', width: 42, height: 32, background: 'var(--b2)', border: '1px solid var(--bd)', borderRadius: 8, display: 'inline-block' },
  pubttlRow: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  pubttl:    { fontSize: 15, fontWeight: 500 },
  editBtn:   { flex: 'none', fontSize: 11, color: 'var(--t2)', background: 'transparent', border: '1px solid var(--b3)',
               borderRadius: 5, padding: '3px 9px', cursor: 'pointer' },
  pubmeta:   { fontSize: 12, color: 'var(--t3)', marginTop: 5, display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' },
  mainTextLink: { color: 'var(--acc)', cursor: 'pointer' },
  mainTextBox:  { marginTop: 8, padding: '8px 10px', background: 'var(--bg0)', border: '1px solid var(--bd)',
                  borderRadius: 6, fontSize: 12.5, lineHeight: 1.55, color: 'var(--t1)' },
  link:      { color: 'var(--acc)', textDecoration: 'none' },
  statusTag: { fontSize: 12, display: 'flex', alignItems: 'center', whiteSpace: 'nowrap' },
  variants:  { display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--bd)' },
  variantChip: { display: 'flex', gap: 9, alignItems: 'center', background: 'var(--bg0)', border: '1px solid var(--bd)',
                 borderRadius: 8, padding: '7px 10px', cursor: 'pointer' },
  variantTop:  { fontSize: 12 },
  variantMeta: { fontSize: 10.5, color: 'var(--t3)', marginTop: 2, fontFamily: 'var(--mono)' },
  addSlot:   { color: 'var(--t3)', border: '1px dashed var(--bd)', borderRadius: 8, padding: '7px 14px',
               fontSize: 12, display: 'flex', alignItems: 'center', justifyContent: 'center' },
  expandBox: { marginTop: 6, marginBottom: 4, padding: '10px 12px', background: 'var(--bg0)', border: '1px solid var(--bd)',
               borderRadius: 8 },
  expandText: { fontSize: 13, lineHeight: 1.55, marginBottom: 8 },
  sameAsMainTag: { fontSize: 10, color: 'var(--t3)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 4 },
  expandMetricsLabel: { fontSize: 10, color: 'var(--t3)', textTransform: 'uppercase', letterSpacing: '0.04em', margin: '6px 0' },
  metricChip: { background: 'var(--b2)', border: '1px solid var(--bd)', borderRadius: 6, padding: '2px 8px',
                fontSize: 11, color: 'var(--t2)', fontFamily: 'var(--mono)' },
};
