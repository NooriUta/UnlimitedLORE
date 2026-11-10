// Пропсы ленты для ListView (K2-FEED-BODY-MORE, K2-FEED-TWO-LEVEL): тело
// записи, нижний уровень и рёбра-поводы — состояния, которые НАЗЫВАЕТ
// приложение, а kit только рисует (feedBody.ts, feedUnder.ts в kit/src/list).
//
// Главное правило — ничего не тянуть на всю ленту. Тело из строки среза
// отдаётся сразу (оно уже приехало); остального нет, пока человек не раскрыл
// ОДНУ запись: тогда идёт один паспорт `/lore/record` или один срез задач.
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { FeedBody, FeedUnder, KitEdge, KitRecord } from '@seidr/kit';
import { fetchLoreRecord } from '../api/liveRecord';
import type { LoreClient } from '../sprints/loreClient';
import { LoreError } from '../sprints/loreClient';
import { edgesFromFields, paragraphsOf, type FeedSpec } from './feed';

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

export function useFeed({ spec, passportType, rows, records, map, client, fetchImpl }: UseFeedArgs): FeedProps {
  const [bodies, setBodies] = useState<ReadonlyMap<string, FeedBody>>(new Map());
  const [unders, setUnders] = useState<ReadonlyMap<string, FeedUnder>>(new Map());
  const [linkEdges, setLinkEdges] = useState<KitEdge[]>([]);
  // Новая выдача — состояния прежней не переносятся: иначе «загружено»
  // осталось бы у записи, которой в выдаче уже другое тело.
  useEffect(() => { setBodies(new Map()); setUnders(new Map()); setLinkEdges([]); }, [rows]);

  // Тело, уже приехавшее строкой среза: абзацы считаются один раз на выдачу.
  const rowBodies = useMemo(() => {
    if (!spec?.inRow || !rows) return null;
    const m = new Map<string, string[]>();
    for (const row of rows) m.set(map(row).id, paragraphsOf(...spec.lead.map(k => row[k])));
    return m;
  }, [spec, rows, map]);

  const feedBody = useCallback((r: KitRecord): FeedBody | null => {
    const got = bodies.get(r.id);
    if (got) return got;
    if (rowBodies) {
      const p = rowBodies.get(r.id) ?? [];
      // Пустое тело в строке — проверенно пустое: блока нет, «Ещё» не обещаем.
      return p.length ? { kind: 'full', paragraphs: p } : null;
    }
    // Тела в строке нет и паспорта нет — взять его неоткуда, и обещать нечего.
    if (!passportType) return null;
    // Остаток в источнике, числа не знаем: kit пишет «Ещё» без числа.
    return { kind: 'head', paragraphs: [], restCount: null };
  }, [bodies, rowBodies, passportType]);

  const onFeedBody = useCallback((id: string) => {
    if (!spec || !passportType) return;
    const put = (b: FeedBody) => setBodies(prev => new Map(prev).set(id, b));
    put({ kind: 'loading', paragraphs: [] });
    fetchLoreRecord(passportType, id, fetchImpl ? { fetchImpl } : {}).then(
      rec => {
        put({ kind: 'full', paragraphs: paragraphsOf(...spec.lead.map(k => rec.values[k])) });
        const because = spec.because ?? [];
        const add = rec.links
          .filter(l => because.includes(l.rel) && l.id)
          .map(l => (l.dir === 'out' ? { from: id, to: l.id, type: l.rel } : { from: l.id, to: id, type: l.rel }));
        if (add.length) setLinkEdges(prev => [...prev, ...add]);
      },
      e => put({ kind: 'failed', paragraphs: [], reason: reasonOf(e) }),
    );
  }, [spec, passportType, fetchImpl]);

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
