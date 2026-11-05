import { useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';

/**
 * AH-09: состояние экрана (вкладка, выбранный элемент, вид) живёт в URL,
 * а не в useState — ссылку можно переслать, F5 и «назад» не теряют выбор.
 *
 * Правила, общие для всех экранов:
 *  - пишем одним параметром, ЧУЖИЕ (section/passport/q/…) не трогаем;
 *  - значение по умолчанию (а также null и '') УДАЛЯЕТ ключ — URL чистый,
 *    пока пользователь ничего не выбрал;
 *  - смена идёт с { replace: true }: клик по вкладке не плодит записей
 *    истории (иначе «назад» листал бы вкладки вместо разделов).
 */
export function mergeParam(
  params: URLSearchParams,
  key: string,
  value: string | null | undefined,
  def: string,
): URLSearchParams {
  const next = new URLSearchParams(params);
  if (value == null || value === '' || value === def) next.delete(key);
  else next.set(key, value);
  return next;
}

/** Чтение с дефолтом; при заданном белом списке мусор из URL даёт дефолт. */
export function readParam<T extends string>(
  params: URLSearchParams,
  key: string,
  def: T,
  allowed?: readonly T[],
): T {
  const raw = params.get(key);
  if (raw == null || raw === '') return def;
  if (allowed && !allowed.includes(raw as T)) return def;
  return raw as T;
}

/**
 * База для обновления — ЖИВОЙ location.search, а не prev из useSearchParams.
 * react-router 7 отдаёт в функциональный setSearchParams снимок из замыкания
 * последнего рендера: два сеттера в одном обработчике (clearAll: статус+рубрика+
 * канал) затирали друг друга, выживал последний. BrowserRouter пишет history
 * синхронно, так что location.search уже содержит предыдущий вызов.
 */
function liveParams(prev: URLSearchParams): URLSearchParams {
  return typeof window !== "undefined" ? new URLSearchParams(window.location.search) : prev;
}

export type UrlStateSetter<T> = (v: T | null | ((prev: T) => T | null)) => void;

export function useUrlState<T extends string>(
  key: string,
  def: T,
  allowed?: readonly T[],
): [T, UrlStateSetter<T>] {
  const [params, setParams] = useSearchParams();
  const value = readParam(params, key, def, allowed);
  const set = useCallback<UrlStateSetter<T>>((v) => {
    setParams(p0 => {
      const prev = liveParams(p0);
      const cur = readParam(prev, key, def, allowed);
      const nextVal = typeof v === 'function' ? (v as (p: T) => T | null)(cur) : v;
      return mergeParam(prev, key, nextVal, def);
    }, { replace: true });
  // allowed — литерал-массив у вызывающего; сравнивать по ссылке незачем.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, def, setParams]);
  return [value, set];
}

/** Выбранный/раскрытый id: отсутствие ключа = null. */
export function useUrlId(key: string): [string | null, (v: string | null | ((prev: string | null) => string | null)) => void] {
  const [raw, setRaw] = useUrlState<string>(key, '');
  const set = useCallback((v: string | null | ((prev: string | null) => string | null)) => {
    setRaw(prev => (typeof v === 'function' ? v(prev || null) : v));
  }, [setRaw]);
  return [raw || null, set];
}

/** Мультивыбор: каждое значение — отдельный повтор ключа; пустой набор удаляет ключ. */
export function mergeSetParam(params: URLSearchParams, key: string, values: Iterable<string>): URLSearchParams {
  const next = new URLSearchParams(params);
  next.delete(key);
  for (const v of values) if (v !== '') next.append(key, v);
  return next;
}

export function readSetParam(params: URLSearchParams, key: string): Set<string> {
  return new Set(params.getAll(key).filter(v => v !== ''));
}

/** Набор-фильтр в URL; сеттер совместим с React.Dispatch<SetStateAction<Set<string>>>. */
export function useUrlSet(key: string): [Set<string>, (v: Set<string> | ((prev: Set<string>) => Set<string>)) => void] {
  const [params, setParams] = useSearchParams();
  const sig = params.getAll(key).join('\u0000');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const value = useMemo(() => readSetParam(params, key), [sig, key]);
  const set = useCallback((v: Set<string> | ((prev: Set<string>) => Set<string>)) => {
    setParams(p0 => {
      const prev = liveParams(p0);
      const nextVal = typeof v === "function" ? v(readSetParam(prev, key)) : v;
      return mergeSetParam(prev, key, nextVal);
    }, { replace: true });
  }, [key, setParams]);
  return [value, set];
}

/**
 * Смена раздела/вкладки страницы (?section=, ?tab=): при ДРУГОМ значении
 * удаляет ключи состояния экранов этого уровня. Раньше это делал размонтаж —
 * useState экрана сбрасывался сам; теперь состояние в URL, и без сброса
 * вкладка аналитики «пережила» бы уход в другой раздел. Мутирует params
 * (так устроены колбэки setParams в LorePage/MuninnPage).
 */
export function switchParam(params: URLSearchParams, key: string, value: string, ownedKeys: readonly string[]): URLSearchParams {
  if (params.get(key) !== value) ownedKeys.forEach(k => params.delete(k));
  params.set(key, value);
  return params;
}
