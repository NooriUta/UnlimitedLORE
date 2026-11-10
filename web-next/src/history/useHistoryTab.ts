// Источник вкладки «История» для паспорта v2 (SPRINT_UXR_S9_SCALE_OPT/S9-09,
// клиентская половина).
//
// Было: экран (ListPassport) сам держал `histLimit` и собирал источник руками,
// а из параметров сервера пользовался только `limit`. Поэтому ни `author_kind`
// (PR #948), ни `author`/`collapse` (PR #1083) до человека не доходили:
// параметр, который мы шлём, но не даём выбрать, — это не возможность. Запрос
// вкладки живёт здесь, вкладка kit его меняет через `onQuery`.
//
// Что здесь важно по честности:
//   • «нет прав» (403) ≠ «истории нет»: HistoryForbidden → state 'forbidden';
//   • тип вне таблицы SCD2 — «история не ведётся», сервер о нём не спрашиваем;
//   • список авторов для фильтра НАКАПЛИВАЕТСЯ: сузив выдачу до одного автора,
//     нельзя терять остальные варианты — иначе из фильтра не выйти;
//   • разворот свёрнутой серии честный: правок пришло меньше, чем в серии, —
//     вкладка скажет это числом, а не домолчит.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  HISTORY_QUERY_ALL, authorCaller, authorOptions, mergeAuthorOptions, useLoadState,
  type KitHistoryAuthorOption, type KitHistoryQuery, type KitHistoryVersion, type RecordHistorySource,
} from '@seidr/kit';
import {
  HISTORY_PAGE, HISTORY_TRACKED, HistoryForbidden, NOT_TRACKED, fetchHistory,
} from '../record/historySource';

/** Предел страницы на сервере (LoreEntityHistory.PAGE_MAX) — больше он не отдаст. */
const SERVER_PAGE_MAX = 500;

export interface UseHistoryTabOptions {
  fetchImpl?: typeof fetch;
  /** Поля, которые write-API умеет вернуть; пусто — вкладка только для чтения. */
  restorable?: readonly string[];
  onRestore?: RecordHistorySource['onRestore'];
}

/** Запрос вкладки → параметры GET /lore/history. */
function paramsOf(q: KitHistoryQuery, limit: number) {
  return {
    limit,
    order: 'desc' as const,
    ...(q.authorKind ? { author_kind: q.authorKind } : {}),
    ...(q.author ? { author: q.author } : {}),
    ...(q.field ? { field: q.field } : {}),
    ...(q.collapse ? { collapse: 'agent' as const } : {}),
  };
}

export function useHistoryTab(type: string, id: string, opts: UseHistoryTabOptions = {}): RecordHistorySource {
  const { fetchImpl, restorable, onRestore } = opts;
  const tracked = HISTORY_TRACKED.has(type);
  const [query, setQuery] = useState<KitHistoryQuery>(HISTORY_QUERY_ALL);
  // Листание (S9-09): растим предел и перечитываем страницу. Растить, а не
  // склеивать куски: сервер отдаёт историю одной выборкой с page, и склейка на
  // клиенте разошлась бы с ней при чужой правке посреди листания.
  const [limit, setLimit] = useState(HISTORY_PAGE);
  const [authors, setAuthors] = useState<readonly KitHistoryAuthorOption[]>([]);

  const qkey = JSON.stringify(query);
  const hist = useLoadState(
    () => (tracked
      ? fetchHistory(type, id, paramsOf(query, limit), fetchImpl)
      : Promise.resolve(NOT_TRACKED)),
    [type, id, fetchImpl, tracked, limit, qkey],
  );

  // Другая запись — другая история: и фильтр, и накопленные авторы сбрасываются.
  const target = `${type}\u0000${id}`;
  const seen = useRef(target);
  useEffect(() => {
    if (seen.current === target) return;
    seen.current = target;
    setQuery(HISTORY_QUERY_ALL);
    setLimit(HISTORY_PAGE);
    setAuthors([]);
  }, [target]);

  const versions = hist.data?.versions;
  useEffect(() => {
    if (!versions) return;
    const fresh = authorOptions(versions);
    if (fresh.length === 0) return;
    setAuthors(known => mergeAuthorOptions(known, fresh));
  }, [versions]);

  const onQuery = useCallback((q: KitHistoryQuery) => {
    // Новый фильтр — снова первая страница: оставить разросшийся предел значит
    // показать под новым запросом объём прежнего.
    setLimit(HISTORY_PAGE);
    setQuery(q);
  }, []);

  /**
   * Правки свёрнутой серии по одной. Диапазона у сервера нет, поэтому берём
   * правки ЭТОГО агента без свёртки и оставляем попавшие в окно серии — от её
   * первой правки до последней (она же строка серии).
   */
  const onExpand = useCallback(async (v: KitHistoryVersion): Promise<readonly KitHistoryVersion[]> => {
    const caller = authorCaller(v.author);
    const run = v.collapsed;
    if (!caller || !run) return [];
    const h = await fetchHistory(type, id, {
      author: caller, author_kind: 'agent', order: 'desc', limit: SERVER_PAGE_MAX,
      ...(query.field ? { field: query.field } : {}),
    }, fetchImpl);
    const from = run.first_valid_from ?? '';
    const to = v.valid_from ?? '';
    return h.versions.filter(x => {
      const t = x.valid_from ?? '';
      return t !== '' && t >= from && t <= to;
    });
  }, [type, id, fetchImpl, query.field]);

  const data = hist.data;
  return useMemo<RecordHistorySource>(() => ({
    // «Не прочитали» и «запрещено» — разные состояния, и оба не «пусто».
    // useLoadState различает «пусто» и «частично» — вкладке истории эти
    // оттенки не нужны: версий ноль она покажет сама (и отличит «ничего не
    // нашлось по фильтру» от «правок нет»), а предупреждения приходят в
    // warnings ответа. Поэтому и empty, и partial — это 'ok'.
    state: hist.state === 'error'
      ? (hist.error instanceof HistoryForbidden ? 'forbidden' : 'error')
      : hist.state === 'loading' ? 'loading' : 'ok',
    data,
    error: hist.error,
    onRetry: hist.reload,
    restorable,
    onRestore,
    // «Показать ещё» есть только пока сервер говорит, что дальше есть.
    onMore: data?.page?.has_more ? () => setLimit(n => Math.min(n + HISTORY_PAGE, SERVER_PAGE_MAX)) : undefined,
    loadingMore: hist.state === 'loading' && limit > HISTORY_PAGE,
    // Фильтры показываем только там, где история вообще ведётся: у типа без
    // цепочки SCD2 фильтровать нечего, и орган управления был бы обманом.
    query: tracked ? query : undefined,
    onQuery: tracked ? onQuery : undefined,
    authors,
    onExpand: tracked ? onExpand : undefined,
  }), [hist.state, hist.error, hist.reload, data, restorable, onRestore, limit, tracked, query, onQuery, authors, onExpand]);
}
