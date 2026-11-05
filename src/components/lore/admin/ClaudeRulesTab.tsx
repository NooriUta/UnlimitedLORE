import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router-dom';
import { fetchLoreDoc, describeLoreError, type LoreKnowDocRow, type LoreKnowDoc } from '../../../api/lore';
import { LoadError } from '../EmptyState';
import { MartProse } from '../../bench/MartProse';
import SandboxedHtmlFrame from '../SandboxedHtmlFrame';
import { S } from './adminStyles';
import { useIsNarrow } from './useIsNarrow';

// ── Правила CLAUDE — снимки CLAUDE.md машины и проектов ─────────────────────
// Read-only витрина: источник истины — файлы CLAUDE.md на машине владельца,
// в LORE они попадают как KnowDoc kind='claude-rules' (через doc_new).
// AH-05 п.2: на телефоне список документов — строка чипов над телом (C-02: колонка
// 280px съедала полэкрана), тело — без минимальной ширины и со своей прокруткой вбок.
export function ClaudeRulesTab({ rows, loadFailed }: { rows: LoreKnowDocRow[]; loadFailed?: boolean }) {
  const { t } = useTranslation();
  const narrow = useIsNarrow();
  const [params, setParams] = useSearchParams();
  const sorted = useMemo(
    () => [...rows].sort((a, b) => (a.sort_order ?? 99) - (b.sort_order ?? 99) || a.doc_id.localeCompare(b.doc_id)),
    [rows],
  );
  const sel = params.get('doc') ?? sorted[0]?.doc_id ?? null;
  const pick = (id: string) => {
    const p = new URLSearchParams(params);
    p.set('doc', id);
    setParams(p, { replace: true });
  };
  const [body, setBody] = useState<LoreKnowDoc | null>(null);
  const [loading, setLoading] = useState(false);
  // AH-07 (C-04): сбой загрузки тела показывался как «у документа нет тела», а
  // body не сбрасывался — на новом документе оставалось тело предыдущего.
  const [bodyErr, setBodyErr] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    if (!sel) return;
    const ctl = new AbortController();
    setLoading(true); setBody(null); setBodyErr(null);
    fetchLoreDoc(sel, ctl.signal)
      .then(d => { setBody(d); setLoading(false); })
      .catch(e => {
        const d = describeLoreError(e);
        if (d.kind === 'aborted') return; // отмена при смене документа — не сбой
        setBodyErr(d.text); setLoading(false);
      });
    return () => ctl.abort();
  }, [sel, retry]);
  if (!rows.length) {
    // C-05: при сбое слайса оболочка уже показала LoadError — «документов нет» тут было бы неправдой.
    if (loadFailed) return null;
    return <div style={S.state('neutral')}>{t('lore.admin.claudeRulesEmpty', 'Правила не загружены: нет документов с kind claude-rules. Заводятся через MCP doc_new.')}</div>;
  }
  const md = body ? (body.content_md_ru ?? body.content_md_en) : null;
  return (
    <div>
      <div style={S.note}>{t('lore.admin.claudeRulesNote', 'Снимки файлов CLAUDE.md: один глобальный (вся машина) и по одному на репозиторий. Источник истины — файлы на машине владельца; здесь read-only витрина, обновляется через MCP doc_new.')}</div>
      <div style={{ display: 'flex', gap: narrow ? 8 : 16, alignItems: 'flex-start', flexDirection: narrow ? 'column' : 'row' }}>
        <div role="tablist" aria-label={t('lore.admin.navTabClaudeRules', 'Правила CLAUDE')}
          style={narrow
            ? { display: 'flex', flexWrap: 'wrap', gap: 5, width: '100%' }
            : { flexBasis: 280, flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
          {sorted.map(r => narrow ? (
            <button key={r.doc_id} role="tab" aria-selected={sel === r.doc_id} style={{ ...S.chip(sel === r.doc_id), minHeight: 36, maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} onClick={() => pick(r.doc_id)}>
              {r.title ?? r.doc_id}
            </button>
          ) : (
            <button key={r.doc_id} role="tab" aria-selected={sel === r.doc_id} style={S.nav(sel === r.doc_id)} onClick={() => pick(r.doc_id)} aria-current={sel === r.doc_id}>
              <span style={S.rail(sel === r.doc_id ? 'var(--acc)' : null)} />
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.title ?? r.doc_id}</span>
            </button>
          ))}
        </div>
        <div style={{ flex: 1, minWidth: 0, width: narrow ? '100%' : undefined, overflowX: 'auto' }}>
          {loading && <div style={S.state('neutral')}>{t('lore.admin.claudeRulesLoading', 'Читаем документ…')}</div>}
          {!loading && body && md && <MartProse text={md} />}
          {!loading && body && !md && body.content_html && <SandboxedHtmlFrame html={body.content_html} title={body.title ?? body.doc_id} />}
          {!loading && bodyErr && (
            <LoadError text={t('lore.admin.claudeRulesLoadError', 'Документ не загрузился: {{reason}}', { reason: bodyErr })}
              onRetry={() => setRetry(r => r + 1)} retryLabel={t('lore.admin.retry', 'повторить')} />
          )}
          {!loading && !bodyErr && (!body || (!md && !body.content_html)) && (
            <div style={S.state('neutral')}>{t('lore.admin.claudeRulesNoBody', 'У документа нет тела — проверьте content_md_ru/content_md_en.')}</div>
          )}
        </div>
      </div>
    </div>
  );
}
