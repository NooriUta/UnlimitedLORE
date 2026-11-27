// Паспорт записи в ленте LORE (SPRINT_LORE_BOARD_PASSPORTS/BP-01-FULL-PASSPORT-FEED).
//
// Прототип docs/prototypes/bp-01-passport-feed.html принят владельцем 25.11.2026:
// в режиме «Полные паспорта» каждая запись ленты — паспорт целиком. Источник —
// ТОТ ЖЕ, что у паспорта записи (ListPassport): фасад /lore/record, при его сбое —
// срезы с названной причиной; перевод — тот же fromLoreRecord; зоны рисует kit
// (RecordFeedPassport) компонентами паспорта. Своего пути к данным здесь нет —
// иначе лента и паспорт однажды показали бы одну запись по-разному.
//
// Компонент монтируется ТОЛЬКО для видимых записей (окно ленты в kit), поэтому
// паспорт невидимой записи не грузится. История — только по раскрытию.
//
// Только чтение: правка — в паспорте записи. Свой чанк, как у ListPassport:
// MartProse и живые блоки список за них не платит.
import { useMemo, useState } from 'react';
import {
  Forbidden, LoadError, RecordFeedPassport, Skeleton, useKitLang, useLoadState,
  type KitCtx, type RecordHistorySource,
} from '@seidr/kit';
import { RecordForbidden } from '../api/liveRecord';
import { fetchSlice } from '../api/loreClient';
import { useAppT } from '../i18n';
import { mdFor } from './ListPassport';
import { fromLoreRecord } from './loreRecordContract';
import { passportHref } from './passportHref';
import { type AnyPassportType } from './passportAdapters';
import { loadRecordContract } from './recordSource';
import { HISTORY_PAGE, HISTORY_TRACKED, HistoryForbidden, fetchHistory } from './historySource';

const esc = (s: string) => s.replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);

export interface FeedPassportProps {
  type: AnyPassportType;
  id: string;
  fetchImpl?: typeof fetch;
}

export default function FeedPassport({ type, id, fetchImpl }: FeedPassportProps) {
  const t = useAppT();
  const lang = useKitLang();
  const slice = useMemo(() => <T,>(name: string, params?: Record<string, string>) => fetchSlice<T>(name, params, { fetchImpl }), [fetchImpl]);
  const pp = useLoadState(() => loadRecordContract(type, id, lang, slice, { fetchImpl }), [type, id, lang, slice, fetchImpl]);
  const contract = pp.data ?? null;
  const view = useMemo(() => (contract ? fromLoreRecord(contract, lang) : null), [contract, lang]);

  // История: до раскрытия НЕ запрашивается (прототип: «грузится только при раскрытии»).
  const [histOn, setHistOn] = useState(false);
  const [histLimit, setHistLimit] = useState(HISTORY_PAGE);
  const hist = useLoadState(
    () => (histOn ? fetchHistory(type, id, { limit: histLimit }, fetchImpl) : Promise.resolve(null)),
    [histOn, type, id, histLimit, fetchImpl],
  );
  const histSource: RecordHistorySource | undefined = histOn && !(hist.state === 'loading' && !hist.data)
    ? {
      state: hist.state === 'error' ? (hist.error instanceof HistoryForbidden ? 'forbidden' : 'error') : hist.state === 'loading' ? 'loading' : 'ok',
      ...(hist.data ? { data: hist.data } : {}),
      error: hist.error,
      onRetry: hist.reload,
      onMore: hist.data?.page?.has_more ? () => setHistLimit(n => n + HISTORY_PAGE) : undefined,
      loadingMore: hist.state === 'loading' && histLimit > HISTORY_PAGE,
    }
    : undefined;

  if (pp.state === 'error') {
    // «Не смогли загрузить» и «нет прав» — разные ответы, и оба не «пусто».
    return pp.error instanceof RecordForbidden
      ? <Forbidden reason={pp.error.message} />
      : <LoadError compact title={t('lists.feedPassport.failed')} error={pp.error} onRetry={pp.reload} />;
  }
  if (!view) return <Skeleton lines={4} label={t('pp.loading')} />;

  const ctx: KitCtx = {
    config: view.config, data: view.data, role: 'reader',
    href: passportHref(view.data.records, contract?.values ?? {}, x => '#' + encodeURIComponent(x)),
    esc, md: mdFor(type, id),
  };
  return (
    <RecordFeedPassport
      record={view.record}
      ctx={ctx}
      {...(HISTORY_TRACKED.has(type) ? { history: { onOpen: () => setHistOn(true), ...(histSource ? { source: histSource } : {}) } } : {})}
    />
  );
}
