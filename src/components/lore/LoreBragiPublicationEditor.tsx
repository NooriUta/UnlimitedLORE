// LoreBragiPublicationEditor — FE-06: create a BragiPublication with inline
// variants, modeled on LoreAdrEditor/LoreSprintEditor's create-form pattern.
// Wraps lore_create_publication/lore_create_variant (MCP-01) via their
// backend endpoints directly (same convention as LoreSprintEditor).
import { useEffect, useState } from 'react';
import { marked } from 'marked';
import { fetchLoreSlice } from '../../api/lore';
import { MultiChip } from './LoreAdrEditor';

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

interface KeywordRow { keyword_id: string; phrase: string }
interface ChannelRow { channel_id: string; channel_type: string | null }

interface VariantDraft {
  channel_id: string;
  text_md: string;
  status: string;
  url: string;
  published_at: string;
}

const STATUSES = ['draft', 'ready', 'published', 'planned'];

export interface LoreBragiPublicationEditorProps {
  onSaved: (publicationId: string) => void;
  onCancel: () => void;
  /** Prefill the first variant's date (FE-07: calendar quick-add). */
  initialPublishedAt?: string;
}

export default function LoreBragiPublicationEditor({ onSaved, onCancel, initialPublishedAt }: LoreBragiPublicationEditorProps) {
  const [publicationId, setPublicationId] = useState('');
  const [title, setTitle] = useState('');
  const [topic, setTopic] = useState('');
  const [mainText, setMainText] = useState('');
  const [type, setType] = useState('article');
  const [status, setStatus] = useState('draft');
  const [keywordIds, setKeywordIds] = useState<string[]>([]);
  const [variants, setVariants] = useState<VariantDraft[]>([
    { channel_id: '', text_md: '', status: 'draft', url: '', published_at: initialPublishedAt ?? '' },
  ]);

  const [keywords, setKeywords] = useState<KeywordRow[]>([]);
  const [channels, setChannels] = useState<ChannelRow[]>([]);
  const [saving, setSaving] = useState(false);
  const [errMsg, setErrMsg] = useState<string | null>(null);

  useEffect(() => {
    fetchLoreSlice<KeywordRow>('bragi_keys').then(setKeywords).catch(() => {});
    fetchLoreSlice<ChannelRow>('bragi_channels').then(setChannels).catch(() => {});
  }, []);

  const setVariant = (i: number, patch: Partial<VariantDraft>) =>
    setVariants(vs => vs.map((v, vi) => (vi === i ? { ...v, ...patch } : v)));
  const addVariant = () =>
    setVariants(vs => [...vs, { channel_id: '', text_md: '', status: 'draft', url: '', published_at: '' }]);
  const removeVariant = (i: number) => setVariants(vs => vs.filter((_, vi) => vi !== i));

  const handleSave = async () => {
    const id = publicationId.trim();
    if (!id) { setErrMsg('Publication ID обязателен'); return; }
    if (!title.trim()) { setErrMsg('Название обязательно'); return; }
    setSaving(true);
    setErrMsg(null);
    try {
      await post('/bragi/publication', {
        publication_id: id, title: title.trim(),
        topic: topic || undefined, main_text_md: mainText || undefined,
        type: type || undefined, status_general: status || undefined,
        keyword_ids: keywordIds.length ? keywordIds : undefined,
      });
      let i = 1;
      for (const v of variants) {
        if (!v.channel_id) continue; // skip empty rows
        const variantId = `${id}-${v.channel_id.replace(/^CH-/, '')}`;
        await post('/bragi/variant', {
          variant_id: variantId, publication_id: id, channel_id: v.channel_id,
          text_md: v.text_md || undefined, status: v.status || undefined,
          url: v.url || undefined, published_at: v.published_at || undefined,
        });
        i++;
      }
      onSaved(id);
    } catch (e) {
      setErrMsg(String((e as Error).message ?? e));
      setSaving(false);
    }
  };

  return (
    <div style={S.root}>
      <div style={S.head}>
        <span style={S.title}>Новая публикация</span>
        <div style={S.headBtns}>
          <button style={S.btnGhost} onClick={onCancel} disabled={saving}>Отмена</button>
          <button style={S.btnPrimary} onClick={handleSave} disabled={saving}>
            {saving ? 'Сохранение…' : 'Сохранить'}
          </button>
        </div>
      </div>

      {errMsg && <div style={S.errBanner}>{errMsg}</div>}

      <div style={S.row4}>
        <Field label="Publication ID" grow={1}>
          <input style={S.input} value={publicationId} placeholder="PUB-06" onChange={e => setPublicationId(e.target.value)} />
        </Field>
        <Field label="Название" grow={3}>
          <input style={S.input} value={title} placeholder="Заголовок публикации" onChange={e => setTitle(e.target.value)} />
        </Field>
        <Field label="Тип" grow={1}>
          <input style={S.input} value={type} onChange={e => setType(e.target.value)} />
        </Field>
        <Field label="Статус" grow={1}>
          <select style={S.input} value={status} onChange={e => setStatus(e.target.value)}>
            {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </Field>
      </div>

      <Field label="Ключ (тема)" grow={1}>
        <input style={S.input} value={topic} placeholder="AI governance" onChange={e => setTopic(e.target.value)} />
      </Field>

      <Sec label="Main-текст">
        <MdField value={mainText} onChange={setMainText} rows={4} placeholder="Мастер-версия текста…" />
      </Sec>

      <Sec label="Ключевые слова">
        <MultiChip
          values={keywordIds}
          onChange={setKeywordIds}
          suggestions={keywords.map(k => k.keyword_id)}
          suggestionLabels={Object.fromEntries(keywords.map(k => [k.keyword_id, k.phrase]))}
          placeholder="KW-01, KW-05…"
          freeForm={false}
        />
      </Sec>

      <Sec label="Вариации по площадкам">
        {variants.map((v, i) => (
          <div key={i} style={S.variantBlock}>
            <div style={S.variantRow}>
              <select style={S.variantSelect} value={v.channel_id} onChange={e => setVariant(i, { channel_id: e.target.value })}>
                <option value="">— площадка —</option>
                {channels.map(c => <option key={c.channel_id} value={c.channel_id}>{c.channel_id}</option>)}
              </select>
              <select style={S.variantSelectSm} value={v.status} onChange={e => setVariant(i, { status: e.target.value })}>
                {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
              <input style={S.variantInputSm} type="date" value={v.published_at}
                onChange={e => setVariant(i, { published_at: e.target.value })} />
              <button style={S.removeBtn} onClick={() => removeVariant(i)} disabled={variants.length === 1}>×</button>
            </div>
            <MdField value={v.text_md} onChange={t => setVariant(i, { text_md: t })} rows={3} placeholder="текст вариации…" />
          </div>
        ))}
        <button style={S.addVariantBtn} onClick={addVariant}>+ площадка</button>
      </Sec>
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
function Sec({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ marginTop: 14 }}>
      <div style={S.sLabel}>{label}</div>
      {children}
    </div>
  );
}

/** Markdown field with a Написать/Просмотр toggle — no new dependency, reuses
 * `marked` (already used for context_md/note_md rendering elsewhere in this app,
 * e.g. LoreSprintDetail.tsx) instead of adding a rich-text editor library. */
function MdField({ value, onChange, rows, placeholder }: {
  value: string; onChange: (v: string) => void; rows: number; placeholder: string;
}) {
  const [preview, setPreview] = useState(false);
  return (
    <div>
      <div style={S.mdTabs}>
        <span style={mdTabStyle(!preview)} onClick={() => setPreview(false)}>Написать</span>
        <span style={mdTabStyle(preview)} onClick={() => setPreview(true)}>Просмотр</span>
      </div>
      {preview ? (
        <div style={{ ...S.ta, minHeight: rows * 20 }} dangerouslySetInnerHTML={{ __html: value.trim() ? (marked.parse(value) as string) : '<span style="color:var(--t3)">пусто</span>' }} />
      ) : (
        <textarea style={S.ta} rows={rows} value={value} placeholder={placeholder} onChange={e => onChange(e.target.value)} />
      )}
    </div>
  );
}
function mdTabStyle(active: boolean): React.CSSProperties {
  const borderColor = active ? 'var(--b3)' : 'transparent';
  return {
    fontSize: 10, padding: '2px 8px', cursor: 'pointer', borderRadius: '4px 4px 0 0',
    color: active ? 'var(--acc)' : 'var(--t3)',
    background: active ? 'var(--b1)' : 'transparent',
    borderTop: `1px solid ${borderColor}`, borderLeft: `1px solid ${borderColor}`,
    borderRight: `1px solid ${borderColor}`, borderBottom: 'none',
  };
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
  sLabel:   { fontSize: 10, color: 'var(--t3)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 5 },
  ta:       { width: '100%', boxSizing: 'border-box', padding: '7px 9px', borderRadius: 4,
              border: '1px solid var(--b3)', background: 'var(--b1)', color: 'var(--t1)',
              fontSize: 12, fontFamily: 'var(--mono)', lineHeight: 1.55, resize: 'vertical', outline: 'none' },
  variantBlock: { border: '1px solid var(--b3)', borderRadius: 6, padding: 8, marginBottom: 8 },
  variantRow: { display: 'flex', gap: 8, marginBottom: 6, alignItems: 'center' },
  mdTabs:   { display: 'flex', gap: 2, marginBottom: -1, position: 'relative', zIndex: 1 },
  variantSelect:   { height: 28, borderRadius: 4, border: '1px solid var(--b3)', background: 'var(--b1)',
                     color: 'var(--t1)', fontSize: 12, padding: '0 6px', width: 100 },
  variantSelectSm: { height: 28, borderRadius: 4, border: '1px solid var(--b3)', background: 'var(--b1)',
                     color: 'var(--t1)', fontSize: 12, padding: '0 6px', width: 90 },
  variantInput:   { height: 28, flex: 1, borderRadius: 4, border: '1px solid var(--b3)', background: 'var(--b1)',
                    color: 'var(--t1)', fontSize: 12, padding: '0 8px', outline: 'none' },
  variantInputSm: { height: 28, borderRadius: 4, border: '1px solid var(--b3)', background: 'var(--b1)',
                    color: 'var(--t1)', fontSize: 12, padding: '0 6px', width: 140 },
  removeBtn: { height: 28, width: 28, borderRadius: 4, border: '1px solid var(--b3)', background: 'transparent',
               color: 'var(--t3)', cursor: 'pointer' },
  addVariantBtn: { marginTop: 4, height: 28, padding: '0 12px', borderRadius: 4, border: '1px dashed var(--bd)',
                   background: 'transparent', color: 'var(--t3)', fontSize: 12, cursor: 'pointer' },
  btnPrimary:{ height: 28, padding: '0 14px', borderRadius: 5, border: 'none', cursor: 'pointer',
               background: 'var(--acc)', color: '#fff', fontSize: 12, fontWeight: 600 },
  btnGhost:  { height: 28, padding: '0 12px', borderRadius: 5, cursor: 'pointer',
               background: 'transparent', color: 'var(--t2)', border: '1px solid var(--b3)', fontSize: 12 },
};
