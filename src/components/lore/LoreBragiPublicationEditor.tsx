// LoreBragiPublicationEditor — FE-06: create a BragiPublication with inline
// variants, modeled on LoreAdrEditor/LoreSprintEditor's create-form pattern.
// Wraps lore_create_publication/lore_create_variant (MCP-01) via their
// backend endpoints directly (same convention as LoreSprintEditor).
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { fetchLoreSlice } from '../../api/lore';
import { MultiChip } from './LoreAdrEditor';
import TipTapField from './TipTapField';
import type { RubricRow } from './LoreBragiRubricManager';

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
  /** Set when editing an existing variant — reused on save instead of
   * generating a new id from channel_id, so re-saving amends in place. */
  variant_id?: string;
  channel_id: string;
  text_md: string;
  sameAsMain: boolean;
  status: string;
  url: string;
  published_at: string;
}

const STATUSES = ['draft', 'ready', 'published', 'planned'];

/** Shape of an existing publication row (from the bragi_publications slice) —
 * passed in to switch the form into edit mode. */
export interface LoreBragiPublicationEditData {
  publication_id: string;
  title: string;
  topic: string | null;
  main_text_md: string | null;
  type: string | null;
  status_general: string | null;
  keyword_ids: string[];
  variant_ids: string[];
  variant_channels: string[];
  variant_statuses: string[];
  variant_urls: (string | null)[];
  variant_texts: (string | null)[];
  variant_published_at?: (string | null)[];
  rubric_ids?: string[];
}

export interface LoreBragiPublicationEditorProps {
  onSaved: (publicationId: string) => void;
  onCancel: () => void;
  /** Prefill the first variant's date (FE-07: calendar quick-add). */
  initialPublishedAt?: string;
  /** Present → edit this existing publication instead of creating a new one. */
  editing?: LoreBragiPublicationEditData;
  /** PUB-VIEW-01: published items open view-only — no inputs, no Save, just Закрыть. */
  readOnly?: boolean;
}

function variantsFromEditData(d: LoreBragiPublicationEditData): VariantDraft[] {
  if (d.variant_ids.length === 0) {
    return [{ channel_id: '', text_md: '', sameAsMain: true, status: 'draft', url: '', published_at: '' }];
  }
  return d.variant_ids.map((vid, i) => ({
    variant_id: vid,
    channel_id: d.variant_channels[i] ?? '',
    text_md: d.variant_texts[i] ?? '',
    sameAsMain: !d.variant_texts[i],
    status: d.variant_statuses[i] ?? 'draft',
    url: d.variant_urls[i] ?? '',
    published_at: d.variant_published_at?.[i] ?? '',
  }));
}

export default function LoreBragiPublicationEditor({ onSaved, onCancel, initialPublishedAt, editing, readOnly = false }: LoreBragiPublicationEditorProps) {
  const { t } = useTranslation();
  const [publicationId, setPublicationId] = useState(editing?.publication_id ?? '');
  const [title, setTitle] = useState(editing?.title ?? '');
  const [topic, setTopic] = useState(editing?.topic ?? '');
  const [mainText, setMainText] = useState(editing?.main_text_md ?? '');
  const [type, setType] = useState(editing?.type ?? 'article');
  const [status, setStatus] = useState(editing?.status_general ?? 'draft');
  const [keywordIds, setKeywordIds] = useState<string[]>(editing?.keyword_ids ?? []);
  const [variants, setVariants] = useState<VariantDraft[]>(
    editing ? variantsFromEditData(editing)
      : [{ channel_id: '', text_md: '', sameAsMain: true, status: 'draft', url: '', published_at: initialPublishedAt ?? '' }],
  );

  const [keywords, setKeywords] = useState<KeywordRow[]>([]);
  const [channels, setChannels] = useState<ChannelRow[]>([]);
  const [rubrics, setRubrics] = useState<RubricRow[]>([]);
  const [rubricId, setRubricId] = useState(editing?.rubric_ids?.[0] ?? '');
  const [saving, setSaving] = useState(false);
  const [errMsg, setErrMsg] = useState<string | null>(null);

  useEffect(() => {
    fetchLoreSlice<KeywordRow>('bragi_keys').then(setKeywords).catch(() => {});
    fetchLoreSlice<ChannelRow>('bragi_channels').then(setChannels).catch(() => {});
    fetchLoreSlice<RubricRow>('bragi_rubrics').then(setRubrics).catch(() => {});
  }, []);

  const setVariant = (i: number, patch: Partial<VariantDraft>) =>
    setVariants(vs => vs.map((v, vi) => (vi === i ? { ...v, ...patch } : v)));
  const addVariant = () =>
    setVariants(vs => [...vs, { channel_id: '', text_md: '', sameAsMain: true, status: 'draft', url: '', published_at: '' }]);
  const removeVariant = (i: number) => setVariants(vs => vs.filter((_, vi) => vi !== i));

  const handleSave = async () => {
    const id = publicationId.trim();
    if (!id) { setErrMsg(t('bragi.publicationEditor.errPublicationIdRequired', 'Publication ID обязателен')); return; }
    if (!title.trim()) { setErrMsg(t('bragi.publicationEditor.errTitleRequired', 'Название обязательно')); return; }
    setSaving(true);
    setErrMsg(null);
    try {
      await post('/bragi/publication', {
        publication_id: id, title: title.trim(),
        topic: topic || undefined, main_text_md: mainText || undefined,
        type: type || undefined, status_general: status || undefined,
        keyword_ids: keywordIds.length ? keywordIds : undefined,
        rubric_id: rubricId || undefined,
      });
      for (const v of variants) {
        if (!v.channel_id) continue; // skip empty rows
        const variantId = v.variant_id ?? `${id}-${v.channel_id.replace(/^CH-/, '')}`;
        await post('/bragi/variant', {
          variant_id: variantId, publication_id: id, channel_id: v.channel_id,
          // sameAsMain: explicit '' (not undefined) — the backend's partial-upsert
          // treats an omitted field as "leave untouched", so undefined wouldn't
          // clear a distinct text_md set before sameAsMain was (re-)checked
          // during an edit. Display falls back to main_text_md when text_md is
          // falsy either way (see LoreBragiPublications.tsx).
          text_md: v.sameAsMain ? '' : (v.text_md || undefined),
          status: v.status || undefined,
          url: v.url || undefined, published_at: v.published_at || undefined,
        });
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
        <span style={S.title}>
          {readOnly
            ? t('bragi.publicationEditor.titleView', 'Просмотр публикации')
            : editing
              ? t('bragi.publicationEditor.titleEdit', 'Редактирование публикации')
              : t('bragi.publicationEditor.titleNew', 'Новая публикация')}
        </span>
        <div style={S.headBtns}>
          <button style={S.btnGhost} onClick={onCancel} disabled={saving}>
            {readOnly ? t('bragi.publicationEditor.btnClose', 'Закрыть') : t('bragi.publicationEditor.btnCancel', 'Отмена')}
          </button>
          {!readOnly && (
            <button style={S.btnPrimary} onClick={handleSave} disabled={saving}>
              {saving ? t('bragi.publicationEditor.btnSaving', 'Сохранение…') : t('bragi.publicationEditor.btnSave', 'Сохранить')}
            </button>
          )}
        </div>
      </div>

      {errMsg && <div style={S.errBanner}>{errMsg}</div>}

      <div style={S.row4}>
        <Field label={t('bragi.publicationEditor.fieldPublicationId', 'Publication ID')} grow={1}>
          <input
            style={{ ...S.input, opacity: editing || readOnly ? 0.6 : 1 }}
            value={publicationId}
            placeholder="PUB-06"
            disabled={!!editing || readOnly}
            onChange={e => setPublicationId(e.target.value)}
          />
        </Field>
        <Field label={t('bragi.publicationEditor.fieldTitle', 'Название')} grow={3}>
          <input style={S.input} value={title} placeholder={t('bragi.publicationEditor.placeholderTitle', 'Заголовок публикации')} disabled={readOnly} onChange={e => setTitle(e.target.value)} />
        </Field>
        <Field label={t('bragi.publicationEditor.fieldType', 'Тип')} grow={1}>
          <input style={S.input} value={type} disabled={readOnly} onChange={e => setType(e.target.value)} />
        </Field>
        <Field label={t('bragi.publicationEditor.fieldStatus', 'Статус')} grow={1}>
          <select style={S.input} value={status} disabled={readOnly} onChange={e => setStatus(e.target.value)}>
            {STATUSES.map(s => <option key={s} value={s}>{t('bragi.publicationEditor.status.' + s, s)}</option>)}
          </select>
        </Field>
      </div>

      <div style={S.row4}>
        <Field label={t('bragi.publicationEditor.fieldTopic', 'Ключ (тема)')} grow={2}>
          <input style={S.input} value={topic} placeholder="AI governance" disabled={readOnly} onChange={e => setTopic(e.target.value)} />
        </Field>
        <Field label={t('bragi.publicationEditor.fieldRubric', 'Рубрика')} grow={1}>
          <select style={S.input} value={rubricId} disabled={readOnly} onChange={e => setRubricId(e.target.value)}>
            <option value="">{t('bragi.publicationEditor.rubricPlaceholder', '— рубрика —')}</option>
            {rubrics.map(r => <option key={r.rubric_id} value={r.rubric_id}>{r.name}</option>)}
          </select>
        </Field>
      </div>

      <Sec label={t('bragi.publicationEditor.sectionMainText', 'Main-текст')}>
        <TipTapField value={mainText} onChange={setMainText} minHeight={90} placeholder={t('bragi.publicationEditor.placeholderMainText', 'Мастер-версия текста…')} editable={!readOnly} />
      </Sec>

      <Sec label={t('bragi.publicationEditor.sectionKeywords', 'Ключевые слова')}>
        {readOnly ? (
          <div style={S.readOnlyChips}>
            {keywordIds.length
              ? keywordIds.map(k => <span key={k} style={S.readOnlyChip}>{keywords.find(kw => kw.keyword_id === k)?.phrase ?? k}</span>)
              : <span style={{ color: 'var(--t3)' }}>—</span>}
          </div>
        ) : (
          <MultiChip
            values={keywordIds}
            onChange={setKeywordIds}
            suggestions={keywords.map(k => k.keyword_id)}
            suggestionLabels={Object.fromEntries(keywords.map(k => [k.keyword_id, k.phrase]))}
            placeholder="KW-01, KW-05…"
            freeForm={false}
          />
        )}
      </Sec>

      <Sec label={t('bragi.publicationEditor.sectionVariants', 'Вариации по площадкам')}>
        {variants.map((v, i) => (
          <div key={i} style={S.variantBlock}>
            <div style={S.variantRow}>
              <select style={S.variantSelect} value={v.channel_id} disabled={readOnly} onChange={e => setVariant(i, { channel_id: e.target.value })}>
                <option value="">{t('bragi.publicationEditor.channelPlaceholder', '— площадка —')}</option>
                {channels.map(c => <option key={c.channel_id} value={c.channel_id}>{c.channel_id}</option>)}
              </select>
              <select style={S.variantSelectSm} value={v.status} disabled={readOnly} onChange={e => setVariant(i, { status: e.target.value })}>
                {STATUSES.map(s => <option key={s} value={s}>{t('bragi.publicationEditor.status.' + s, s)}</option>)}
              </select>
              <input style={S.variantInputSm} type="date" value={v.published_at} disabled={readOnly}
                onChange={e => setVariant(i, { published_at: e.target.value })} />
              {!readOnly && (
                <button style={S.removeBtn} onClick={() => removeVariant(i)} disabled={variants.length === 1}>{t('bragi.publicationEditor.btnRemoveVariant', '×')}</button>
              )}
            </div>
            <label style={S.sameAsMainLabel}>
              <input
                type="checkbox"
                checked={v.sameAsMain}
                disabled={readOnly}
                onChange={e => setVariant(i, { sameAsMain: e.target.checked })}
              />
              {t('bragi.publicationEditor.sameAsMainLabel', 'текст как в main-тексте')}
            </label>
            {!v.sameAsMain && (
              <TipTapField value={v.text_md} onChange={txt => setVariant(i, { text_md: txt })} minHeight={60} placeholder={t('bragi.publicationEditor.placeholderVariantText', 'текст вариации…')} editable={!readOnly} />
            )}
          </div>
        ))}
        {!readOnly && <button style={S.addVariantBtn} onClick={addVariant}>{t('bragi.publicationEditor.btnAddVariant', '+ площадка')}</button>}
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
  readOnlyChips: { display: 'flex', gap: 6, flexWrap: 'wrap' },
  readOnlyChip:  { fontSize: 11, color: 'var(--t2)', background: 'var(--b2)', border: '1px solid var(--b3)',
                   borderRadius: 4, padding: '3px 8px' },
  variantBlock: { border: '1px solid var(--b3)', borderRadius: 6, padding: 8, marginBottom: 8 },
  variantRow: { display: 'flex', gap: 8, marginBottom: 6, alignItems: 'center' },
  sameAsMainLabel: { display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: 'var(--t2)', marginBottom: 6, cursor: 'pointer' },
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
