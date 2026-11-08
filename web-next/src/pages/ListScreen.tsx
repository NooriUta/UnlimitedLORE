// Экран списка v2 — спринты / ADR (SPRINT_UXR_S4_UI_SHELL_LISTS/S4-04).
// Данные — реальный слайс LORE через клиент v2 (api/loreClient), состояния —
// хук kit (useLoadState): loading → скелет, 403 → «нет прав», сбой → ошибка с
// причиной и «Повторить». Пустоту и «обрезано» рисует сам движок списка kit
// по meta (проверенный ноль ≠ «фильтр отсеял» ≠ «обрезано сервером»).
import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import {
  Forbidden, ICON_CANON, ListView, LoadError, RecordDock, ScreenHead, Skeleton, pushUrlState, readUrlState,
  useKitLang, useLoadState,
} from '@seidr/kit';
import type { KitProgressInput, RecordPlacement, UrlWindow } from '@seidr/kit';
import { fetchSlice } from '../api/loreClient';
import { useAppT } from '../i18n';
import { LIST_SCREENS, type ListScreenDef, type ListScreenId } from '../lists/screens';
import { createLoreClient, defaultLoreClient } from '../sprints/loreClient';
import { sliceToKitData, sliceWarnings } from '../lists/records';
import type { PassportType } from '../record/passportAdapters';
import './ListScreen.css';

// Паспорт из живого списка (просьба владелицы 08.11: «подключить паспорта как есть»):
// до этого заголовок строки вёл в никуда (href по умолчанию «#id»). Свой чанк — MD-элементы.
const ListPassport = lazy(() => import('../record/ListPassport'));
/** Тип паспорта по экрану списка. */
const PASSPORT_OF: Record<ListScreenId, PassportType> = { sprints: 'sprint', adrs: 'adr' };
const PLACES: readonly RecordPlacement[] = ['right', 'bottom', 'full'];
type OpenRecord = { id: string | null; place: RecordPlacement };

/** Открытая запись и место — в URL (?open=&place=), как всё состояние v2; urlState=false — в памяти. */
function useOpenRecord(urlState: ListScreenProps['urlState']) {
  const win: UrlWindow | undefined = urlState === false ? undefined
    : typeof urlState === 'object' ? urlState
      : typeof window === 'undefined' ? undefined : window;
  const [open, setOpen] = useState<OpenRecord>(() => {
    if (!win) return { id: null, place: 'right' };
    const p = readUrlState(win);
    const id = p.get('open');
    const raw = p.get('place') ?? '';
    const place = (PLACES as readonly string[]).includes(raw) ? (raw as RecordPlacement) : 'right';
    return { id: id || null, place };
  });
  const set = (next: OpenRecord) => {
    setOpen(next);
    if (win) pushUrlState({ open: next.id, place: next.place !== 'right' ? next.place : null }, { replace: true, win });
  };
  return [open, set] as const;
}

export interface ListScreenProps {
  screen: ListScreenId;
  /** Подмена сети (тесты); по умолчанию — window.fetch. */
  fetchImpl?: typeof fetch;
  /** Состояние списка в URL (по умолчанию window); false — в памяти. */
  urlState?: boolean | UrlWindow;
  /** Свой заголовок экрана; false — внутри раздела оболочки, где заголовок уже есть. */
  heading?: boolean;
  /**
   * id заголовка (S4-23): раздел оболочки подписан им через aria-labelledby.
   * Заголовок — шапка экрана kit (ScreenHead): виды встают в его строку.
   */
  titleId?: string;
}

export function ListScreen({ screen, fetchImpl, urlState, heading = true, titleId }: ListScreenProps) {
  const def: ListScreenDef = LIST_SCREENS[screen];
  const nested = def.nested;
  // Клиент вложенного (прогресс, раскрытие, смена статуса) — тот же fetch, что у списка.
  const client = useMemo(() => (fetchImpl ? createLoreClient({ fetch: fetchImpl }) : defaultLoreClient), [fetchImpl]);
  const lang = useKitLang();
  const t = useAppT();
  const [open, setOpen] = useOpenRecord(urlState);
  const config = useMemo(() => def.config(lang), [def, lang]);
  const result = useLoadState(
    signal => fetchSlice(def.slice, undefined, { signal, fetchImpl }),
    [def.slice, fetchImpl],
    { rows: body => body.rows },
  );
  const body = result.data;
  const data = useMemo(
    () => (body ? sliceToKitData(body, def.map, new Date().toISOString()) : null),
    [body, def],
  );
  const warnings = body ? sliceWarnings(body) : [];

  // Прогресс «x/y» (S4-09): догружается после списка; пока считается — «…»,
  // упавшая пачка — «?» с причиной (это решает loadProgress), а не 0/0.
  const ids = useMemo(() => data?.records.map(r => r.id) ?? [], [data]);
  const [progress, setProgress] = useState<Map<string, KitProgressInput> | null>(null);
  useEffect(() => {
    if (!nested || !ids.length) return;
    const ctl = new AbortController();
    setProgress(null);
    nested.loadProgress(client, ids, ctl.signal).then(
      m => { if (!ctl.signal.aborted) setProgress(m); },
      () => { /* отмена: экран ушёл или список перезагрузился */ },
    );
    return () => ctl.abort();
  }, [nested, client, ids]);
  const shownData = useMemo(() => {
    if (!data || !nested) return data;
    const field = nested.progressField;
    return {
      ...data,
      records: data.records.map(r => ({ ...r, fields: { ...r.fields, [field]: progress?.get(r.id) ?? { loading: true } } })),
    };
  }, [data, nested, progress]);

  const headId = titleId ?? `list-screen-${screen}`;
  // Иконка заголовка — из канона LORE v1 (S4-25): def.icon = иконка раздела v1.
  const head = heading ? { title: t(def.titleKey), titleId: headId, icon: def.icon } : undefined;
  const ready = !(result.state === 'loading' || result.state === 'error' || result.state === 'forbidden' || !data);

  let content;
  if (result.state === 'loading' || (!data && result.state !== 'error' && result.state !== 'forbidden')) {
    content = <Skeleton lines={6} label={t('lists.loading')} />;
  } else if (result.state === 'forbidden') {
    content = <Forbidden reason={body?.outside_scope?.reason ?? (result.error instanceof Error ? result.error.message : undefined)} />;
  } else if (result.state === 'error' || !data) {
    content = <LoadError error={result.error} onRetry={result.reload} />;
  } else {
    content = (
      <ListView
        config={config}
        data={shownData ?? data}
        urlState={urlState}
        quickIcons={def.quickIcons}
        // S4-25: иконки видов — выбор владелицы (lucide из v1), из общего словаря kit.
        viewIcons={{ list: ICON_CANON.viewList, board: ICON_CANON.viewBoard }}
        head={head}
        expand={nested ? { render: r => nested.render(r.id, client) } : undefined}
        onOpen={id => setOpen({ ...open, id })}
        recordPlace={{ value: open.place, onChange: place => setOpen({ ...open, place }) }}
      />
    );
  }

  if (open.id && ready) {
    const place = open.place;
    content = (
      // Место паспорта — настройка в «Вид» списка; «Закрыть» — кнопка дока (владелица 08.11).
      <RecordDock placement={place} onExitFull={() => setOpen({ ...open, place: 'bottom' })} onClose={() => setOpen({ ...open, id: null })} backdrop={content}>
        <Suspense fallback={<Skeleton lines={8} label={t('pp.loading')} />}>
          <ListPassport key={open.id} type={PASSPORT_OF[screen]} id={open.id} placement={place} fetchImpl={fetchImpl}
            backLabel={t(def.titleKey)} onBack={() => setOpen({ ...open, id: null })}
            ids={ids} onGo={id => setOpen({ ...open, id })}
            onFull={place === 'full' ? undefined : () => setOpen({ ...open, place: 'full' })} />
        </Suspense>
      </RecordDock>
    );
  }

  return (
    <section className="list-screen" data-screen={screen} aria-labelledby={heading && !titleId ? headId : undefined}>
      {/* Пока списка нет (загрузка, ошибка, нет прав) — та же шапка без видов: заголовок не прыгает. */}
      {head && !ready && <ScreenHead {...head} />}
      {warnings.length > 0 && (
        <ul className="list-screen__warn" aria-label={t('lists.warnings')}>
          {warnings.map(w => <li key={w}>{w}</li>)}
        </ul>
      )}
      {content}
    </section>
  );
}

export default ListScreen;
