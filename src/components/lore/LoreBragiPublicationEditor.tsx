// LoreBragiPublicationEditor — FE-06: create a BragiPublication with inline
// variants, modeled on LoreAdrEditor/LoreSprintEditor's create-form pattern.
// Wraps lore_create_publication/lore_create_variant (MCP-01) via their
// backend endpoints directly (same convention as LoreSprintEditor).
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  fetchLoreSlice, uploadBragiAsset, attachBragiAsset, createBragiCampaign, linkBragiForseti,
  fetchBragiMetrics, type LoreSprintRow, type LoreRelease, type BragiMetricPoint,
} from '../../api/lore';
import { MultiChip } from './LoreAdrEditor';
import TipTapField from './TipTapField';
import BragiSkinPreview, { type BragiSkin } from './BragiSkinPreview';
import { useIsNarrow } from '../../hooks/useMediaQuery';
import type { RubricRow } from './LoreBragiRubricManager';
import { activeCharLimit, validateSkin, validateVariant, type ValidationIssue } from './bragiValidators';

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
interface ChannelRow { channel_id: string; channel_type: string | null; rules_md?: string | null }

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
  /** EDIT-03: variant-specific teaser/og image (own BragiAsset, separate from
   * the publication cover). Requires variant_id — upload gated on prior save. */
  imageUrl?: string;
  /** EDIT-04: UTM block — generates a BragiCampaign + tagged target_url. */
  utmSource?: string;
  utmMedium?: string;
  utmCampaign?: string;
  campaignUrl?: string;
}

// EDIT-02: seed text for a satellite created from the main-preview — TG gets
// lead paragraph + link + tag, VC gets full text + footer link, Habr/site/
// Telegraph get the full text unchanged (their kicker/byline is chrome the
// skin itself renders, not part of the stored text).
function draftForChannel(skin: BragiSkin, mainText: string): string {
  const text = mainText.trim();
  if (skin === 'tg') {
    const lead = text.split(/\n\n+/)[0] ?? text;
    return `${lead}\n\n[читать полностью →](https://seidrstudio.pro/blog/…)\n\n#SeidrAI`;
  }
  if (skin === 'vc') {
    return `${text}\n\n---\n[Читать в Seiðr Studio](https://seidrstudio.pro)`;
  }
  return text;
}

// EXP-01: "скопировать для площадки" — buffer in the target platform's
// expected format so pasting into that platform's own editor needs no manual
// touch-up. TG wants plain text (markdown syntax reads as literal chars in
// the TG composer); VC/Habr/site take the markdown source as-is (their own
// editors are markdown-aware); Telegraph gets a JSON placeholder until
// EXP-01's node-API export lands with CH-TELEGRAPH-01's connector.
function formatForClipboard(skin: BragiSkin, textMd: string): string {
  const text = textMd || '';
  if (skin === 'tg') {
    return text
      .replace(/^#{1,6}\s*/gm, '')
      .replace(/\*\*(.+?)\*\*/g, '$1')
      .replace(/\*(.+?)\*/g, '$1')
      .replace(/`{1,3}([^`]+)`{1,3}/g, '$1')
      .replace(/\[(.+?)\]\((.+?)\)/g, '$1: $2');
  }
  if (skin === 'tgraph') {
    return JSON.stringify({ note: 'Telegraph node-API export lands with EXP-01/CH-TELEGRAPH-01', text }, null, 2);
  }
  return text;
}

const STATUSES = ['draft', 'ready', 'published', 'planned'];

// REN-00: master-preview skin switcher — "MAIN in the skin of any channel".
const SKIN_CHIPS: [BragiSkin, string][] = [
  ['main', 'мастер'], ['tg', 'TG'], ['vc', 'VC'], ['habr', 'Habr'], ['site', 'сайт'], ['tgraph', 'Telegraph'],
];

// REN-00: map a channel id to its preview skin (more-specific patterns first).
const CHANNEL_SKIN: [RegExp, BragiSkin][] = [
  [/TELEGRAPH|TGRAPH/i, 'tgraph'], [/TG|TELEGRAM/i, 'tg'], [/VC/i, 'vc'],
  [/HABR/i, 'habr'], [/SITE|BLOG/i, 'site'],
];
function channelToSkin(channelId: string): BragiSkin {
  for (const [re, skin] of CHANNEL_SKIN) if (re.test(channelId)) return skin;
  return 'main';
}
function statusDot(s: string): string {
  return s === 'published' ? '#6fae5a' : s === 'ready' ? 'var(--acc)' : 'var(--t3)';
}

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
  source_file_path?: string | null;
  cover_asset_urls?: string[];
  /** EDIT-05: existing Forseti graph edges (out('PRODUCED_BY')/out('SHIPPED_IN')). */
  produced_by_task_ids?: string[];
  produced_by_sprint_ids?: string[];
  shipped_in_release_ids?: string[];
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
  const [sourceFilePath, setSourceFilePath] = useState(editing?.source_file_path ?? '');
  const [coverUrl, setCoverUrl] = useState(editing?.cover_asset_urls?.[0] ?? null);
  const [coverUploading, setCoverUploading] = useState(false);
  const coverInputRef = useRef<HTMLInputElement>(null);
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
  // REN-00: which platform skin the right-hand preview renders the master text in.
  const [previewSkin, setPreviewSkin] = useState<BragiSkin>('main');
  const [previewSiteTheme, setPreviewSiteTheme] = useState<'dark' | 'light'>('dark');
  // REN-00: preview target — 'main' (master text, skin chosen by chips) or a
  // variant index (its effective text in its own channel's skin).
  const [previewTarget, setPreviewTarget] = useState<'main' | number>('main');

  // EDIT-05: Forseti graph links, prefilled from the publication's existing
  // PRODUCED_BY/SHIPPED_IN edges when editing. Diffed against these initial
  // arrays at save time so only genuinely added/removed chips hit the network.
  const [producedByTasks, setProducedByTasks] = useState<string[]>(editing?.produced_by_task_ids ?? []);
  const [producedBySprints, setProducedBySprints] = useState<string[]>(editing?.produced_by_sprint_ids ?? []);
  const [shippedInReleases, setShippedInReleases] = useState<string[]>(editing?.shipped_in_release_ids ?? []);
  const [sprints, setSprints] = useState<LoreSprintRow[]>([]);
  const [releases, setReleases] = useState<LoreRelease[]>([]);

  useEffect(() => {
    fetchLoreSlice<KeywordRow>('bragi_keys').then(setKeywords).catch(() => {});
    fetchLoreSlice<ChannelRow>('bragi_channels').then(setChannels).catch(() => {});
    fetchLoreSlice<RubricRow>('bragi_rubrics').then(setRubrics).catch(() => {});
    fetchLoreSlice<LoreSprintRow>('sprints').then(setSprints).catch(() => {});
    fetchLoreSlice<LoreRelease>('releases').then(setReleases).catch(() => {});
  }, []);

  // EDIT-01: localStorage draft autosave — protects against a closed tab/
  // crashed browser losing unsaved edits. Deliberately client-side only, not
  // an SCD2 backend write on every keystroke (would spam task history for no
  // real audit value). Cleared on successful save.
  const draftKey = `bragi-draft-${editing?.publication_id ?? '__new__'}`;
  const [restoreDraft, setRestoreDraft] = useState<{ title: string; mainText: string; variants: VariantDraft[]; ts: number } | null>(null);
  useEffect(() => {
    try {
      const raw = localStorage.getItem(draftKey);
      if (!raw) return;
      const parsed = JSON.parse(raw) as { title: string; mainText: string; variants: VariantDraft[]; ts: number };
      if (parsed.mainText !== mainText || JSON.stringify(parsed.variants) !== JSON.stringify(variants)) {
        setRestoreDraft(parsed);
      }
    } catch { /* corrupt/old-shape draft — ignore */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftKey]);
  useEffect(() => {
    const h = setTimeout(() => {
      try { localStorage.setItem(draftKey, JSON.stringify({ title, mainText, variants, ts: Date.now() })); } catch { /* quota/private-mode — draft is best-effort */ }
    }, 1000);
    return () => clearTimeout(h);
  }, [draftKey, title, mainText, variants]);

  const setVariant = (i: number, patch: Partial<VariantDraft>) =>
    setVariants(vs => vs.map((v, vi) => (vi === i ? { ...v, ...patch } : v)));
  const addVariant = () =>
    setVariants(vs => [...vs, { channel_id: '', text_md: '', sameAsMain: true, status: 'draft', url: '', published_at: '' }]);
  const removeVariant = (i: number) => setVariants(vs => vs.filter((_, vi) => vi !== i));

  // Cover image: gap reported 2026-07-03 — lore_attach_asset/lore_upload_asset
  // existed as MCP-only capabilities, no UI control ever called them for a
  // publication's own cover (only inline TipTap images, IMG-04). Requires the
  // publication to already have an id (new + unsaved has nowhere to attach to
  // yet — save the publication first).
  const handleCoverUpload = async (file: File) => {
    const id = publicationId.trim();
    if (!id) { setErrMsg(t('bragi.publicationEditor.errPublicationIdRequired', 'Publication ID обязателен')); return; }
    setCoverUploading(true);
    setErrMsg(null);
    try {
      const { file_url, size_bytes } = await uploadBragiAsset(file);
      const assetId = `ASSET-${id}-COVER-${Date.now()}`;
      await attachBragiAsset({
        asset_id: assetId, file_url, asset_type: 'cover', size_bytes,
        attach_to_publication_id: id,
      });
      setCoverUrl(file_url);
    } catch (e) {
      setErrMsg(String((e as Error).message ?? e));
    } finally {
      setCoverUploading(false);
      if (coverInputRef.current) coverInputRef.current.value = '';
    }
  };

  // EDIT-05: sync PRODUCED_BY/SHIPPED_IN edges — diff current chip selections
  // against what `editing` loaded with, so only genuinely added/removed
  // targets hit the network (backend CREATE EDGE is idempotent via IF NOT
  // EXISTS, but DELETE isn't, so an unconditional re-add-all would be fine
  // while an unconditional remove-all would drop edges the user didn't touch).
  const syncForsetiLinks = async (pubId: string) => {
    const diffAndSync = async (current: string[], initial: string[], targetType: 'task' | 'sprint' | 'release', edgeType: 'PRODUCED_BY' | 'SHIPPED_IN') => {
      for (const targetId of current.filter(x => !initial.includes(x))) {
        await linkBragiForseti({ entity_type: 'publication', entity_id: pubId, edge_type: edgeType, target_type: targetType, target_id: targetId, action: 'add' });
      }
      for (const targetId of initial.filter(x => !current.includes(x))) {
        await linkBragiForseti({ entity_type: 'publication', entity_id: pubId, edge_type: edgeType, target_type: targetType, target_id: targetId, action: 'remove' });
      }
    };
    await diffAndSync(producedByTasks, editing?.produced_by_task_ids ?? [], 'task', 'PRODUCED_BY');
    await diffAndSync(producedBySprints, editing?.produced_by_sprint_ids ?? [], 'sprint', 'PRODUCED_BY');
    await diffAndSync(shippedInReleases, editing?.shipped_in_release_ids ?? [], 'release', 'SHIPPED_IN');
  };

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
        source_file_path: sourceFilePath || undefined,
      });
      // Computed ids captured back into state below — a brand-new variant's
      // variant_id is otherwise never set locally, which would leave the
      // EDIT-03 image-upload/EDIT-04 campaign gates (they require a variant_id
      // that's confirmed to exist in the DB, since CREATE EDGE silently no-ops
      // against a nonexistent vertex) permanently disabled after first save.
      const savedVariantIds: (string | undefined)[] = [];
      for (const v of variants) {
        if (!v.channel_id) { savedVariantIds.push(v.variant_id); continue; } // skip empty rows
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
        savedVariantIds.push(variantId);
      }
      setVariants(vs => vs.map((v, i) => savedVariantIds[i] ? { ...v, variant_id: savedVariantIds[i] } : v));
      await syncForsetiLinks(id);
      try { localStorage.removeItem(draftKey); } catch { /* best-effort */ }
      onSaved(id);
    } catch (e) {
      setErrMsg(String((e as Error).message ?? e));
      setSaving(false);
    }
  };

  // EDIT-03: variant teaser/og image — same two-step upload+attach as the
  // publication cover, scoped to attach_to_variant_id. Gated on v.variant_id
  // (not just channel_id) because CREATE EDGE against a not-yet-saved variant
  // silently no-ops — the row must be saved at least once first.
  const [variantImgUploadingIdx, setVariantImgUploadingIdx] = useState<number | null>(null);
  const handleVariantImageUpload = async (i: number, file: File) => {
    const v = variants[i];
    if (!v.variant_id) return;
    setVariantImgUploadingIdx(i);
    setErrMsg(null);
    try {
      const { file_url, size_bytes } = await uploadBragiAsset(file);
      const assetId = `ASSET-${v.variant_id}-IMG-${Date.now()}`;
      await attachBragiAsset({ asset_id: assetId, file_url, asset_type: 'teaser', size_bytes, attach_to_variant_id: v.variant_id });
      setVariant(i, { imageUrl: file_url });
    } catch (e) {
      setErrMsg(String((e as Error).message ?? e));
    } finally {
      setVariantImgUploadingIdx(null);
    }
  };

  // EDIT-04: UTM block — creates/amends a BragiCampaign tied to the variant
  // (FOR_VARIANT edge) and derives the tagged URL client-side for display/copy.
  const [campaignGeneratingIdx, setCampaignGeneratingIdx] = useState<number | null>(null);
  const handleGenerateCampaign = async (i: number) => {
    const v = variants[i];
    if (!v.variant_id) return;
    setCampaignGeneratingIdx(i);
    setErrMsg(null);
    try {
      const targetUrl = v.url.trim() || 'https://seidrstudio.pro';
      await createBragiCampaign({
        campaign_id: `CMP-${v.variant_id}`,
        utm_source: v.utmSource || undefined,
        utm_medium: v.utmMedium || undefined,
        utm_campaign: v.utmCampaign || undefined,
        target_url: targetUrl,
        variant_id: v.variant_id,
      });
      const u = new URL(targetUrl);
      if (v.utmSource) u.searchParams.set('utm_source', v.utmSource);
      if (v.utmMedium) u.searchParams.set('utm_medium', v.utmMedium);
      if (v.utmCampaign) u.searchParams.set('utm_campaign', v.utmCampaign);
      setVariant(i, { campaignUrl: u.toString() });
    } catch (e) {
      setErrMsg(String((e as Error).message ?? e));
    } finally {
      setCampaignGeneratingIdx(null);
    }
  };

  // EDIT-02: "создать сателлит для этого канала" from the main-in-skin
  // preview — adds a variant prefilled with a channel-appropriate extract of
  // the master text, or just switches to it if one already exists.
  const SKIN_TO_CHANNEL: Partial<Record<BragiSkin, string>> = { tg: 'CH-TG', vc: 'CH-VC', habr: 'CH-HABR', site: 'CH-SITE', tgraph: 'CH-TELEGRAPH' };
  const handleCreateSatellite = () => {
    const channelId = SKIN_TO_CHANNEL[previewSkin];
    if (!channelId) return;
    const existingIdx = variants.findIndex(v => v.channel_id === channelId);
    if (existingIdx >= 0) { setPreviewTarget(existingIdx); return; }
    setVariants(vs => [...vs, {
      channel_id: channelId, text_md: draftForChannel(previewSkin, mainText),
      sameAsMain: false, status: 'draft', url: '', published_at: '',
    }]);
    setPreviewTarget(variants.length);
  };

  // MOB-02: below the narrow breakpoint the two panes stack vertically (form
  // on top, preview capped below) instead of the 320px preview crushing the form.
  const narrow = useIsNarrow(760);
  const panesStyle = narrow ? { ...S.panes, flexDirection: 'column' as const } : S.panes;
  const rightPaneStyle = narrow
    ? { ...S.rightPane, width: 'auto', minWidth: 0, flex: 'none', maxHeight: '55vh', borderLeft: 'none', borderTop: '1px solid var(--b3)' }
    : S.rightPane;

  // REN-00: resolve what the preview renders based on the selected tab.
  const activeVariant = typeof previewTarget === 'number' && previewTarget < variants.length ? variants[previewTarget] : null;
  const previewIsMain = activeVariant == null;
  const previewSkinEff: BragiSkin = previewIsMain ? previewSkin : channelToSkin(activeVariant!.channel_id);
  const previewTextEff = previewIsMain ? mainText : (activeVariant!.sameAsMain ? mainText : activeVariant!.text_md);
  const previewChannelName = previewIsMain ? (title || undefined) : (activeVariant!.channel_id || undefined);
  const previewDate = previewIsMain ? undefined : (activeVariant!.published_at || undefined);

  // VAL-01: rules_md-driven checks for whatever the preview is currently
  // showing — the channel that owns the active skin (main tab: mapped from
  // the selected skin chip; variant tab: the variant's own channel).
  const previewChannelId = previewIsMain
    ? channels.find(c => channelToSkin(c.channel_id) === previewSkinEff)?.channel_id
    : activeVariant!.channel_id;
  const previewRulesMd = channels.find(c => c.channel_id === previewChannelId)?.rules_md;
  const previewCharLimit = activeCharLimit(previewSkinEff, previewRulesMd);
  const previewIssues: ValidationIssue[] = [
    ...validateSkin(previewSkinEff, previewTextEff, previewRulesMd),
    ...(activeVariant ? validateVariant(activeVariant, mainText) : []),
  ];
  const overLimit = previewCharLimit != null && (previewTextEff || '').length > previewCharLimit;
  const canCreateSatellite = previewIsMain && !!SKIN_TO_CHANNEL[previewSkin] && !variants.some(v => v.channel_id === SKIN_TO_CHANNEL[previewSkin]);

  return (
    <div style={S.shell}>
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
      {!readOnly && restoreDraft && (
        <div style={S.restoreBanner}>
          <span>{t('bragi.publicationEditor.draftFound', 'Найден несохранённый черновик от {{ts}}', { ts: new Date(restoreDraft.ts).toLocaleString('ru') })}</span>
          <button style={S.btnGhost} onClick={() => {
            setTitle(restoreDraft.title); setMainText(restoreDraft.mainText); setVariants(restoreDraft.variants); setRestoreDraft(null);
          }}>{t('bragi.publicationEditor.draftRestore', 'восстановить')}</button>
          <button style={S.btnGhost} onClick={() => { setRestoreDraft(null); try { localStorage.removeItem(draftKey); } catch { /* noop */ } }}>
            {t('bragi.publicationEditor.draftDismiss', 'отклонить')}
          </button>
        </div>
      )}

      <div style={panesStyle}>
        <div style={S.leftPane}>
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
        <Field label={t('bragi.publicationEditor.fieldSourcePath', 'Файл на диске')} grow={2}>
          <input
            style={S.input} value={sourceFilePath}
            placeholder="C:\Маркетинг\habr-h1-sql-dedup.md"
            disabled={readOnly}
            onChange={e => setSourceFilePath(e.target.value)}
          />
        </Field>
      </div>

      <Sec label={t('bragi.publicationEditor.sectionCover', 'Обложка')}>
        <div style={S.coverRow}>
          {coverUrl ? (
            <img src={coverUrl} alt="" style={S.coverPreview} />
          ) : (
            <div style={S.coverPlaceholder}>{t('bragi.publications.noImage', 'нет изображения')}</div>
          )}
          {!readOnly && (
            <div>
              <input
                ref={coverInputRef} type="file" accept="image/*" style={{ display: 'none' }}
                onChange={e => { const f = e.target.files?.[0]; if (f) void handleCoverUpload(f); }}
              />
              <button
                style={S.btnGhost} disabled={coverUploading}
                onClick={() => coverInputRef.current?.click()}
              >
                {coverUploading ? t('bragi.publicationEditor.coverUploading', 'Загрузка…')
                  : coverUrl ? t('bragi.publicationEditor.coverReplace', 'Заменить обложку')
                  : t('bragi.publicationEditor.coverUpload', 'Загрузить обложку')}
              </button>
              {!publicationId.trim() && (
                <div style={S.coverHint}>{t('bragi.publicationEditor.coverNeedsId', 'сначала укажите Publication ID')}</div>
              )}
            </div>
          )}
        </div>
      </Sec>

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

      <Sec label={t('bragi.publicationEditor.sectionForseti', 'Связи с работой (Forseti)')}>
        {readOnly ? (
          <div style={S.readOnlyChips}>
            {[...producedByTasks, ...producedBySprints, ...shippedInReleases].length
              ? [...producedByTasks, ...producedBySprints, ...shippedInReleases].map(x => <span key={x} style={S.readOnlyChip}>{x}</span>)
              : <span style={{ color: 'var(--t3)' }}>—</span>}
          </div>
        ) : (
          <div style={S.forsetiGrid}>
            <div>
              <div style={S.forsetiLabel}>{t('bragi.publicationEditor.forsetiSprint', 'спринт (PRODUCED_BY)')}</div>
              <MultiChip
                values={producedBySprints} onChange={setProducedBySprints}
                suggestions={sprints.map(s => s.sprint_id)}
                suggestionLabels={Object.fromEntries(sprints.map(s => [s.sprint_id, s.name]))}
                placeholder="SPRINT_…" freeForm={false}
              />
            </div>
            <div>
              <div style={S.forsetiLabel}>{t('bragi.publicationEditor.forsetiTask', 'задача (PRODUCED_BY)')}</div>
              <MultiChip
                values={producedByTasks} onChange={setProducedByTasks}
                suggestions={[]} suggestionLabels={{}}
                placeholder="SPRINT_X/TASK-01" freeForm
              />
            </div>
            <div>
              <div style={S.forsetiLabel}>{t('bragi.publicationEditor.forsetiRelease', 'релиз (SHIPPED_IN)')}</div>
              <MultiChip
                values={shippedInReleases} onChange={setShippedInReleases}
                suggestions={releases.map(r => r.release_id)}
                suggestionLabels={Object.fromEntries(releases.map(r => [r.release_id, r.git_tag ?? r.release_id]))}
                placeholder="v1.0.32" freeForm={false}
              />
            </div>
          </div>
        )}
      </Sec>

      <Sec label={t('bragi.publicationEditor.sectionVariants', 'Вариации по площадкам')}>
        {/* Status/publish date genuinely differ per channel — a post live on
            CH-TG can still be draft on CH-HABR. Locking the WHOLE form once
            status_general said "published" (old readOnly behavior) blocked
            editing every other still-unpublished variant too. Lock only the
            content of a variant that is itself already published — channel
            pick, text, and removal — status/date stay editable everywhere so
            you can still correct a date or bump status forward. */}
        {variants.map((v, i) => {
          const variantLocked = readOnly || v.status === 'published';
          return (
          <div key={i} style={S.variantBlock}>
            <div style={S.variantRow}>
              <select style={S.variantSelect} value={v.channel_id} disabled={variantLocked} onChange={e => setVariant(i, { channel_id: e.target.value })}>
                <option value="">{t('bragi.publicationEditor.channelPlaceholder', '— площадка —')}</option>
                {channels.map(c => <option key={c.channel_id} value={c.channel_id}>{c.channel_id}</option>)}
              </select>
              <select style={S.variantSelectSm} value={v.status} disabled={readOnly} onChange={e => setVariant(i, { status: e.target.value })}>
                {STATUSES.map(s => <option key={s} value={s}>{t('bragi.publicationEditor.status.' + s, s)}</option>)}
              </select>
              <input style={S.variantInputSm} type="date" value={v.published_at} disabled={readOnly}
                onChange={e => setVariant(i, { published_at: e.target.value })} />
              {!variantLocked && (
                <button style={S.removeBtn} onClick={() => removeVariant(i)} disabled={variants.length === 1}>{t('bragi.publicationEditor.btnRemoveVariant', '×')}</button>
              )}
            </div>
            {/* EDIT-03: URL опубликованного материала — field already existed
                on VariantDraft/backend but had no input control. */}
            <input
              style={{ ...S.variantInput, marginBottom: 6 }} type="url" value={v.url} disabled={readOnly}
              placeholder={t('bragi.publicationEditor.variantUrlPlaceholder', 'URL опубликованного материала…')}
              onChange={e => setVariant(i, { url: e.target.value })}
            />
            <label style={S.sameAsMainLabel}>
              <input
                type="checkbox"
                checked={v.sameAsMain}
                disabled={variantLocked}
                onChange={e => setVariant(i, { sameAsMain: e.target.checked })}
              />
              {t('bragi.publicationEditor.sameAsMainLabel', 'текст как в main-тексте')}
            </label>
            {!v.sameAsMain && (
              <TipTapField value={v.text_md} onChange={txt => setVariant(i, { text_md: txt })} minHeight={60} placeholder={t('bragi.publicationEditor.placeholderVariantText', 'текст вариации…')} editable={!variantLocked} />
            )}
            {!readOnly && (
              <div style={S.variantExtras}>
                {/* EDIT-03: variant teaser/og image */}
                <div style={S.variantImgRow}>
                  {v.imageUrl ? <img src={v.imageUrl} alt="" style={S.variantImgThumb} /> : <div style={S.variantImgPlaceholder}>{t('bragi.publications.noImage', 'нет изображения')}</div>}
                  <VariantFileInput
                    disabled={!v.variant_id || variantImgUploadingIdx === i}
                    uploading={variantImgUploadingIdx === i}
                    hint={!v.variant_id ? t('bragi.publicationEditor.variantImgNeedsSave', 'сначала сохраните') : undefined}
                    label={v.imageUrl ? t('bragi.publicationEditor.coverReplace', 'Заменить обложку') : t('bragi.publicationEditor.variantImgUpload', 'изображение вариации')}
                    onFile={f => void handleVariantImageUpload(i, f)}
                  />
                </div>
                {/* EDIT-04: UTM campaign block */}
                <div style={S.utmRow}>
                  <input style={S.utmInput} value={v.utmSource ?? ''} placeholder="utm_source" onChange={e => setVariant(i, { utmSource: e.target.value })} />
                  <input style={S.utmInput} value={v.utmMedium ?? ''} placeholder="utm_medium" onChange={e => setVariant(i, { utmMedium: e.target.value })} />
                  <input style={S.utmInput} value={v.utmCampaign ?? ''} placeholder="utm_campaign" onChange={e => setVariant(i, { utmCampaign: e.target.value })} />
                  <button
                    type="button" style={S.btnGhost} disabled={!v.variant_id || campaignGeneratingIdx === i}
                    title={!v.variant_id ? t('bragi.publicationEditor.variantImgNeedsSave', 'сначала сохраните') : undefined}
                    onClick={() => void handleGenerateCampaign(i)}
                  >
                    {campaignGeneratingIdx === i ? '…' : t('bragi.publicationEditor.utmGenerate', 'сгенерировать ссылку')}
                  </button>
                </div>
                {v.campaignUrl && (
                  <div style={S.campaignUrlRow}>
                    <code style={S.campaignUrlText}>{v.campaignUrl}</code>
                    <button type="button" style={S.copyBtnSm} onClick={() => { void navigator.clipboard.writeText(v.campaignUrl!); }}>⧉</button>
                  </div>
                )}
                {/* EDIT-06: read-only metrics once the variant is live */}
                {v.status === 'published' && v.variant_id && <VariantMetrics variantId={v.variant_id} />}
              </div>
            )}
          </div>
          );
        })}
        {!readOnly && <button style={S.addVariantBtn} onClick={addVariant}>{t('bragi.publicationEditor.btnAddVariant', '+ площадка')}</button>}
      </Sec>
        </div>

        <aside style={rightPaneStyle}>
          {/* Variant tab bar: master + one tab per channel variant. Selecting a
              variant previews its effective text (own or inherited) in its
              channel's skin. */}
          <div style={S.previewTabs}>
            <button type="button" style={previewIsMain ? S.pvTabOn : S.pvTab} onClick={() => setPreviewTarget('main')}>
              {t('bragi.publicationEditor.previewMaster', 'мастер')}
            </button>
            {variants.map((v, i) => v.channel_id ? (
              <button key={i} type="button" style={(!previewIsMain && previewTarget === i) ? S.pvTabOn : S.pvTab} onClick={() => setPreviewTarget(i)}>
                <span style={{ ...S.pvDot, background: statusDot(v.status) }} />
                {v.channel_id.replace(/^CH-/, '')}
              </button>
            ) : null)}
          </div>
          <div style={S.previewHead}>
            {previewIsMain ? (
              <>
                {SKIN_CHIPS.map(([key, label]) => (
                  <button key={key} type="button" style={previewSkin === key ? S.skinChipOn : S.skinChip} onClick={() => setPreviewSkin(key)}>{label}</button>
                ))}
                {previewSkin === 'site' && (['dark', 'light'] as const).map(th => (
                  <button key={th} type="button" style={previewSiteTheme === th ? S.skinChipOn : S.skinChip} onClick={() => setPreviewSiteTheme(th)}>{th === 'dark' ? '🌑' : '☀'}</button>
                ))}
                {/* EDIT-02: one click from "main in the skin of a channel" to a
                    real satellite variant seeded with a channel-shaped extract. */}
                {!readOnly && canCreateSatellite && (
                  <button type="button" style={S.skinChip} onClick={handleCreateSatellite}>
                    {t('bragi.publicationEditor.createSatellite', '+ создать сателлит')}
                  </button>
                )}
              </>
            ) : (
              <span style={S.pvSkinName}>
                {t('bragi.publicationEditor.previewSkinLabel', 'скин')}: {previewSkinEff}
                {activeVariant?.sameAsMain ? ' · ' + t('bragi.publicationEditor.inheritsMain', 'наследует main') : ''}
              </span>
            )}
            <button
              type="button" style={S.copyBtn}
              title={t('bragi.publicationEditor.copyForPlatform', 'скопировать для площадки')}
              onClick={() => { void navigator.clipboard.writeText(formatForClipboard(previewSkinEff, previewTextEff || '')); }}
            >⧉</button>
            <span style={{ ...S.counter, color: overLimit ? 'var(--dng)' : undefined }}>
              {(previewTextEff || '').length.toLocaleString('ru')}{previewCharLimit != null ? ` / ${previewCharLimit.toLocaleString('ru')}` : ''} зн
            </span>
          </div>
          {/* VAL-01: rules_md-driven checks for the currently previewed skin/variant. */}
          {previewIssues.length > 0 && (
            <div style={S.issuesStrip}>
              {previewIssues.map((iss, idx) => (
                <span key={idx} style={iss.level === 'warn' ? S.issueWarn : S.issueInfo}>
                  {iss.level === 'warn' ? '⚠' : 'ℹ'} {iss.message}
                </span>
              ))}
            </div>
          )}
          <div style={S.previewBody}>
            <BragiSkinPreview
              skin={previewSkinEff}
              textMd={previewTextEff || ''}
              siteTheme={previewSiteTheme}
              teaser={(previewIsMain ? coverUrl : activeVariant?.imageUrl || coverUrl) || undefined}
              meta={{ channelName: previewChannelName, date: previewDate }}
            />
          </div>
        </aside>
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
function Sec({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ marginTop: 14 }}>
      <div style={S.sLabel}>{label}</div>
      {children}
    </div>
  );
}

// EDIT-06: read-only mini-metrics for a published variant — one point per
// metric name (latest value the feed returned; MetricSnapshot rows come back
// newest-first per fetchBragiMetrics/lore_query_metric's default ordering).
function VariantMetrics({ variantId }: { variantId: string }) {
  const [points, setPoints] = useState<BragiMetricPoint[] | null>(null);
  useEffect(() => {
    let cancelled = false;
    fetchBragiMetrics({ object_type: 'variant', object_id: variantId })
      .then(p => { if (!cancelled) setPoints(p); })
      .catch(() => { if (!cancelled) setPoints([]); });
    return () => { cancelled = true; };
  }, [variantId]);
  if (!points || points.length === 0) return null;
  const byMetric = new Map<string, number>();
  for (const p of points) if (!byMetric.has(p.metric)) byMetric.set(p.metric, p.value);
  return (
    <div style={S.metricsRow}>
      {[...byMetric.entries()].map(([m, v]) => (
        <span key={m} style={S.metricChip}>{m}: {v.toLocaleString('ru')}</span>
      ))}
    </div>
  );
}

// EDIT-03: variant-scoped file picker — needs its own ref per row (used
// inside variants.map), unlike the single shared publication-cover input.
function VariantFileInput({ disabled, uploading, hint, label, onFile }: {
  disabled: boolean; uploading: boolean; hint?: string; label: string; onFile: (f: File) => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <div>
      <input
        ref={ref} type="file" accept="image/*" style={{ display: 'none' }}
        onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) onFile(f); }}
      />
      <button type="button" style={S.btnGhost} disabled={disabled} onClick={() => ref.current?.click()}>
        {uploading ? '…' : label}
      </button>
      {hint && <div style={S.coverHint}>{hint}</div>}
    </div>
  );
}

const S: Record<string, React.CSSProperties> = {
  shell:    { flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, fontFamily: 'var(--font)', fontSize: 12 },
  head:     { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, padding: '12px 20px' },
  title:    { fontSize: 14, fontWeight: 600, color: 'var(--t1)' },
  headBtns: { display: 'flex', gap: 8 },
  errBanner:{ margin: '0 20px 10px', padding: '6px 10px', borderRadius: 5, fontSize: 11,
              background: 'color-mix(in srgb, var(--dng) 12%, transparent)',
              color: 'var(--dng)', border: '1px solid color-mix(in srgb, var(--dng) 30%, transparent)' },
  panes:    { flex: 1, display: 'flex', minHeight: 0, borderTop: '1px solid var(--b3)' },
  leftPane: { flex: 1, overflowY: 'auto', padding: '14px 20px 40px', minWidth: 0 },
  rightPane:{ width: '44%', minWidth: 320, borderLeft: '1px solid var(--b3)', display: 'flex', flexDirection: 'column', minHeight: 0, background: 'var(--bg1)' },
  previewTabs: { display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap', padding: '8px 12px 0' },
  pvTab:     { display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11, padding: '4px 9px', borderRadius: '6px 6px 0 0', borderTop: '1px solid var(--b3)', borderLeft: '1px solid var(--b3)', borderRight: '1px solid var(--b3)', borderBottom: 'none', background: 'transparent', color: 'var(--t3)', cursor: 'pointer' },
  pvTabOn:   { display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11, padding: '4px 9px', borderRadius: '6px 6px 0 0', borderTop: '1px solid var(--acc)', borderLeft: '1px solid var(--acc)', borderRight: '1px solid var(--acc)', borderBottom: 'none', background: 'color-mix(in srgb, var(--acc) 12%, transparent)', color: 'var(--acc)', cursor: 'pointer' },
  pvDot:     { width: 7, height: 7, borderRadius: '50%', flex: 'none' },
  pvSkinName:{ fontSize: 10, color: 'var(--t2)', textTransform: 'none', letterSpacing: 0, fontFamily: 'var(--mono)' },
  previewHead: { display: 'flex', alignItems: 'center', gap: 5, flexWrap: 'wrap', padding: '8px 12px', borderBottom: '1px solid var(--b3)', fontSize: 10, color: 'var(--t3)', textTransform: 'uppercase', letterSpacing: '0.04em' },
  previewBody: { flex: 1, overflowY: 'auto', padding: 16, minHeight: 0 },
  counter:  { marginLeft: 'auto', fontFamily: 'var(--mono)', color: 'var(--t2)', textTransform: 'none', letterSpacing: 0 },
  skinChip:  { fontSize: 11, padding: '2px 8px', borderRadius: 5, border: '1px solid var(--b3)', background: 'transparent', color: 'var(--t2)', cursor: 'pointer', textTransform: 'none', letterSpacing: 0 },
  skinChipOn:{ fontSize: 11, padding: '2px 8px', borderRadius: 5, border: '1px solid var(--acc)', background: 'color-mix(in srgb, var(--acc) 14%, transparent)', color: 'var(--acc)', cursor: 'pointer', textTransform: 'none', letterSpacing: 0 },
  row4:     { display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 10 },
  field:    { display: 'flex', flexDirection: 'column', gap: 4, minWidth: 110 },
  coverRow:  { display: 'flex', gap: 12, alignItems: 'center' },
  coverPreview: { width: 128, height: 90, objectFit: 'cover', borderRadius: 8, border: '1px solid var(--b3)', background: 'var(--b1)' },
  coverPlaceholder: { width: 128, height: 90, borderRadius: 8, border: '1px dashed var(--b3)', background: 'var(--b1)',
                      display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, color: 'var(--t3)', textAlign: 'center', padding: 6 },
  coverHint: { fontSize: 10, color: 'var(--t3)', marginTop: 4 },
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

  restoreBanner: { margin: '0 20px 10px', padding: '6px 10px', borderRadius: 5, fontSize: 11,
                   display: 'flex', alignItems: 'center', gap: 10,
                   background: 'color-mix(in srgb, var(--acc) 10%, transparent)',
                   color: 'var(--t1)', border: '1px solid color-mix(in srgb, var(--acc) 30%, transparent)' },

  forsetiGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 },
  forsetiLabel: { fontSize: 10, color: 'var(--t3)', marginBottom: 4 },

  variantExtras: { marginTop: 6, paddingTop: 6, borderTop: '1px dashed var(--b3)', display: 'flex', flexDirection: 'column', gap: 6 },
  variantImgRow: { display: 'flex', alignItems: 'center', gap: 10 },
  variantImgThumb: { width: 64, height: 44, objectFit: 'cover', borderRadius: 5, border: '1px solid var(--b3)', background: 'var(--b1)' },
  variantImgPlaceholder: { width: 64, height: 44, borderRadius: 5, border: '1px dashed var(--b3)', background: 'var(--b1)',
                           display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 8, color: 'var(--t3)', textAlign: 'center' },
  utmRow: { display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' },
  utmInput: { height: 26, borderRadius: 4, border: '1px solid var(--b3)', background: 'var(--b1)',
              color: 'var(--t1)', fontSize: 11, padding: '0 7px', width: 110, outline: 'none' },
  campaignUrlRow: { display: 'flex', alignItems: 'center', gap: 6 },
  campaignUrlText: { fontSize: 10, color: 'var(--acc)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 },
  copyBtnSm: { height: 22, width: 22, borderRadius: 4, border: '1px solid var(--b3)', background: 'transparent',
               color: 'var(--t2)', cursor: 'pointer', fontSize: 11, flexShrink: 0 },
  copyBtn: { height: 22, width: 22, borderRadius: 4, border: '1px solid var(--b3)', background: 'transparent',
             color: 'var(--t2)', cursor: 'pointer', fontSize: 12, flexShrink: 0 },

  issuesStrip: { display: 'flex', flexDirection: 'column', gap: 3, padding: '6px 12px', borderBottom: '1px solid var(--b3)' },
  issueWarn: { fontSize: 10.5, color: 'var(--dng)' },
  issueInfo: { fontSize: 10.5, color: 'var(--t3)' },

  metricsRow: { display: 'flex', gap: 6, flexWrap: 'wrap' },
  metricChip: { fontSize: 10, padding: '2px 6px', borderRadius: 3, background: 'var(--b2)', color: 'var(--t2)', fontFamily: 'var(--mono)' },
};
