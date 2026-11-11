// Список выбора записи — ОДИН на весь kit (SPRINT_UXR_S10_SEIDR_KIT_2/MD-WINDOW, договорённость с
// kit-сессией 11.11.2026): им пользуются мини-окно ссылки в MD (RefPicker) и ref-редактор поля
// (kit/src/fields, SPRINT_UXR_S4_UI_SHELL_LISTS/S4-FIELD-EDITORS). Два разных выбора записи
// разошлись бы в состояниях и клавишах.
//
// Фокус у вызывающего (редактор или поле ввода), поэтому стрелки, Enter и Tab приходят через
// handleKey. Состояния словами: не спрашивали (idle) ≠ ищу ≠ не нашлось ≠ не смогли загрузить.
// Kit не знает предметных имён: подписи типов и поиск даёт приложение.
import { forwardRef, useImperativeHandle, useState } from 'react';
import { kitT, type KitKey } from '../i18n';
import { useKitLang } from '../i18n/lang';

export interface RefItem { id: string; type: string; title: string }

export type RefSearch =
  /** запрос ещё не набран — не спрашивали (это не «не нашлось») */
  | { state: 'idle' }
  | { state: 'loading' }
  | { state: 'ok'; items: RefItem[] }
  | { state: 'error'; reason: string };

export interface RefSearchListProps {
  search: RefSearch;
  /** набранный запрос — для честного «не нашлось по «…»» */
  query: string;
  /** тип → подпись */
  typeLabels: Record<string, string>;
  onPick: (item: RefItem) => void;
  onRetry?: () => void;
  /** «Завести новый» при пустой выдаче; нет — кнопки нет */
  onCreateNew?: () => void;
}

export interface RefSearchListHandle {
  /** клавиша от вызывающего; true — список её использовал */
  handleKey: (key: string) => boolean;
}

export const RefSearchList = forwardRef<RefSearchListHandle, RefSearchListProps>(function RefSearchList(
  { search, query, typeLabels, onPick, onRetry, onCreateNew }, ref,
) {
  const lang = useKitLang();
  const t = (k: KitKey, v?: Record<string, string | number>) => kitT(lang, k, v);
  const [index, setIndex] = useState(0);
  const items = search.state === 'ok' ? search.items : [];
  const at = Math.min(index, Math.max(items.length - 1, 0));

  useImperativeHandle(ref, () => ({
    handleKey(key) {
      if (!items.length) return false;
      if (key === 'ArrowDown') { setIndex((at + 1) % items.length); return true; }
      if (key === 'ArrowUp') { setIndex((at - 1 + items.length) % items.length); return true; }
      if (key === 'Enter' || key === 'Tab') { onPick(items[at]); return true; }
      return false;
    },
  }), [at, items, onPick]);

  if (search.state === 'idle') return <p className="sk-ref__state">{t('kit.ref.idle')}</p>;
  if (search.state === 'loading') return <p className="sk-ref__state">{t('kit.ref.loading')}</p>;
  if (search.state === 'error') {
    return (
      <p className="sk-ref__state sk-ref__state--err">
        {t('kit.ref.error', { reason: search.reason })}{' '}
        {onRetry && <button type="button" className="sk-ref__btn" onClick={onRetry}>{t('kit.ref.retry')}</button>}
      </p>
    );
  }
  if (items.length === 0) {
    return (
      <p className="sk-ref__state">
        {t('kit.ref.notFound', { q: query })}{' '}
        {onCreateNew && <button type="button" className="sk-ref__btn" onClick={onCreateNew}>{t('kit.ref.toNew')}</button>}
      </p>
    );
  }
  return (
    <ul className="sk-ref__list">
      {items.map((it, i) => (
        <li key={`${it.type}:${it.id}`}>
          {/* mousedown гасим: фокус остаётся у редактора/поля, щелчок выбирает */}
          <button type="button" className={`sk-ref__item${i === at ? ' is-on' : ''}`} onMouseDown={e => e.preventDefault()} onClick={() => onPick(it)}>
            <span className="sk-ref__ty">{typeLabels[it.type] ?? it.type}</span>
            <span className="sk-ref__id">{it.id}</span>
            <span className="sk-ref__title">{it.title}</span>
          </button>
        </li>
      ))}
    </ul>
  );
});
