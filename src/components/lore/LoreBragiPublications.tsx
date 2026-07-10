// LoreBragiPublications — FE-02: "Публикации" tab of LoreBragiScreen.
// Card per BragiPublication grouping its BragiVariant children by channel,
// matching bragi-archive-prototype.html's .pubcard/.variants layout. Clicking
// a variant expands it (full text + live BragiMetric points for that variant).
import { useEffect, useMemo, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { fetchLoreSlice, fetchBragiMetrics, type BragiMetricPoint } from '../../api/lore';
import LoreBragiPublicationEditor, { type LoreBragiPublicationEditData, countOpenTodos } from './LoreBragiPublicationEditor';

interface PublicationRow {
  publication_id: string;
  title: string;
  topic: string | null;
  main_text_md: string | null;
  type: string | null;
  status_general: string | null;
  source_file_path: string | null;
  cover_asset_urls: string[];
  variant_ids: string[];
  variant_statuses: string[];
  variant_urls: (string | null)[];
  variant_texts: (string | null)[];
  variant_channels: string[];
  variant_asset_urls: (string | null)[];
  keyword_ids: string[];
  rubric_ids: string[];
  rubric_names: string[];
  produced_by_task_ids?: string[];
  produced_by_sprint_ids?: string[];
  shipped_in_release_ids?: string[];
  // V2-02: editorial meta / TODO checklist — never rendered into a preview.
  annotation_md?: string | null;
  todo_md?: string | null;
  variant_annotation_texts?: (string | null)[];
  variant_todo_texts?: (string | null)[];
}

// Seed data still carries illustrative filenames ("ai-gov.png") that don't
// resolve anywhere; real uploads (IMG-02) are "/lore/bragi/asset/file/..."
// same-origin paths. Try to render either — fall back to a labeled "no
// image" placeholder (not a blank box) on load failure, since a plain empty
// div reads as broken UI rather than "nothing uploaded here yet".
function Thumb({ src, style }: { src: string | null | undefined; style: React.CSSProperties }) {
  const { t } = useTranslation();
  const [failed, setFailed] = useState(false);
  if (!src || failed) {
    return (
      <div style={{ ...style, display: 'flex', alignItems: 'center', justifyContent: 'center' }} title={src ?? t('bragi.publications.noImage', 'нет изображения')}>
        <span style={{ fontSize: Math.max(12, Math.min(style.width as number ?? 20, style.height as number ?? 20) * 0.4), opacity: 0.35 }}>🖼</span>
      </div>
    );
  }
  return <img src={src} alt="" style={{ ...style, objectFit: 'cover' }} onError={() => setFailed(true)} />;
}

const STATUS_COLOR: Record<string, string> = {
  ready: 'var(--acc)', published: 'var(--suc)', draft: 'var(--t3)', planned: 'var(--t3)',
};

export default function LoreBragiPublications() {
  const { t } = useTranslation();
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

  const rubricNames = useMemo(() => {
    const s = new Set<string>();
    rows.forEach(r => r.rubric_names.forEach(n => n && s.add(n)));
    return Array.from(s).sort();
  }, [rows]);

  const filtered = useMemo(() => {
    if (filter === 'все') return rows;
    if (filter === 'черновики') return rows.filter(r => r.status_general === 'draft');
    if (rubricNames.includes(filter)) return rows.filter(r => r.rubric_names.includes(filter));
    return rows.filter(r => r.variant_channels.includes(filter));
  }, [rows, filter, rubricNames]);

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
      rubric_ids: editingRow.rubric_ids, cover_asset_urls: editingRow.cover_asset_urls,
      source_file_path: editingRow.source_file_path,
      produced_by_task_ids: editingRow.produced_by_task_ids ?? [],
      produced_by_sprint_ids: editingRow.produced_by_sprint_ids ?? [],
      shipped_in_release_ids: editingRow.shipped_in_release_ids ?? [],
      annotation_md: editingRow.annotation_md, todo_md: editingRow.todo_md,
      variant_annotation_texts: editingRow.variant_annotation_texts,
      variant_todo_texts: editingRow.variant_todo_texts,
    };
    // Status/date genuinely differ per channel (live on CH-TG, still draft on
    // CH-HABR) — only lock the WHOLE form when every variant is already
    // published; otherwise each variant locks individually inside the editor.
    const allVariantsPublished = editingRow.variant_statuses.length > 0
      && editingRow.variant_statuses.every(s => s === 'published');
    return (
      <LoreBragiPublicationEditor
        editing={editData}
        readOnly={allVariantsPublished}
        onSaved={() => { setEditingRow(null); load(); }}
        onCancel={() => setEditingRow(null)}
      />
    );
  }

  if (loading) return <div style={S.hint}>{t('bragi.publications.loading', 'загрузка…')}</div>;

  const filterLabel = (f: string): string => {
    if (f === 'все') return t('bragi.publications.filterAll', 'все');
    if (f === 'черновики') return t('bragi.publications.filterDrafts', 'черновики');
    return f;
  };

  return (
    <div>
      <div style={S.descRow}>
        <div style={S.desc}>{t('bragi.publications.desc', 'main-текст + вариации под площадки: одна публикация группирует свои версии; у каждой — свой текст, статус и картинка.')}</div>
        <button style={S.newBtn} onClick={() => setCreating(true)}>{t('bragi.publications.newPublication', '+ новая публикация')}</button>
      </div>
      <div style={S.filters}>
        {['все', ...channels, ...rubricNames, 'черновики'].map(f => (
          <span key={f} style={filterChipStyle(filter === f)} onClick={() => setFilter(f)}>{filterLabel(f)}</span>
        ))}
      </div>

      {filtered.map(pub => {
        const openTodos = countOpenTodos(pub.todo_md) + (pub.variant_todo_texts ?? []).reduce((sum, v) => sum + countOpenTodos(v), 0);
        return (
        <div key={pub.publication_id} style={S.pubcard}>
          <div style={S.pubhead}>
            <Thumb src={pub.cover_asset_urls?.[0] ?? pub.variant_asset_urls?.[0]} style={S.thumb} />
            <div style={{ flex: 1 }}>
              <div style={S.pubttlRow}>
                <div style={S.pubttl}>{pub.title}</div>
                <button style={S.editBtn} onClick={() => setEditingRow(pub)}>
                  {pub.variant_statuses.length > 0 && pub.variant_statuses.every(s => s === 'published')
                    ? t('bragi.publications.viewBtn', '👁 просмотр') : t('bragi.publications.editBtn', '✎ редактировать')}
                </button>
              </div>
              <div style={S.pubmeta}>
                {openTodos > 0 && <span style={S.todoBadge}>{t('bragi.publications.todoBadge', '{{n}} todo', { n: openTodos })}</span>}
                {pub.rubric_names[0] && <span style={S.rubricChip}>{pub.rubric_names[0]}</span>}
                {pub.topic && <span>{t('bragi.publications.keywordPrefix', 'ключ ·')} {pub.topic}</span>}
                {pub.main_text_md && (
                  <span style={S.mainTextLink} onClick={() => setShowMainText(showMainText === pub.publication_id ? null : pub.publication_id)}>
                    {t('bragi.publications.mainTextToggle', 'main-текст')} {showMainText === pub.publication_id ? '▲' : '▼'}
                  </span>
                )}
                <span style={S.statusTag}>
                  <span style={statusDotStyle(STATUS_COLOR[pub.status_general ?? ''] ?? 'var(--t3)')} />
                  {pub.status_general ? t('bragi.publicationEditor.status.' + pub.status_general, pub.status_general) : '—'}
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
                  <Thumb src={pub.variant_asset_urls[i]} style={S.thumbSm} />
                  <div>
                    <div style={S.variantTop}>
                      {pub.variant_channels[i] ?? '—'} ·{' '}
                      <span style={{ color: STATUS_COLOR[pub.variant_statuses[i] ?? ''] ?? 'var(--t3)' }}>
                        {pub.variant_statuses[i] ? t('bragi.publicationEditor.status.' + pub.variant_statuses[i], pub.variant_statuses[i]) : '—'}
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
                        <div style={S.sameAsMainTag}>{t('bragi.publications.sameAsMainText', 'как в main-тексте')}</div>
                        <div style={S.expandText}>{pub.main_text_md ?? t('bragi.publications.textNotSet', 'текст не задан')}</div>
                      </>
                    )}
                    {pub.variant_urls[i] && (
                      <div style={S.hint}>
                        <a href={pub.variant_urls[i]!} target="_blank" rel="noreferrer" style={S.link} onClick={e => e.stopPropagation()}>
                          {t('bragi.publications.goToPublished', '→ перейти к опубликованному')}
                        </a>
                      </div>
                    )}
                    <div style={S.expandMetricsLabel}>{t('bragi.publications.channelMetricsLabel', 'метрики площадки')}</div>
                    {metricsLoading ? (
                      <div style={S.hint}>{t('bragi.publications.loadingMetrics', 'загрузка метрик…')}</div>
                    ) : metrics.length === 0 ? (
                      <div style={S.hint}>{t('bragi.publications.noMetricsYet', 'замеров пока нет')}</div>
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
            <div style={S.addSlot}>{t('bragi.publications.addChannelSlot', '+ площадка')}</div>
          </div>
        </div>
        );
      })}
      {filtered.length === 0 && <div style={S.hint}>{t('bragi.publications.emptyFiltered', 'ничего не найдено под этим фильтром')}</div>}
    </div>
  );
}

function filterChipStyle(active: boolean): React.CSSProperties {
  return {
    fontSize: 'var(--fs-base)', border: '1px solid', borderRadius: 6, padding: '3px 10px', cursor: 'pointer',
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
               background: 'var(--acc)', color: 'var(--on-accent)', fontSize: 'var(--fs-base)', fontWeight: 600 },
  desc:      { color: 'var(--t2)', fontSize: 'var(--fs-lg)', margin: 0 },
  hint:      { fontSize: 'var(--fs-base)', color: 'var(--t3)' },
  filters:   { display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 14 },
  pubcard:   { background: 'var(--b1)', border: '1px solid var(--bd)', borderRadius: 12, padding: '14px 16px', marginBottom: 14 },
  pubhead:   { display: 'flex', gap: 14, alignItems: 'flex-start' },
  thumb:     { flex: 'none', width: 128, height: 90, background: 'var(--b2)', border: '1px solid var(--bd)', borderRadius: 8 },
  thumbSm:   { flex: 'none', width: 64, height: 46, background: 'var(--b2)', border: '1px solid var(--bd)', borderRadius: 8, display: 'inline-block' },
  pubttlRow: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  pubttl:    { fontSize: 'var(--fs-lg)', fontWeight: 500 },
  editBtn:   { flex: 'none', fontSize: 'var(--fs-sm)', color: 'var(--t2)', background: 'transparent', border: '1px solid var(--b3)',
               borderRadius: 5, padding: '3px 9px', cursor: 'pointer' },
  pubmeta:   { fontSize: 'var(--fs-base)', color: 'var(--t3)', marginTop: 5, display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' },
  mainTextLink: { color: 'var(--acc)', cursor: 'pointer' },
  rubricChip: { fontSize: 'var(--fs-sm)', color: 'var(--acc)', background: 'color-mix(in srgb, var(--acc) 14%, transparent)',
                border: '1px solid color-mix(in srgb, var(--acc) 30%, transparent)', borderRadius: 6, padding: '1px 8px' },
  todoBadge:  { fontSize: 'var(--fs-sm)', color: 'var(--wrn)', background: 'color-mix(in srgb, var(--wrn) 14%, transparent)',
                border: '1px solid color-mix(in srgb, var(--wrn) 30%, transparent)', borderRadius: 6, padding: '1px 8px' },
  mainTextBox:  { marginTop: 8, padding: '8px 10px', background: 'var(--bg0)', border: '1px solid var(--bd)',
                  borderRadius: 6, fontSize: 'var(--fs-base)', lineHeight: 1.55, color: 'var(--t1)' },
  link:      { color: 'var(--acc)', textDecoration: 'none' },
  statusTag: { fontSize: 'var(--fs-base)', display: 'flex', alignItems: 'center', whiteSpace: 'nowrap' },
  variants:  { display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--bd)' },
  variantChip: { display: 'flex', gap: 9, alignItems: 'center', background: 'var(--bg0)', border: '1px solid var(--bd)',
                 borderRadius: 8, padding: '7px 10px', cursor: 'pointer' },
  variantTop:  { fontSize: 'var(--fs-base)' },
  variantMeta: { fontSize: 'var(--fs-xs)', color: 'var(--t3)', marginTop: 2, fontFamily: 'var(--mono)' },
  addSlot:   { color: 'var(--t3)', border: '1px dashed var(--bd)', borderRadius: 8, padding: '7px 14px',
               fontSize: 'var(--fs-base)', display: 'flex', alignItems: 'center', justifyContent: 'center' },
  expandBox: { marginTop: 6, marginBottom: 4, padding: '10px 12px', background: 'var(--bg0)', border: '1px solid var(--bd)',
               borderRadius: 8 },
  expandText: { fontSize: 'var(--fs-md)', lineHeight: 1.55, marginBottom: 8 },
  sameAsMainTag: { fontSize: 'var(--fs-xs)', color: 'var(--t3)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 4 },
  expandMetricsLabel: { fontSize: 'var(--fs-xs)', color: 'var(--t3)', textTransform: 'uppercase', letterSpacing: '0.04em', margin: '6px 0' },
  metricChip: { background: 'var(--b2)', border: '1px solid var(--bd)', borderRadius: 6, padding: '2px 8px',
                fontSize: 'var(--fs-sm)', color: 'var(--t2)', fontFamily: 'var(--mono)' },
};
