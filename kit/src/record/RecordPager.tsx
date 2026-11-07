// «‹ x из y ›» (SPRINT_UXR_S5_RECORD_TASKS/S5-04): листание записей того
// списка, из которого запись открыли (задачи спринта по порядку). Без
// закольцовки: на краю кнопка выключена, а не спрятана — раскладка не прыгает.
// Записи нет в списке — честное «нет в списке из N», а не «1 из N».
// Клавиши [ и ] — по физической клавише (useHotkeys, русская раскладка), у
// каждой клавиши есть кнопка (D-2026-UXR-KEYBOARD-LAYER).
import { useKitLang, kitT } from '../i18n';
import { useHotkeys } from '../resilience/useHotkeys';

export interface PagerPos {
  /** Индекс в списке; −1 — записи в списке нет. */
  index: number;
  /** Позиция с единицы; 0 — записи в списке нет. */
  pos: number;
  total: number;
  prev: string | null;
  next: string | null;
}

export function pagerOf(ids: readonly string[], current: string): PagerPos {
  const index = ids.indexOf(current);
  if (index < 0) return { index: -1, pos: 0, total: ids.length, prev: null, next: null };
  return {
    index,
    pos: index + 1,
    total: ids.length,
    prev: index > 0 ? ids[index - 1] : null,
    next: index < ids.length - 1 ? ids[index + 1] : null,
  };
}

export interface RecordPagerProps {
  /** id записей списка — в том порядке, в каком их видит пользователь. */
  ids: readonly string[];
  current: string;
  onGo: (id: string) => void;
  /** Клавиши [ и ] на всё окно — включать только у главного экрана записи. */
  hotkeys?: boolean;
  className?: string;
}

export function RecordPager({ ids, current, onGo, hotkeys, className }: RecordPagerProps) {
  const lang = useKitLang();
  const p = pagerOf(ids, current);
  useHotkeys({
    '[': () => { if (p.prev) onGo(p.prev); },
    ']': () => { if (p.next) onGo(p.next); },
  }, { enabled: hotkeys === true });
  const prevLabel = p.prev ? kitT(lang, 'kit.record.pager.prev', { id: p.prev }) : kitT(lang, 'kit.record.pager.noPrev');
  const nextLabel = p.next ? kitT(lang, 'kit.record.pager.next', { id: p.next }) : kitT(lang, 'kit.record.pager.noNext');
  return (
    <nav className={['sk-rec-pager', className].filter(Boolean).join(' ')} aria-label={kitT(lang, 'kit.record.pager.label')}
      data-testid="kit-rec-pager">
      <button type="button" className="sk-iconbtn sk-rec-pager__btn" aria-label={prevLabel} title={prevLabel}
        aria-keyshortcuts={hotkeys ? '[' : undefined} disabled={!p.prev} onClick={() => { if (p.prev) onGo(p.prev); }}>
        <span aria-hidden="true">‹</span>
      </button>
      <span className="sk-rec-pager__pos" aria-live="polite" data-missing={p.index < 0 ? 'true' : undefined}>
        {p.index < 0
          ? kitT(lang, 'kit.record.pager.missing', { total: p.total })
          : kitT(lang, 'kit.record.pager.pos', { pos: p.pos, total: p.total })}
      </span>
      <button type="button" className="sk-iconbtn sk-rec-pager__btn" aria-label={nextLabel} title={nextLabel}
        aria-keyshortcuts={hotkeys ? ']' : undefined} disabled={!p.next} onClick={() => { if (p.next) onGo(p.next); }}>
        <span aria-hidden="true">›</span>
      </button>
    </nav>
  );
}
