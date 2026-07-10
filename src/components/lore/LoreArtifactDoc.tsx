import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { fetchLoreSlice, updateLoreDoc } from '../../api/lore';
import { MartProse } from '../bench/MartProse';
import SandboxedHtmlFrame from './SandboxedHtmlFrame';
import TipTapField from './TipTapField';
import { GameIcon } from './GameIcon';
import { ARTIFACT_KINDS_META } from './LoreArtifactList';

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
  content_md_en?: string | null; content_md_ru?: string | null;
  component_id?: string | null; sprint_id?: string | null;
}

interface QgMetricRow { metric_id: string; name: string; threshold: string; }

const SLICE: Record<DocKind, { slice: string; labelKey: string; labelFallback: string }> = {
  runbook: { slice: 'runbook_by_id',      labelKey: 'lore.artifactDoc.kind.runbook', labelFallback: 'Runbook' },
  doc:     { slice: 'doc_by_id',          labelKey: 'lore.artifactDoc.kind.doc',     labelFallback: 'Документ' },
  qg:      { slice: 'quality_gate_by_id', labelKey: 'lore.artifactDoc.kind.qg',      labelFallback: 'Quality Gate' },
};

const S = {
  root: { flex: 1, overflowY: 'auto' as const, padding: '12px 20px' },
  back: { background: 'none', border: 'none', cursor: 'pointer', color: 'var(--acc)', fontSize: 'var(--fs-base)', padding: '0 0 12px', display: 'block' },
  header: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6, flexWrap: 'wrap' as const },
  kindTag: (color: string) => ({
    display: 'inline-flex', alignItems: 'center', gap: 4,
    fontSize: 'var(--fs-xs)', padding: '2px 7px', borderRadius: 3,
    background: `color-mix(in srgb, ${color} 16%, transparent)`, color,
    textTransform: 'uppercase' as const, letterSpacing: 0.3, fontWeight: 600,
  }),
  statusChip: { fontSize: 'var(--fs-xs)', padding: '2px 7px', borderRadius: 3, background: 'color-mix(in srgb, var(--suc) 16%, transparent)', color: 'var(--suc)' },
  title: { fontSize: 'var(--fs-lg)', fontWeight: 600, color: 'var(--t1)' },
  comp: { padding: '2px 7px', borderRadius: 3, fontSize: 'var(--fs-sm)', background: 'color-mix(in srgb, var(--acc) 12%, transparent)', color: 'var(--acc)', whiteSpace: 'nowrap' as const },
  meta: { fontSize: 'var(--fs-sm)', color: 'var(--t3)', marginBottom: 12 },
  cdnBanner: {
    marginBottom: 12, padding: '6px 10px', borderRadius: 3, fontSize: 'var(--fs-xs)', lineHeight: 1.5,
    background: 'color-mix(in srgb, var(--danger) 8%, transparent)',
    border: '1px solid color-mix(in srgb, var(--danger) 30%, transparent)', color: 'var(--danger)',
  },
  desc: { fontSize: 'var(--fs-base)', color: 'var(--t2)', borderLeft: '2px solid var(--b3)', padding: '2px 0 2px 10px', marginBottom: 14 },
  table: { width: '100%', borderCollapse: 'collapse' as const, fontSize: 'var(--fs-sm)', marginTop: 14 },
  th: { textAlign: 'left' as const, padding: '4px 8px', color: 'var(--t3)', fontWeight: 600, borderBottom: '1px solid var(--bd)' },
  td: { padding: '4px 8px', color: 'var(--t2)', verticalAlign: 'top' as const },
  tdCode: { padding: '4px 8px', color: 'var(--acc)', fontFamily: 'var(--mono)', whiteSpace: 'nowrap' as const },
  tdThresh: { padding: '4px 8px', color: 'var(--t1)', whiteSpace: 'pre-wrap' as const, maxWidth: 240 },
  idFoot: { marginTop: 18, paddingTop: 10, borderTop: '1px solid var(--bd)', fontFamily: 'var(--mono)', fontSize: 'var(--fs-xs)', color: 'var(--t3)' },
  empty: { padding: 24, color: 'var(--t3)', fontSize: 'var(--fs-base)' },
  sprintLink: { fontSize: 'var(--fs-sm)', color: 'var(--t3)', marginBottom: 10 },
  sprintAnchor: { color: 'var(--acc)', cursor: 'pointer', textDecoration: 'underline' },
  langToggle: { display: 'flex', gap: 4, marginBottom: 10 },
  langBtn: (on: boolean) => ({
    fontSize: 'var(--fs-xs)', fontWeight: 600, padding: '2px 9px', borderRadius: 12, cursor: 'pointer',
    border: `1px solid ${on ? 'var(--acc)' : 'var(--b3)'}`,
    background: on ? 'color-mix(in srgb, var(--acc) 18%, transparent)' : 'transparent',
    color: on ? 'var(--t1)' : 'var(--t3)',
  }),
  editBtn: {
    marginLeft: 'auto', fontSize: 'var(--fs-sm)', padding: '3px 10px', borderRadius: 3, cursor: 'pointer',
    border: '1px solid var(--b3)', background: 'var(--b2)', color: 'var(--t2)',
  },
  editField: { marginBottom: 10 },
  editLabel: { fontSize: 'var(--fs-xs)', color: 'var(--t3)', textTransform: 'uppercase' as const, letterSpacing: 0.4, marginBottom: 4 },
  editActions: { display: 'flex', gap: 8, marginTop: 10 },
  saveBtn: {
    fontSize: 'var(--fs-sm)', fontWeight: 600, padding: '4px 12px', borderRadius: 3, cursor: 'pointer',
    border: '1px solid var(--acc)', background: 'color-mix(in srgb, var(--acc) 18%, transparent)', color: 'var(--acc)',
  },
  cancelBtn: {
    fontSize: 'var(--fs-sm)', padding: '4px 12px', borderRadius: 3, cursor: 'pointer',
    border: '1px solid var(--b3)', background: 'transparent', color: 'var(--t3)',
  },
};

interface Props {
  kind: DocKind;
  id: string;
  onError: (e: unknown) => void;
  onBack: () => void;
  onNavigateSprint?: (id: string) => void;
}

export default function LoreArtifactDoc({ kind, id, onError, onBack, onNavigateSprint }: Props) {
  const { t, i18n } = useTranslation();
  const [row, setRow]         = useState<RawRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [metrics, setMetrics] = useState<QgMetricRow[] | null>(null);
  const [lang, setLang]       = useState<'en' | 'ru'>(i18n.language?.startsWith('ru') ? 'ru' : 'en');
  const [editLang, setEditLang] = useState<'en' | 'ru'>('en');
  const [editing, setEditing] = useState(false);
  const [draftEn, setDraftEn] = useState('');
  const [draftRu, setDraftRu] = useState('');
  const [saving, setSaving]   = useState(false);

  useEffect(() => {
    setLoading(true); setRow(null); setMetrics(null); setEditing(false);
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

  if (loading) return <div style={S.empty}>{t('lore.artifactDoc.loading', 'Загрузка {{id}}…', { id })}</div>;
  if (!row)    return <div style={S.empty}>{t('lore.artifactDoc.notFound', 'Не найдено: {{id}}', { id })}</div>;

  const startEdit = () => {
    setDraftEn(row.content_md_en ?? '');
    setDraftRu(row.content_md_ru ?? '');
    setEditLang(lang);
    setEditing(true);
  };

  const saveEdit = async () => {
    setSaving(true);
    try {
      // `row` still holds the pre-edit values here (only updated after a
      // successful save below), so it doubles as "was this field ever set".
      // Send a field when either it now has content, or it HAD content and
      // the user cleared it (an intentional clear) — only skip it when both
      // the draft and the original were empty (never touched, don't turn a
      // never-set null into ''). The backend's partial-upsert only skips a
      // JSON-absent field, so sending both unconditionally regardless of
      // prior state would overwrite an untouched null field with ''.
      const sendEn = draftEn !== '' || !!row.content_md_en;
      const sendRu = draftRu !== '' || !!row.content_md_ru;
      await updateLoreDoc(id, {
        ...(sendEn ? { content_md_en: draftEn } : {}),
        ...(sendRu ? { content_md_ru: draftRu } : {}),
      });
      // Mirror the send condition exactly — a field the backend was told to
      // skip (never touched) must stay whatever it already was locally too,
      // not silently become '' just because the draft box started empty.
      setRow(r => (r ? {
        ...r,
        content_md_en: sendEn ? draftEn : r.content_md_en,
        content_md_ru: sendRu ? draftRu : r.content_md_ru,
      } : r));
      setEditing(false);
    } catch (e) {
      onError(e);
    } finally {
      setSaving(false);
    }
  };

  const title = row.name || row.title || id;
  const date  = row.date_created || row.valid_from;
  const kindMeta = ARTIFACT_KINDS_META.find(k => k.kind === kind);
  const chars = (row.content_md_ru || row.content_md_en || row.content_md || row.content_html || '').length;
  const metaBits: string[] = [];
  if (row.area) metaBits.push(row.area);
  if (row.kind) metaBits.push(row.kind);
  if (chars)    metaBits.push(t('lore.artifactDoc.chars', '{{n}} зн.', { n: chars.toLocaleString('ru-RU') }));
  if (date)     metaBits.push(date.slice(0, 10));

  return (
    <div style={S.root}>
      <button style={S.back} onClick={onBack}>{t('lore.artifactDoc.backToList', '← К списку')}</button>
      <div style={S.header}>
        <span style={S.kindTag(kindMeta?.color ?? 'var(--t3)')}>
          {kindMeta && <GameIcon slug={kindMeta.icon} size={11} />}
          {t(SLICE[kind].labelKey, SLICE[kind].labelFallback)}
        </span>
        {row.status && <span style={S.statusChip}>{row.status}</span>}
        <span style={S.title}>{title}</span>
        {row.component_id && <span style={S.comp}>{row.component_id}</span>}
        {kind === 'doc' && !editing && (
          <button style={S.editBtn} onClick={startEdit}>{t('lore.artifactDoc.edit', '✎ Редактировать')}</button>
        )}
      </div>
      {metaBits.length > 0 && <div style={S.meta}>{metaBits.join(' · ')}</div>}

      {/* T08: QG ↔ Sprint cross-link */}
      {kind === 'qg' && row.sprint_id && (
        <div style={S.sprintLink}>
          {t('lore.artifactDoc.sprintLabel', 'Спринт:')}{' '}
          {onNavigateSprint ? (
            <span style={S.sprintAnchor} onClick={() => onNavigateSprint(row.sprint_id!)}>
              {row.sprint_id}
            </span>
          ) : (
            <span style={{ color: 'var(--acc)' }}>{row.sprint_id}</span>
          )}
        </div>
      )}

      {row.has_ext_deps && (
        <div style={S.cdnBanner}>
          {t(
            'lore.artifactDoc.cdnWarning',
            '⚠ Документ ссылается на внешние ресурсы (CDN). В air-gap среде они недоступны — CSP блокирует внешние загрузки, внешние стили/скрипты не применятся.'
          )}
        </div>
      )}

      {row.description && <div style={S.desc}>{row.description}</div>}

      {kind === 'doc' && editing ? (
        <>
          {row.content_html && !row.content_md_en && !row.content_md_ru && (
            <div style={S.cdnBanner}>
              {t(
                'lore.artifactDoc.htmlLegacyWarning',
                '⚠ Этот документ сейчас хранится как HTML. Если вы сохраните текст здесь (даже в одном из полей), отображение переключится на Markdown и текущий HTML-контент перестанет показываться (он не удаляется, просто больше не используется).'
              )}
            </div>
          )}
          <div style={S.langToggle}>
            <button style={S.langBtn(editLang === 'en')} onClick={() => setEditLang('en')}>
              EN{draftEn ? '' : ' (пусто)'}
            </button>
            <button style={S.langBtn(editLang === 'ru')} onClick={() => setEditLang('ru')}>
              RU{draftRu ? '' : ' (пусто)'}
            </button>
          </div>
          {/* Both editors stay mounted (each keeps its own TipTap instance/undo
              history) — only visibility toggles, so switching tabs never
              re-parses draft state through the markdown round-trip. */}
          <div style={{ ...S.editField, display: editLang === 'en' ? 'block' : 'none' }}>
            <TipTapField value={draftEn} onChange={setDraftEn} placeholder="English Markdown…" enableImages={false} enableHtmlMode={false} />
          </div>
          <div style={{ ...S.editField, display: editLang === 'ru' ? 'block' : 'none' }}>
            <TipTapField value={draftRu} onChange={setDraftRu} placeholder="Русский Markdown…" enableImages={false} enableHtmlMode={false} />
          </div>
          <div style={S.editActions}>
            <button style={S.saveBtn} disabled={saving} onClick={saveEdit}>
              {saving ? t('lore.artifactDoc.saving', 'Сохранение…') : t('lore.artifactDoc.save', 'Сохранить')}
            </button>
            <button style={S.cancelBtn} disabled={saving} onClick={() => setEditing(false)}>
              {t('lore.artifactDoc.cancel', 'Отмена')}
            </button>
          </div>
        </>
      ) : (() => {
        const hasEn = !!row.content_md_en;
        const hasRu = !!row.content_md_ru;
        if (hasEn || hasRu) {
          const preferred = lang === 'ru' ? row.content_md_ru : row.content_md_en;
          const shown = preferred ?? row.content_md_en ?? row.content_md_ru;
          return (
            <>
              {hasEn && hasRu && (
                <div style={S.langToggle}>
                  <button style={S.langBtn(lang === 'en')} onClick={() => setLang('en')}>EN</button>
                  <button style={S.langBtn(lang === 'ru')} onClick={() => setLang('ru')}>RU</button>
                </div>
              )}
              <MartProse text={shown ?? ''} />
            </>
          );
        }
        if (row.content_html) return <SandboxedHtmlFrame html={row.content_html} title={title} />;
        if (row.content_md)   return <MartProse text={row.content_md} />;
        return <div style={S.empty}>{t('lore.artifactDoc.emptyContent', 'Контент пуст.')}</div>;
      })()}

      {kind === 'qg' && metrics && metrics.length > 0 && (
        <table style={S.table}>
          <thead>
            <tr>
              <th style={S.th}>{t('lore.artifactDoc.table.metric', 'Метрика')}</th>
              <th style={S.th}>{t('lore.artifactDoc.table.description', 'Описание')}</th>
              <th style={S.th}>{t('lore.artifactDoc.table.threshold', 'Порог')}</th>
            </tr>
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
