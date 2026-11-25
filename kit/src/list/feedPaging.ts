// Лента паспортов: режим и окно показа (SPRINT_LORE_BOARD_PASSPORTS/BP-01-FULL-PASSPORT-FEED).
//
// Прототип docs/prototypes/bp-01-passport-feed.html принят владельцем
// 25.11.2026 как есть. Отсюда числа и правила:
//   • два режима — «Контекст» (прежняя облегчённая лента) и «Полные паспорта»;
//   • догрузка ЛЕНИВАЯ, по 4 записи при подходе к концу;
//   • автоматом — до 12 полных паспортов (тяжёлые записи: тело целиком, связи)
//     и до 40 карточек контекста; дальше — кнопкой «Показать ещё» с подписью
//     «показано N из M»;
//   • режим и число показанных — в адресе (lfm, lfn), перезагрузка и ссылка
//     возвращают туда же.
//
// Правила — чистыми функциями: это утверждения о том, сколько показать и что
// предложить, а не вёрстка (тот же приём, что у foldBody / foldUnder).

export type FeedMode = 'context' | 'full';

/** Порция догрузки. */
export const FEED_PAGE = 4;
/** Предел автодогрузки полных паспортов. */
export const FEED_AUTO_FULL = 12;
/** Предел автодогрузки карточек контекста. */
export const FEED_AUTO_CONTEXT = 40;

/** Ключи адреса: режим ленты (только `full`, контекст — умолчание) и число показанных. */
export const FEED_MODE_PARAM = 'lfm';
export const FEED_SHOWN_PARAM = 'lfn';

export function feedAutoLimit(mode: FeedMode): number {
  return mode === 'full' ? FEED_AUTO_FULL : FEED_AUTO_CONTEXT;
}

/**
 * Сколько записей показать.
 *
 * `requested` — число из адреса (null — не названо, тогда первая порция).
 * Мусор и ноль — тоже первая порция: пустая лента по битой ссылке читалась бы
 * как «записей нет».
 *
 * `canObserve` — видит ли экран прокрутку (IntersectionObserver). Не видит —
 * автодогрузке нечем сработать, и лента сразу показывает предел автодогрузки:
 * иначе человек застрял бы на четырёх записях без кнопки.
 */
export function feedShownOf(requested: number | null, total: number, mode: FeedMode, canObserve: boolean): number {
  const asked = requested !== null && Number.isFinite(requested) && requested >= 1 ? Math.floor(requested) : FEED_PAGE;
  const base = canObserve ? asked : Math.max(asked, feedAutoLimit(mode));
  return Math.max(0, Math.min(total, base));
}

/** Что под лентой: всё показано · догрузится само · кнопка на `n` записей. */
export type FeedTail = { kind: 'all' } | { kind: 'auto' } | { kind: 'more'; n: number };

export function feedTail(shown: number, total: number, mode: FeedMode): FeedTail {
  if (shown >= total) return { kind: 'all' };
  if (shown < feedAutoLimit(mode)) return { kind: 'auto' };
  return { kind: 'more', n: Math.min(FEED_PAGE, total - shown) };
}

/** Следующая порция — кнопкой или автодогрузкой. */
export function feedMoreShown(shown: number, total: number): number {
  return Math.min(total, shown + FEED_PAGE);
}

/** Число показанных при смене режима: в «Полные паспорта» — не больше предела, тяжёлое разом не грузим. */
export function feedModeSwitchShown(to: FeedMode, shown: number): number {
  return to === 'full' ? Math.min(shown, FEED_AUTO_FULL) : shown;
}

export function readFeedMode(p: URLSearchParams): FeedMode {
  return p.get(FEED_MODE_PARAM) === 'full' ? 'full' : 'context';
}

export function readFeedShown(p: URLSearchParams): number | null {
  const raw = p.get(FEED_SHOWN_PARAM);
  if (raw === null || !/^\d+$/.test(raw)) return null;
  const n = Number(raw);
  return n >= 1 ? n : null;
}
