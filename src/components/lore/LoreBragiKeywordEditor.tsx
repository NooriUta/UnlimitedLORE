// LoreBragiKeywordEditor — create/edit a BragiKeyword. The "Ключи" table
// (LoreBragiExtras.tsx) was read-only from FE-05 onward even though the
// backend/MCP write path (POST /lore/bragi/keyword, lore_upsert_keyword) has
// always supported it — this closes that gap. Same convention as
// LoreBragiIntegrationEditor/LoreBragiPublicationEditor.
import { useEffect, useState } from 'react';
import { fetchLoreSlice } from '../../api/lore';

const LORE_BASE = '/lore';

async function post(path: string, body: unknown): Promise<{ ok: boolean; [k: string]: unknown }> {
  const res = await fetch(`${LORE_BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Seer-Role': 'admin' },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((json as { detail?: string }).detail ?? `POST ${path} → ${res.status}`);
  return json as { ok: boolean };
}

interface PageRow { page_id: string; url: string | null; title: string | null }

const INTENTS = ['инфо', 'комм', 'нав', 'бренд'];

/** Shape of an existing row (from the bragi_keys slice) — passed in to edit. */
export interface LoreBragiKeywordEditData {
  keyword_id: string;
  phrase: string;
  cluster: string | null;
  freq_exact: number | null;
  intent: string | null;
  page_url: string[];
}

export interface LoreBragiKeywordEditorProps {
  onSaved: (keywordId: string) => void;
  onCancel: () => void;
  editing?: LoreBragiKeywordEditData;
}

export default function LoreBragiKeywordEditor({ onSaved, onCancel, editing }: LoreBragiKeywordEditorProps) {
  const [keywordId, setKeywordId] = useState(editing?.keyword_id ?? '');
  const [phrase, setPhrase] = useState(editing?.phrase ?? '');
  const [cluster, setCluster] = useState(editing?.cluster ?? '');
  const [freqExact, setFreqExact] = useState(editing?.freq_exact != null ? String(editing.freq_exact) : '');
  const [intent, setIntent] = useState(editing?.intent ?? 'инфо');
  const [pages, setPages] = useState<PageRow[]>([]);
  const [pageId, setPageId] = useState('');
  const [saving, setSaving] = useState(false);
  const [errMsg, setErrMsg] = useState<string | null>(null);

  useEffect(() => {
    fetchLoreSlice<PageRow>('bragi_pages').then(setPages).catch(() => {});
  }, []);

  // Pages are joined by URL in the slice, not id — resolve the matching
  // page_id from the current page_url so the select can preselect it.
  useEffect(() => {
    if (editing?.page_url?.[0] && pages.length) {
      const match = pages.find(p => p.url === editing.page_url[0]);
      if (match) setPageId(match.page_id);
    }
  }, [editing, pages]);

  const handleSave = async () => {
    const id = keywordId.trim();
    if (!id) { setErrMsg('Keyword ID обязателен'); return; }
    if (!phrase.trim()) { setErrMsg('Фраза обязательна'); return; }
    setSaving(true);
    setErrMsg(null);
    try {
      await post('/bragi/keyword', {
        keyword_id: id, phrase: phrase.trim(),
        cluster: cluster || undefined,
        freq_exact: freqExact ? Number(freqExact) : undefined,
        intent: intent || undefined,
        page_id: pageId || undefined,
      });
      onSaved(id);
    } catch (e) {
      setErrMsg(String((e as Error).message ?? e));
      setSaving(false);
    }
  };

  return (
    <div style={S.root}>
      <div style={S.head}>
        <span style={S.title}>{editing ? 'Редактирование ключа' : 'Новое ключевое слово'}</span>
        <div style={S.headBtns}>
          <button style={S.btnGhost} onClick={onCancel} disabled={saving}>Отмена</button>
          <button style={S.btnPrimary} onClick={handleSave} disabled={saving}>
            {saving ? 'Сохранение…' : 'Сохранить'}
          </button>
        </div>
      </div>

      {errMsg && <div style={S.errBanner}>{errMsg}</div>}

      <div style={S.row4}>
        <Field label="Keyword ID" grow={1}>
          <input
            style={{ ...S.input, opacity: editing ? 0.6 : 1 }}
            value={keywordId}
            placeholder="KW-09"
            disabled={!!editing}
            onChange={e => setKeywordId(e.target.value)}
          />
        </Field>
        <Field label="Фраза" grow={3}>
          <input style={S.input} value={phrase} placeholder="data governance" onChange={e => setPhrase(e.target.value)} />
        </Field>
        <Field label="Кластер" grow={1}>
          <input style={S.input} value={cluster} placeholder="governance" onChange={e => setCluster(e.target.value)} />
        </Field>
      </div>

      <div style={S.row4}>
        <Field label="[!] точная частота /мес" grow={1}>
          <input style={S.input} type="number" value={freqExact} onChange={e => setFreqExact(e.target.value)} />
        </Field>
        <Field label="Интент" grow={1}>
          <select style={S.input} value={intent} onChange={e => setIntent(e.target.value)}>
            {INTENTS.map(i => <option key={i} value={i}>{i}</option>)}
          </select>
        </Field>
        <Field label="Целевая страница" grow={2}>
          <select style={S.input} value={pageId} onChange={e => setPageId(e.target.value)}>
            <option value="">— страница —</option>
            {pages.map(p => <option key={p.page_id} value={p.page_id}>{p.url ?? p.page_id}</option>)}
          </select>
        </Field>
      </div>
    </div>
  );
}

function Field({ label, grow, children }: { label: string; grow: number; children: React.ReactNode }) {
  return (
    <div style={{ ...S.field, flex: grow }}>
      <label style={S.label}>{label}</label>
      {children}
    </div>
  );
}

const S: Record<string, React.CSSProperties> = {
  root:     { flex: 1, overflowY: 'auto', padding: '14px 20px 40px', fontFamily: 'var(--font)', fontSize: 12 },
  head:     { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14, gap: 10 },
  title:    { fontSize: 14, fontWeight: 600, color: 'var(--t1)' },
  headBtns: { display: 'flex', gap: 8 },
  errBanner:{ marginBottom: 10, padding: '6px 10px', borderRadius: 5, fontSize: 11,
              background: 'color-mix(in srgb, var(--dng) 12%, transparent)',
              color: 'var(--dng)', border: '1px solid color-mix(in srgb, var(--dng) 30%, transparent)' },
  row4:     { display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 10 },
  field:    { display: 'flex', flexDirection: 'column', gap: 4, minWidth: 110 },
  label:    { fontSize: 10, color: 'var(--t3)', textTransform: 'uppercase', letterSpacing: '0.04em' },
  input:    { height: 28, padding: '0 8px', borderRadius: 4, border: '1px solid var(--b3)',
              background: 'var(--b1)', color: 'var(--t1)', fontSize: 12, fontFamily: 'inherit',
              outline: 'none', width: '100%', boxSizing: 'border-box' },
  btnPrimary:{ height: 28, padding: '0 14px', borderRadius: 5, border: 'none', cursor: 'pointer',
               background: 'var(--acc)', color: '#fff', fontSize: 12, fontWeight: 600 },
  btnGhost:  { height: 28, padding: '0 12px', borderRadius: 5, cursor: 'pointer',
               background: 'transparent', color: 'var(--t2)', border: '1px solid var(--b3)', fontSize: 12 },
};
