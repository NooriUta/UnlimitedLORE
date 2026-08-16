// Новостная лента Forseti — «что изменилось» (ML-NEWS-ENDPOINT).
// Первый живой потребитель GET /lore/news: один сведённый ответ вместо разъезда
// по шести срезам. Read-only проекция; клик по записи ведёт в её раздел, где это
// возможно (release/sprint/adr/decision), остальные — просто показываются.
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { fetchLoreNews, type LoreNewsItem } from '../../api/lore';
import LoreSkeleton from './LoreSkeleton';
import { EmptyState } from './EmptyState';

// Значок + подпись + цвет-акцент по виду записи. Порядок значков совпадает с
// собственным каноном LORE (release/sprint/decision/adr), + spec/tasks.
const KIND: Record<LoreNewsItem['kind'], { glyph: string; labelKey: string; label: string; color: string }> = {
  release:  { glyph: '🚀', labelKey: 'lore.news.kind.release',  label: 'релиз',        color: 'var(--g-do)' },
  sprint:   { glyph: '🏁', labelKey: 'lore.news.kind.sprint',   label: 'спринт закрыт', color: 'var(--g-do)' },
  decision: { glyph: '⚖️', labelKey: 'lore.news.kind.decision', label: 'решение',      color: 'var(--g-know)' },
  adr:      { glyph: '📐', labelKey: 'lore.news.kind.adr',      label: 'ADR',          color: 'var(--g-know)' },
  spec:     { glyph: '📄', labelKey: 'lore.news.kind.spec',     label: 'спека',        color: 'var(--g-tech)' },
  tasks:    { glyph: '✅', labelKey: 'lore.news.kind.tasks',    label: 'задачи',       color: 'var(--g-ctrl)' },
};

const S = {
  wrap:      { maxWidth: 820, margin: '0 auto', padding: '4px 2px 40px' } as const,
  dayHdr:    { position: 'sticky' as const, top: 0, background: 'var(--bg0)', zIndex: 1,
               fontSize: 11, fontWeight: 700, color: 'var(--t3)', fontFamily: 'var(--mono)',
               padding: '10px 4px 6px', borderBottom: '1px solid var(--bd)', marginBottom: 4 },
  row:       { display: 'flex', alignItems: 'baseline', gap: 10, padding: '7px 6px',
               borderBottom: '1px solid var(--bg2)' } as const,
  glyph:     { fontSize: 14, width: 20, textAlign: 'center' as const, flexShrink: 0 },
  body:      { flex: 1, minWidth: 0 } as const,
  title:     { fontSize: 13, color: 'var(--t1)', lineHeight: 1.35 } as const,
  meta:      { fontSize: 11, color: 'var(--t3)', marginTop: 1, display: 'flex', gap: 8, flexWrap: 'wrap' as const, alignItems: 'baseline' },
  kindTag:   (c: string) => ({ fontSize: 9.5, fontFamily: 'var(--mono)', fontWeight: 700,
               color: c, textTransform: 'uppercase' as const, letterSpacing: 0.3 }),
  proj:      { fontSize: 9.5, fontFamily: 'var(--mono)', color: 'var(--t2)',
               background: 'var(--bg2)', borderRadius: 4, padding: '0 5px' } as const,
  future:    { fontSize: 9.5, fontFamily: 'var(--mono)', color: 'var(--wrn)',
               border: '1px solid var(--wrn)', borderRadius: 4, padding: '0 4px' } as const,
  clickable: { cursor: 'pointer' } as const,
};

// Виды, у которых есть куда вести. tasks/spec — нет (task_id неуникален,
// spec-паспорт живёт под компонентом) → просто показываем.
const NAVIGABLE = new Set<LoreNewsItem['kind']>(['release', 'sprint', 'decision', 'adr']);

interface Props {
  onError: (e: unknown) => void;
  /** Открыть запись в её разделе (release/sprint/decision/adr). */
  onOpen?: (item: LoreNewsItem) => void;
}

export default function LoreNewsFeed({ onError, onOpen }: Props) {
  const { t } = useTranslation();
  const [items, setItems] = useState<LoreNewsItem[] | null>(null);

  useEffect(() => {
    const ctrl = new AbortController();
    fetchLoreNews(80, ctrl.signal)
      .then(setItems)
      .catch(e => { if (!ctrl.signal.aborted) { onError(e); setItems([]); } });
    return () => ctrl.abort();
  }, [onError]);

  if (items === null) return <div style={S.wrap}><LoreSkeleton rows={8} /></div>;
  if (items.length === 0)
    return <div style={S.wrap}><EmptyState message={t('lore.news.empty', 'Пока ничего не произошло')} /></div>;

  // Раскладка по дням: список уже отсортирован сервером (новые сверху), поэтому
  // достаточно ставить заголовок при смене даты, порядок не трогаем.
  const out: React.ReactNode[] = [];
  let lastDay = '';
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    if (it.date !== lastDay) {
      lastDay = it.date;
      out.push(<div key={`d-${it.date}`} style={S.dayHdr}>{it.date}</div>);
    }
    const k = KIND[it.kind];
    const canOpen = !!onOpen && NAVIGABLE.has(it.kind);
    out.push(
      <div
        key={`i-${i}`}
        style={{ ...S.row, ...(canOpen ? S.clickable : {}) }}
        onClick={canOpen ? () => onOpen!(it) : undefined}
        role={canOpen ? 'button' : undefined}
        tabIndex={canOpen ? 0 : undefined}
      >
        <span style={S.glyph} title={t(k.labelKey, k.label)}>{k.glyph}</span>
        <div style={S.body}>
          <div style={S.title}>{it.title}</div>
          <div style={S.meta}>
            <span style={S.kindTag(k.color)}>{t(k.labelKey, k.label)}</span>
            {it.detail && <span>{it.detail}</span>}
            {it.project && <span style={S.proj}>{it.project.split('/').pop()}</span>}
            {it.future && <span style={S.future} title={t('lore.news.futureHint', 'дата позже сегодня — вероятно опечатка в LORE')}>{t('lore.news.future', 'будущее')}</span>}
          </div>
        </div>
      </div>,
    );
  }

  return <div style={S.wrap}>{out}</div>;
}
