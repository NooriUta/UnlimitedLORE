// SPRINT_UXR_S1_HONEST_API/S1-04 (B-03): срок у запросов к LORE.
//
// Было: fetch без срока. Повисший бэкенд или прокси, который держит соединение,
// давал бесконечный спиннер — экран не отличал «ещё грузится» от «не ответят
// никогда». Правило: у КАЖДОГО запроса к LORE есть срок; не дождались — это
// отдельный честный исход («не дождались ответа за N с»), который виден на
// месте, а не «пусто», не «отменено» и не «LORE недоступен» на всю страницу
// (сервер мог и ответить — просто медленно).
//
// Отмена вызывающим (уход с экрана, смена фильтра) остаётся AbortError и
// по-прежнему ошибкой не считается: срок и отмена — разные причины.

/** Срок ответа LORE по умолчанию. Тяжёлые слайсы укладываются в единицы секунд. */
export const LORE_TIMEOUT_MS = 30_000;

/** Не дождались ответа LORE за `ms` миллисекунд. */
export class LoreTimeoutError extends Error {
  constructor(readonly ms: number) {
    super(`не дождались ответа LORE за ${Math.max(1, Math.round(ms / 1000))} с`);
    this.name = 'LoreTimeoutError';
  }
}

function errName(err: unknown): string | undefined {
  return typeof err === 'object' && err !== null && 'name' in err
    ? String((err as { name: unknown }).name)
    : undefined;
}

/**
 * Таймаут ли это. Узнаёт и {@link LoreTimeoutError}, и голый DOMException
 * `TimeoutError` — его бросает уже `res.json()`, если срок истёк при чтении тела.
 */
export function isLoreTimeout(err: unknown): boolean {
  return err instanceof LoreTimeoutError || errName(err) === 'TimeoutError';
}

/** Сигнал «срок ИЛИ отмена вызывающего»; причина — того, кто сработал первым. */
export function loreSignal(signal?: AbortSignal, ms: number = LORE_TIMEOUT_MS): AbortSignal {
  const timeout = AbortSignal.timeout(ms);
  if (!signal) return timeout;
  if (typeof AbortSignal.any === 'function') return AbortSignal.any([signal, timeout]);
  // Старые браузеры без AbortSignal.any (Safari < 17.4): склеиваем руками.
  const ctrl = new AbortController();
  const relay = (s: AbortSignal) => () => ctrl.abort(s.reason);
  if (signal.aborted) ctrl.abort(signal.reason);
  else {
    signal.addEventListener('abort', relay(signal), { once: true });
    timeout.addEventListener('abort', relay(timeout), { once: true });
  }
  return ctrl.signal;
}

/**
 * fetch со сроком. Истёк срок — {@link LoreTimeoutError}; отмена вызывающим —
 * его AbortError как есть; прочие ошибки (сеть) — без подмены.
 */
export async function loreFetch(
  input: string,
  init: RequestInit = {},
  ms: number = LORE_TIMEOUT_MS,
): Promise<Response> {
  const caller = init.signal ?? undefined;
  try {
    return await fetch(input, { ...init, signal: loreSignal(caller, ms) });
  } catch (err) {
    if (!caller?.aborted && isLoreTimeout(err)) throw new LoreTimeoutError(ms);
    throw err;
  }
}

/**
 * Ветка для `describeLoreError` (src/api/lore.ts): таймаут → вид `timeout`,
 * показывается на месте (pageLevel=false). Не таймаут → null.
 */
export function describeLoreTimeout(err: unknown): { kind: 'timeout'; text: string; pageLevel: false } | null {
  if (!isLoreTimeout(err)) return null;
  const text = err instanceof LoreTimeoutError ? err.message : 'не дождались ответа LORE';
  return { kind: 'timeout', text, pageLevel: false };
}
