// LAL-27: KnowDoc browser — list + lazy detail with SandboxedHtmlFrame.
// Docs slice (list): GET /lore/slice/docs
// Doc detail (lazy): GET /lore/slice/doc_by_id?id=<doc_id>
import { useEffect, useState } from 'react';
import { fetchLoreSlice, fetchLoreDoc, type LoreKnowDocRow, type LoreKnowDoc } from '../../api/lore';
import SandboxedHtmlFrame from './SandboxedHtmlFrame';

interface Props {
  onError: (e: unknown) => void;
}

export default function LoreDocView({ onError }: Props) {
  const [docs,       setDocs]       = useState<LoreKnowDocRow[]>([]);
  const [loading,    setLoading]    = useState(true);
  const [selected,   setSelected]   = useState<LoreKnowDoc | null>(null);
  const [loadingDoc, setLoadingDoc] = useState(false);
  const [filter,     setFilter]     = useState('');

  useEffect(() => {
    const ctrl = new AbortController();
    fetchLoreSlice<LoreKnowDocRow>('docs', undefined, ctrl.signal)
      .then(rows => { setDocs(rows); setLoading(false); })
      .catch(e => { onError(e); setLoading(false); });
    return () => ctrl.abort();
  }, [onError]);

  function openDoc(docId: string) {
    setLoadingDoc(true);
    fetchLoreDoc(docId)
      .then(doc => { setSelected(doc); setLoadingDoc(false); })
      .catch(e => { onError(e); setLoadingDoc(false); });
  }

  const filtered = filter
    ? docs.filter(d =>
        (d.title ?? d.doc_id).toLowerCase().includes(filter.toLowerCase()) ||
        d.doc_id.toLowerCase().includes(filter.toLowerCase()))
    : docs;

  return (
    <div style={S.root}>

      {/* ── List panel ─────────────────────────────────────────────────────── */}
      <div style={S.list}>
        <div style={S.listHdr}>
          <input
            value={filter}
            onChange={e => setFilter(e.target.value)}
            placeholder="Фильтр документов…"
            style={S.filterInp}
          />
          <span style={S.listCount}>{filtered.length} / {docs.length}</span>
        </div>
        {loading && <div style={S.msg}>Загрузка документов…</div>}
        {!loading && docs.length === 0 && (
          <div style={S.msg}>
            KnowDoc ещё не наполнен (Phase 5 LAL-30).
          </div>
        )}
        {filtered.map(doc => (
          <div
            key={doc.doc_id}
            onClick={() => openDoc(doc.doc_id)}
            style={{
              ...S.docRow,
              background: selected?.doc_id === doc.doc_id
                ? 'color-mix(in srgb, var(--acc) 10%, transparent)'
                : 'transparent',
            }}
          >
            <div style={S.docId}>{doc.doc_id}</div>
            <div style={S.docTitle}>{doc.title ?? '—'}</div>
            <div style={S.docMeta}>
              {doc.kind && <span style={S.kindChip(doc.kind)}>{doc.kind}</span>}
              {doc.has_ext_deps && (
                <span style={S.extWarn} title="Документ содержит внешние зависимости (CDN)">
                  ⚠ CDN
                </span>
              )}
              {doc.component_id && (
                <span style={{ fontSize: 9, color: 'var(--t3)' }}>{doc.component_id}</span>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* ── Detail panel ───────────────────────────────────────────────────── */}
      <div style={S.detail}>
        {!selected && !loadingDoc && (
          <div style={S.detailEmpty}>
            Выберите документ из списка слева.
          </div>
        )}
        {loadingDoc && <div style={S.msg}>Загрузка документа…</div>}
        {selected && !loadingDoc && (
          <>
            <div style={S.detailHdr}>
              <span style={S.detailTitle}>{selected.title ?? selected.doc_id}</span>
              <span style={S.detailMeta}>
                {selected.doc_id}
                {selected.kind && ` · ${selected.kind}`}
                {selected.valid_from && ` · ${selected.valid_from.slice(0, 10)}`}
              </span>
              {selected.has_ext_deps && (
                <div style={S.extBanner}>
                  ⚠ Документ ссылается на внешние ресурсы (CDN). В air-gap среде они недоступны.
                  CSP блокирует внешние загрузки — внешние стили/скрипты не применятся.
                </div>
              )}
            </div>
            <div style={S.detailBody}>
              {selected.content_html
                ? <SandboxedHtmlFrame html={selected.content_html} title={selected.title ?? selected.doc_id} />
                : <div style={S.msg}>Документ не содержит HTML-контент.</div>
              }
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────
const S = {
  root: {
    flex: 1, display: 'flex', overflow: 'hidden',
  },
  list: {
    width: 300, flexShrink: 0,
    display: 'flex', flexDirection: 'column' as const,
    borderRight: '1px solid var(--b2)', overflow: 'hidden',
  },
  listHdr: {
    display: 'flex', alignItems: 'center', gap: 6,
    padding: '6px 10px', borderBottom: '1px solid var(--b2)', flexShrink: 0,
  },
  filterInp: {
    flex: 1, height: 24, padding: '0 8px', fontSize: 11,
    border: '1px solid var(--b3)', borderRadius: 3,
    background: 'var(--b2)', color: 'var(--t1)', outline: 'none',
    fontFamily: 'inherit',
  },
  listCount: { fontSize: 10, color: 'var(--t3)', flexShrink: 0 },
  docRow: {
    padding: '7px 10px', borderBottom: '1px solid var(--b2)',
    cursor: 'pointer', transition: 'background 0.1s',
  },
  docId: {
    fontSize: 10, fontFamily: 'var(--mono)',
    color: 'var(--acc)', marginBottom: 2,
    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const,
  },
  docTitle: {
    fontSize: 11, color: 'var(--t1)',
    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const,
  },
  docMeta: {
    display: 'flex', gap: 4, alignItems: 'center', marginTop: 3, flexWrap: 'wrap' as const,
  },
  kindChip: (kind: string) => ({
    fontSize: 9, padding: '1px 4px', borderRadius: 2,
    background: `color-mix(in srgb, ${kind === 'page' ? 'var(--inf)' : 'var(--wrn)'} 14%, transparent)`,
    color: kind === 'page' ? 'var(--inf)' : 'var(--wrn)',
  }),
  extWarn: {
    fontSize: 9, color: 'var(--danger)', fontWeight: 600,
  },
  detail: {
    flex: 1, display: 'flex', flexDirection: 'column' as const, overflow: 'hidden',
  },
  detailEmpty: {
    padding: '40px 24px', color: 'var(--t3)', fontSize: 12,
    textAlign: 'center' as const, flex: 1,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
  },
  detailHdr: {
    padding: '10px 16px', borderBottom: '1px solid var(--b2)', flexShrink: 0,
  },
  detailTitle: { fontSize: 13, fontWeight: 600, color: 'var(--t1)', display: 'block', marginBottom: 3 },
  detailMeta:  { fontSize: 10, color: 'var(--t3)' },
  extBanner: {
    marginTop: 6, padding: '5px 10px',
    background: 'color-mix(in srgb, var(--danger) 8%, transparent)',
    border: '1px solid color-mix(in srgb, var(--danger) 30%, transparent)',
    borderRadius: 3, fontSize: 10, color: 'var(--danger)', lineHeight: 1.5,
  },
  detailBody: { flex: 1, overflowY: 'auto' as const, padding: 12 },
  msg: { padding: '24px 16px', color: 'var(--t3)', fontSize: 12 },
};
