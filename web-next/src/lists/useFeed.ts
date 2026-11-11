// Пропсы ленты для ListView (K2-FEED-BODY-MORE, K2-FEED-TWO-LEVEL): тело
// записи, нижний уровень и рёбра-поводы — состояния, которые НАЗЫВАЕТ
// приложение, а kit только рисует (feedBody.ts, feedUnder.ts в kit/src/list).
//
// Главное правило — ничего не тянуть на всю ленту. Тело или его голова
// (`body_head`, первые 3 абзаца — режет сервер) из строки среза отдаются сразу
// (они уже приехали); остального нет, пока человек не раскрыл ОДНУ запись: тогда
// идёт один паспорт `/lore/record` или один срез задач.
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { FeedBody, FeedUnder, KitEdge, KitRecord } from '@seidr/kit';
import { fetchLoreRecord } from '../api/liveRecord';
import type { LoreClient } from '../sprints/loreClient';
import { LoreError } from '../sprints/loreClient';
import { edgesFromFields, pickSection, type FeedSpec } from './feed';
import type { AppKey } from '../i18n';

type Row = Record<string, unknown>;

export interface UseFeedArgs {
  spec: FeedSpec | undefined;
  /** Тип паспорта раздела (`/lore/record/{type}`); нет — тело за строкой не догружается. */
  passportType: string | undefined;
  rows: readonly Row[] | undefined;
  records: readonly KitRecord[];
  map: (row: Row) => KitRecord;
  client: LoreClient;
  fetchImpl?: typeof fetch;
  /** Подписи разделов (FeedSpec.titles). Нет — тело без подписи раздела. */
  t?: (k: AppKey) => string;
}

export interface FeedProps {
  feedBody?: (r: KitRecord) => FeedBody | null;
  onFeedBody?: (id: string) => void;
  feedUnder?: (r: KitRecord) => FeedUnder | null;
  onFeedUnder?: (id: string) => void;
  /** Рёбра-поводы: из полей строки сразу и из связей паспорта после раскрытия. */
  edges: KitEdge[];
}

const reasonOf = (e: unknown) => (e instanceof Error ? e.message : String(e));

export function useFeed({ spec, passportType, rows, records, map, client, fetchImpl, t }: UseFeedArgs): FeedProps {
  // Лента — лента паспортов (владелица 11.11.2026): тело — ОДИН раздел с подписью
  // паспорта. Номер раздела в lead → подпись; неизвестен — без подписи.
  const titleOf = useCallback((i: number): string | undefined => {
    const k = i >= 0 ? spec?.titles?.[i] : undefined;
    return k && t ? t(k) : undefined;
  }, [spec, t]);
  const sec = (i: number) => { const s = titleOf(i); return s ? { section: s } : {}; };
  const [bodies, setBodies] = useState<ReadonlyMap<string, FeedBody>>(new Map());
  const [unders, setUnders] = useState<ReadonlyMap<string, FeedUnder>>(new Map());
  const [linkEdges, setLinkEdges] = useState<KitEdge[]>([]);
  // Новая выдача — состояния прежней не переносятся: иначе «загружено»
  // осталось бы у записи, которой в выдаче уже другое тело.
  useEffect(() => { setBodies(new Map()); setUnders(new Map()); setLinkEdges([]); }, [rows]);

  // Тело, уже приехавшее строкой среза: абзацы считаются один раз на выдачу.
  const rowBodies = useMemo(() => {
    if (!spec?.inRow || !rows) return null;
    const m = new Map<string, { index: number; paragraphs: string[] }>();
    for (const row of rows) m.set(map(row).id, pickSection(spec.lead, row));
    return m;
  }, [spec, rows, map]);

  // Голова тела с сервера (K2-FEED-BODY-MORE): body_head — первые абзацы, body_rest —
  // сколько ещё в источнике. Строки без body_head (старый сервер, тело скрыто правами)
  // сюда не попадают — для них остаётся честное «Ещё» без числа.
  const rowHeads = useMemo(() => {
    if (!spec?.headInRow || !rows) return null;
    const m = new Map<string, FeedBody | null>();
    for (const row of rows) {
      const head = row.body_head;
      if (!Array.isArray(head)) continue;
      const paragraphs = head.filter((p): p is string => typeof p === 'string' && p.trim() !== '');
      const rest = typeof row.body_rest === 'number' ? row.body_rest : row.body_more === false ? 0 : null;
      // Головы нет и остатка нет — проверенно пустое тело: блока нет, «Ещё» не обещаем.
      const at = typeof row.body_sec === 'number' ? row.body_sec : -1;
      m.set(map(row).id, !paragraphs.length && rest === 0 ? null : { kind: 'head', paragraphs, restCount: rest, ...sec(at) });
    }
    return m;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spec, rows, map, titleOf]);

  const feedBody = useCallback((r: KitRecord): FeedBody | null => {
    const got = bodies.get(r.id);
    if (got) return got;
    if (rowBodies) {
      const p = rowBodies.get(r.id);
      // Пустое тело в строке — проверенно пустое: блока нет, «Ещё» не обещаем.
      return p && p.paragraphs.length ? { kind: 'full', paragraphs: p.paragraphs, ...sec(p.index) } : null;
    }
    if (rowHeads?.has(r.id)) return rowHeads.get(r.id) ?? null;
    // Тела в строке нет и паспорта нет — взять его неоткуда, и обещать нечего.
    if (!passportType) return null;
    // Остаток в источнике, числа не знаем: kit пишет «Ещё» без числа.
    return { kind: 'head', paragraphs: [], restCount: null };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bodies, rowBodies, rowHeads, passportType, titleOf]);

  const onFeedBody = useCallback((id: string) => {
    if (!spec || !passportType) return;
    const put = (b: FeedBody) => setBodies(prev => new Map(prev).set(id, b));
    // Пришедшая голова не исчезает ни на время запроса, ни после сбоя.
    const got = rowHeads?.get(id);
    const head = got?.paragraphs ?? [];
    const named = got?.section ? { section: got.section } : {};
    put({ kind: 'loading', paragraphs: head, ...named });
    fetchLoreRecord(passportType, id, fetchImpl ? { fetchImpl } : {}).then(
      rec => {
        // Остаток ТОГО ЖЕ раздела, что выбрал сервер, — не склейка всех разделов.
        const p = pickSection(spec.lead, rec.values);
        put({ kind: 'full', paragraphs: p.paragraphs, ...sec(p.index) });
        const because = spec.because ?? [];
        const add = rec.links
          .filter(l => because.includes(l.rel) && l.id)
          .map(l => (l.dir === 'out' ? { from: id, to: l.id, type: l.rel } : { from: l.id, to: id, type: l.rel }));
        if (add.length) setLinkEdges(prev => [...prev, ...add]);
      },
      e => put({ kind: 'failed', paragraphs: head, reason: reasonOf(e), ...named }),
    );
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spec, passportType, fetchImpl, rowHeads, titleOf]);

  const under = spec?.under;
  const feedUnder = useCallback(
    (r: KitRecord): FeedUnder | null => unders.get(r.id) ?? { kind: 'rest', count: null },
    [unders],
  );
  const onFeedUnder = useCallback((id: string) => {
    if (!under) return;
    const put = (u: FeedUnder) => setUnders(prev => new Map(prev).set(id, u));
    put({ kind: 'loading' });
    under.load(client, id).then(
      res => put({ kind: 'here', records: res.records, ...(res.total !== undefined ? { total: res.total } : {}) }),
      // «Нет прав» ≠ «не дошло»: повтор при отказе по правам бессмыслен.
      e => put(e instanceof LoreError && e.status === 403
        ? { kind: 'forbidden', reason: reasonOf(e) }
        : { kind: 'failed', reason: reasonOf(e) }),
    );
  }, [under, client]);

  const fieldEdges = useMemo(() => (spec ? edgesFromFields(records, spec) : []), [spec, records]);
  const edges = useMemo(() => [...fieldEdges, ...linkEdges], [fieldEdges, linkEdges]);

  if (!spec) return { edges: [] };
  return {
    feedBody,
    ...(passportType && !spec.inRow ? { onFeedBody } : {}),
    ...(under ? { feedUnder, onFeedUnder } : {}),
    edges,
  };
}
