// Truncated (S4-00c): плашка неполной выдачи. Читает метаданные полноты S1,
// которые бэкенд уже отдаёт (page / truncated / outside_scope). Полная выдача —
// ничего не рисует: плашка, которая висит всегда, перестаёт читаться.
import { GameIcon } from '../elements/GameIcon';
import { kitT, useKitLang } from '../i18n';
import { completeness as computeCompleteness } from './loadState';
import type { Completeness, SliceCompletenessMeta } from './loadState';
import { STATE_ICONS } from './StateViews';

export interface TruncatedProps {
  /** Тело ответа слайса (или только его метаданные). */
  meta?: SliceCompletenessMeta | null;
  /** Сколько строк показано (нужно вместе с meta). */
  shown?: number;
  /** Уже посчитанная полнота (из useLoadState) — вместо meta+shown. */
  completeness?: Completeness;
  /** Есть и выдача постраничная — кнопка «Показать ещё». */
  onMore?: () => void;
  className?: string;
}

export function Truncated({ meta, shown = 0, completeness, onMore, className }: TruncatedProps) {
  const lang = useKitLang();
  const c = completeness ?? computeCompleteness(meta, shown);
  if (c.kind === 'complete') return null;

  let text: string;
  let hint: string | undefined;
  switch (c.kind) {
    case 'paged':
      text = kitT(lang, 'kit.state.truncated.paged', {
        from: c.shown === 0 ? 0 : c.offset + 1,
        to: c.offset + c.shown,
        total: c.total,
      });
      break;
    case 'capped':
      text = kitT(lang, 'kit.state.truncated.capped', { shown: c.shown, limit: c.limit ?? c.shown });
      hint = c.hint;
      break;
    case 'unknown':
      text = kitT(lang, 'kit.state.truncated.unknown', { shown: c.shown });
      hint = c.hint;
      break;
    case 'unverified':
      text = kitT(lang, 'kit.state.truncated.unverified');
      hint = c.hint;
      break;
  }

  return (
    <div
      role="status"
      data-state="partial"
      data-completeness={c.kind}
      className={['sk-trunc', className].filter(Boolean).join(' ')}
    >
      <GameIcon slug={STATE_ICONS.truncated} size={14} className="sk-trunc__icon" />
      <span className="sk-trunc__text">{text}</span>
      {hint && <span className="sk-trunc__hint">{hint}</span>}
      {c.kind === 'paged' && onMore && (
        <button type="button" className="sk-btn" onClick={onMore}>{kitT(lang, 'kit.state.truncated.more')}</button>
      )}
    </div>
  );
}
