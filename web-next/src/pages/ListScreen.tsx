// Экран списка v2 — спринты / ADR (SPRINT_UXR_S4_UI_SHELL_LISTS/S4-04).
// Данные — реальный слайс LORE через клиент v2 (api/loreClient), состояния —
// хук kit (useLoadState): loading → скелет, 403 → «нет прав», сбой → ошибка с
// причиной и «Повторить». Пустоту и «обрезано» рисует сам движок списка kit
// по meta (проверенный ноль ≠ «фильтр отсеял» ≠ «обрезано сервером»).
import { Suspense, useEffect, useMemo, useState } from 'react';
import { lazyChunk } from '../shell/staleChunk';
import {
  Forbidden, ICON_CANON, LibraryView, ListView, LoadError, NO_DATE_RANGE, RecordDock, ScreenHead, Skeleton, dateRangeUrlPatch,
  isDateRangeActive, isShowClosed, pushUrlState, readDateRangeUrl, readUrlState, showClosedOf, urlStateHref,
  useOptionalKitShell,
  useKitLang, useLoadState,
} from '@seidr/kit';
import type { DateFilterScope, DateRangeValue, KitRecord, KitShowClosed, ListViewKind, RecordPlacement, UrlWindow } from '@seidr/kit';
import { CALENDAR_DATE_PARAM, LIBRARY_OPEN_PARAM, LIBRARY_PARAM, calendarField, libraryGroups } from '../lists/library';
import { useFeed } from '../lists/useFeed';
import { fetchSlice } from '../api/loreClient';
import {
  DATE_FIELD, DATE_URL_PARAM, changedParams, isRangeRejected, markRangeUnsupported, rangeUnsupported,
} from '../lists/dateRange';
import { axesForKeys } from '../api/loreFacets';
import { useListFacets } from '../api/useListFacets';
import { useAppT } from '../i18n';
import { LIST_SCREENS, type ListScreenDef, type ListScreenId } from '../lists/screens';
import { createLoreClient, defaultLoreClient } from '../sprints/loreClient';
import { storage as appStorage } from '../storage/safe';
import { sliceToKitData, sliceWarnings } from '../lists/records';
import { loreValueIcon } from '../lists/loreFilters';
import { appliedCollapseNavOnRead, appliedPassportPlace } from '../settings/applied';
import { NEW_RECORD_ID, fetchCanCreate, isCreateType } from '../record/recordCreate';
import { useProjectScope } from '../scope/ProjectScope';
import { fetchTypeStatuses, type TypeStatuses } from '../record/passportStatuses';
import { setPaletteTarget } from '../palette/paletteTarget';
import type { PassportType } from '../record/passportAdapters';
import { loreListPeek } from '../record/lorePeek';
import './ListScreen.css';

// Паспорт из живого списка (просьба владелицы 08.11: «подключить паспорта как есть»):
// до этого заголовок строки вёл в никуда (href по умолчанию «#id»). Свой чанк — MD-элементы.
const ListPassport = lazyChunk(() => import('../record/ListPassport'));
// Черновик новой записи (S4-24) — тоже свой чанк: в нём TipTap.
const RecordCreate = lazyChunk(() => import('../record/RecordCreateDock'));
/**
 * Тип паспорта по экрану списка — карта ЧАСТИЧНАЯ (S4-V2-SECTIONS).
 *
 * Фасад записи отдаёт ровно четыре типа (`LoreRecordRegistry.TYPES` = sprint,
 * task, adr, spec), а разделов в v2 одиннадцать. Для остальных паспорта нет, и
 * раньше карта была полной — то есть обещала паспорт каждому разделу. Открыв
 * строку в «Технологиях», человек получил бы пустой паспорт и решил бы, что
 * данные потерялись.
 *
 * Поэтому отсутствие ключа — это утверждение, а не пробел: «паспорта у этого
 * типа ещё нет», и оно говорится словами (ниже, `NoPassport`). Карта растёт
 * вместе с фасадом: появился тип на сервере — появилась строка здесь.
 */
export const PASSPORT_OF: Partial<Record<ListScreenId, PassportType>> = {
  sprints: 'sprint', adrs: 'adr', tasks: 'task', specs: 'spec',
  // Появились 09.11 вместе с типами фасада (#988, #991). Четыре — только на
  // чтение; «только чтение» приходит в `perms`, клиент это не предполагает.
  decisions: 'decision', questions: 'question', milestones: 'milestone', releases: 'release',
  // Появились 10.11 (серверный PR #1090), тоже только на чтение. Технология
  // открывается по spec_id: путь /lore/record/tech/<SPEC-TECH-…>, обычная
  // спека по этому пути даёт 404 — то есть тип выбирает раздел, а не ключ.
  components: 'component', tech: 'tech', features: 'feature',
  // S4-29 (53а): паспорт проекта (только чтение).
  projects: 'project',
};
const PLACES: readonly RecordPlacement[] = ['right', 'bottom', 'full'];
const NO_RECORDS: readonly KitRecord[] = [];
const NO_PINNED: readonly string[] = [];
type OpenRecord = { id: string | null; place: RecordPlacement };
/** Место записи по умолчанию — личная настройка (S4-24, одна с S4-17); не выбирал — справа. */
const defaultPlace = (): RecordPlacement => appliedPassportPlace() ?? 'right';

/**
 * «Паспорта у этого типа ещё нет» — ответ на щелчок по строке в разделе без
 * паспорта (S4-V2-SECTIONS).
 *
 * Почему ответ, а не тишина: щелчок — это вопрос, и он задан. Молчаливая
 * строка читалась бы как «сломалось», пустой паспорт — как «данные пропали».
 * Названы обе вещи: чего нет (паспорт типа) и что есть (список и фильтры).
 * Код записи печатается — по нему её можно найти в LORE другим путём.
 */
function NoPassport({ id, section, onBack }: { id: string; section: string; onBack: () => void }) {
  const t = useAppT();
  return (
    <div className="list-screen__nopassport" role="status">
      <p className="list-screen__nopassport-head">{t('lists.noPassport.head', { section })}</p>
      <p className="list-screen__nopassport-id">{id}</p>
      <p className="list-screen__nopassport-note">{t('lists.noPassport.note')}</p>
      <button type="button" className="sk-btn" onClick={onBack}>{t('lists.noPassport.back')}</button>
    </div>
  );
}

/**
 * Адрес записи для «Недавнего» оболочки: текущий раздел плюс ?open=<id>.
 * Место (place) не берём — запись откроется там, где человек её смотрит сейчас.
 */
function recordHrefOf(urlState: ListScreenProps['urlState'], id: string): string | undefined {
  const win: UrlWindow | undefined = urlState === false ? undefined
    : typeof urlState === 'object' ? urlState
      : typeof window === 'undefined' ? undefined : window;
  return win ? urlStateHref(win, { open: id, place: null }, { anchor: null }) : undefined;
}

/** Открытая запись и место — в URL (?open=&place=), как всё состояние v2; urlState=false — в памяти. */
function useOpenRecord(urlState: ListScreenProps['urlState']) {
  const win: UrlWindow | undefined = urlState === false ? undefined
    : typeof urlState === 'object' ? urlState
      : typeof window === 'undefined' ? undefined : window;
  const fromUrl = (w: UrlWindow): OpenRecord => {
    const p = readUrlState(w);
    const id = p.get('open');
    const raw = p.get('place') ?? '';
    // Места в адресе нет — личная настройка «Где открывать запись» (S4-24), иначе справа.
    const place = (PLACES as readonly string[]).includes(raw) ? (raw as RecordPlacement) : defaultPlace();
    return { id: id || null, place };
  };
  const [open, setOpen] = useState<OpenRecord>(() => (win ? fromUrl(win) : { id: null, place: defaultPlace() }));
  // D-24: «назад»/«вперёд» меняют адрес не нашими руками — паспорт обязан
  // идти за ним, иначе адрес и экран расходятся молча. Следим только у
  // настоящего окна: у подменного окна тестов событий нет.
  useEffect(() => {
    const w = win as (UrlWindow & Partial<Pick<Window, 'addEventListener' | 'removeEventListener'>>) | undefined;
    if (!w?.addEventListener || !w.removeEventListener) return;
    const sync = () => setOpen(fromUrl(w));
    w.addEventListener('popstate', sync);
    w.addEventListener('hashchange', sync);
    return () => { w.removeEventListener!('popstate', sync); w.removeEventListener!('hashchange', sync); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [win]);
  const set = (next: OpenRecord) => {
    setOpen(next);
    if (!win) return;
    // Закрыли запись — в адресе не остаётся ни места, ни якоря (находка P1
    // аудита 08.11: «док закрывается, но в адресе остаются place=bottom
    // #SPRINT_…»). Это не косметика: по такому адресу запись откроется снова,
    // и «закрыл» перестаёт совпадать с «дал ссылку на список». Фильтры списка
    // при этом не трогаем — они принадлежат списку, а не записи.
    const closed = next.id == null;
    // Вкладка принадлежит ЗАПИСИ, поэтому при закрытии снимается вместе с ней
    // (D-21): иначе `tab=history` останется в адресе списка и следующая
    // открытая запись покажется не с начала, а с чужой вкладки.
    const patch = { open: next.id, place: closed || next.place === 'right' ? null : next.place, ...(closed ? { tab: null } : {}) };
    // Открыть и закрыть паспорт — шаг истории (D-24): «назад» его и отменяет.
    // Переход между записями (пейджер) и смена места — заменой, иначе листание
    // десяти записей потребовало бы десяти «назад», чтобы выйти из паспорта.
    const step = (open.id == null) !== closed;
    pushUrlState(patch, { replace: !step, win, ...(closed ? { anchor: null } : {}) });
  };
  /** Адрес списка без открытой записи — им крошка «←» становится ссылкой. */
  const backHref = win ? urlStateHref(win, { open: null, place: null, tab: null }, { anchor: null }) : undefined;
  // Окно отдаём наружу: паспорт пишет в адрес свою вкладку, и писать он обязан
  // в ТО ЖЕ окно, где живут `open` и `place` (D-21).
  return [open, set, backHref, win] as const;
}

type SliceAnswer = Awaited<ReturnType<typeof fetchSlice<Record<string, unknown>>>>;

/**
 * Открытые и закрытые одной выдачей: строки подряд, метаданные — основного
 * среза; неполнота любого из двух — неполнота всей выдачи (не молчим).
 */
export function mergeBodies(open: SliceAnswer, closed: SliceAnswer): SliceAnswer {
  const truncated = open.truncated || closed.truncated;
  return {
    ...open,
    rows: [...open.rows, ...closed.rows],
    ...(truncated ? { truncated, hint: open.hint ?? closed.hint } : {}),
    warnings: [...(open.warnings ?? []), ...(closed.warnings ?? [])],
  };
}

function browserZone(): string {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; } catch { return 'UTC'; }
}

/**
 * Диапазон «Изменены с … по …» в адресе (?changed=…, K2-DATE-RANGE): тот же
 * источник окна, что у открытой записи; urlState=false — в памяти.
 */
function useChangedRange(win: UrlWindow | undefined) {
  const [value, setValue] = useState<DateRangeValue>(() => (win ? readDateRangeUrl(readUrlState(win), DATE_URL_PARAM) : NO_DATE_RANGE));
  const set = (next: DateRangeValue) => {
    setValue(next);
    if (win) pushUrlState(dateRangeUrlPatch(DATE_URL_PARAM, next), { replace: true, win });
  };
  return [value, set] as const;
}

/**
 * Вид «Библиотека» в адресе (K2-VIEW-LIBRARY): `?lib=1` — вид включён,
 * `?libo=<id>` — читаемая запись. Это не вид движка списка kit (там
 * `lv=`), а соседний вид раздела, поэтому и параметры свои. Включить и
 * выключить — шаг истории («назад» возвращает список); выбор записи — заменой.
 */
function useLibraryState(win: UrlWindow | undefined) {
  const read = () => {
    const p = win ? readUrlState(win) : null;
    return { on: p?.get(LIBRARY_PARAM) === '1', doc: p?.get(LIBRARY_OPEN_PARAM) || null };
  };
  const [lib, setLib] = useState(read);
  const setOn = (on: boolean) => {
    setLib({ on, doc: null });
    if (win) pushUrlState({ [LIBRARY_PARAM]: on ? '1' : null, [LIBRARY_OPEN_PARAM]: null }, { win });
  };
  const setDoc = (doc: string) => {
    setLib(l => ({ ...l, doc }));
    if (win) pushUrlState({ [LIBRARY_OPEN_PARAM]: doc }, { win, replace: true });
  };
  return [lib, setOn, setDoc] as const;
}

/** Поле даты календаря в адресе (`?lcd=`, K2-VIEW-CALENDAR) — когда у раздела дат несколько. */
function useCalendarDate(win: UrlWindow | undefined) {
  const [picked, setPicked] = useState<string | null>(() => (win ? readUrlState(win).get(CALENDAR_DATE_PARAM) : null));
  const set = (field: string) => {
    setPicked(field);
    if (win) pushUrlState({ [CALENDAR_DATE_PARAM]: field }, { win, replace: true });
  };
  return [picked, set] as const;
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
  const [open, setOpen, backHref, urlWin] = useOpenRecord(urlState);
  // «Библиотека» и «Календарь» (K2-VIEW-LIBRARY, K2-VIEW-CALENDAR): состояние — в адресе.
  const [lib, setLibOn, setLibDoc] = useLibraryState(urlWin);
  const libraryOn = !!def.library && lib.on;
  const [calPicked, setCalPicked] = useCalendarDate(urlWin);
  // Вид движка списка — чтобы выбор даты календаря стоял только у календаря.
  // Узнаём его из onStateChange, а не из `lv` адреса: `lv=calendar` kit пока
  // не читает (readListState), и взятый из адреса вид разошёлся бы с экраном.
  const [listView, setListView] = useState<ListViewKind | null>(null);
  // Оболочка ведёт «Недавнее», но узнать об открытии записи сама не может:
  // список открывает паспорт своим состоянием (?open=…). Отсюда и находка P1
  // аудита 08.11 — «"Недавние" пусто даже после открытия записи». Экран живёт
  // и вне оболочки (тесты, демо), поэтому доступ необязательный.
  const shell = useOptionalKitShell();
  // Личная настройка «Меню при чтении записи» наконец работает (S4-02,
  // находка CJM на проде 09.11.2026: атрибут `data-read-nav` писали и не
  // читал НИКТО, а в панели рядом стоял второй, тоже мёртвый блок про то же).
  // Меню убирается на ВРЕМЯ чтения — это действие экрана, не выбор человека:
  // kit такое состояние в хранилище не пишет и выбранную рейку не затирает
  // (S5-05 · D-2026-UXR-READ-COLLAPSE).
  const collapseOnRead = appliedCollapseNavOnRead();
  // Пока запись открыта и человек так выбрал — меню убрано. Возвращаем его,
  // когда запись закрыли или экран ушёл: оставить меню убранным после
  // закрытия значило бы менять выбор человека без его участия.
  const setCollapsed = shell?.setMenuCollapsed;
  useEffect(() => {
    if (!collapseOnRead || !setCollapsed) return;
    setCollapsed(!!open.id);
    return () => setCollapsed(false);
  }, [collapseOnRead, setCollapsed, open.id]);
  const baseConfig = useMemo(() => def.config(lang), [def, lang]);
  // Статусная ось раздела — ИЗ МОДЕЛИ (K-14 п. 4, S4-STATUS-AXIS-CONFIG).
  //
  // Перечень статусов в `lists/screens.ts` остаётся умолчанием: пока модель не
  // прочитана (или в ней нет цикла для типа), экран показывает его И ГОВОРИТ
  // об этом. Молчаливое умолчание — это ровно тот дефект, из-за которого в
  // меню статуса задачи были чужие статусы и два «В работе»: клиент показывал
  // свой список, уверенно и неправильно.
  const [modelStatuses, setModelStatuses] = useState<TypeStatuses | null>(null);
  const modelType = def.modelType;
  useEffect(() => {
    if (!modelType) { setModelStatuses(null); return; }
    let live = true;
    setModelStatuses(null);
    fetchTypeStatuses(modelType, fetchImpl ? { fetchImpl } : {}).then(
      r => { if (live) setModelStatuses(r); },
      // Ожидаемые отказы `fetchTypeStatuses` возвращает оговорками; сюда
      // попадаем, только если упал сам загрузчик — и это тоже надо сказать.
      e => { if (live) setModelStatuses({ items: [], notes: [`статусы — умолчание приложения: ${e instanceof Error ? e.message : String(e)}`] }); },
    );
    return () => { live = false; };
  }, [modelType, fetchImpl]);
  const modelCodes = useMemo(() => (modelStatuses?.items ?? []).map(s => s.code), [modelStatuses]);
  const config = useMemo(() => {
    const items = modelStatuses?.items ?? [];
    // S4-35 / ADR-LORE-049: показ колонок (приоритет, ширина, переполнение) —
    // из той же модели, что статусы. Нет в модели — колонки как раньше.
    const display = modelStatuses?.display;
    const withDisplay = display && baseConfig.list
      ? { ...baseConfig, list: { ...baseConfig.list, columnDisplay: display as NonNullable<NonNullable<typeof baseConfig.list>['columnDisplay']> } }
      : baseConfig;
    if (!items.length) return withDisplay;
    return { ...withDisplay, statuses: { ...withDisplay.statuses, items } };
  }, [baseConfig, modelStatuses]);
  // Дата календаря (K2-VIEW-CALENDAR): у раздела она названа явно; где дат
  // несколько (спринт: план и факт), выбор — в адресе (?lcd=).
  const calDates = def.calendarDates;
  const calField = calDates ? calendarField(calDates, calPicked) : '';
  const viewConfig = useMemo(() => (calField && config.list?.calendar && config.list.calendar.date !== calField
    ? { ...config, list: { ...config.list, calendar: { date: calField } } }
    : config), [config, calField]);
  // Выбор проектов в шапке наконец доходит до среза (S4-03, жалоба владелицы
  // 09.11.2026: «верхний фильтр по проектам не влияет на элементы внизу»).
  // Причина была не в фильтре: `useProjectScope()` не вызывал НИ ОДИН экран —
  // выбор доезжал до адреса `?proj=` и дальше никуда.
  const scope = useProjectScope();
  const scopeParam = useMemo(
    () => (scope.length ? { scope_projects: scope.join(',') } : undefined),
    [scope],
  );
  // Фильтр «Изменены» (K2-DATE-RANGE): только у разделов, где у записи есть
  // время (у кого есть лента — FEEDS); у прочих он недоступен с причиной.
  const hasTime = !!def.feed;
  const [range, setRange] = useChangedRange(urlWin);
  const tz = useMemo(browserZone, []);
  const rangeOn = hasTime && isDateRangeActive(range);
  // Диапазон уходит в срез, пока срез его не отверг (MT-MCP-CHANGED-RANGE).
  // «Сейчас» для быстрых периодов — последнее время источника, иначе часы браузера.
  const [sourceNow, setSourceNow] = useState<string | null>(null);
  const [rangeScope, setRangeScope] = useState<DateFilterScope>('source');
  const rangeParam = useMemo(
    () => (rangeOn && !rangeUnsupported(def.slice) ? changedParams(range, sourceNow ?? new Date().toISOString(), tz) : undefined),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rangeOn, JSON.stringify(range), def.slice, tz],
  );
  const rangeKey = rangeParam ? JSON.stringify(rangeParam) : '';
  // Закрытые — фильтр по умолчанию, а не срез (слово владелицы 11.11.2026).
  // У раздела со вторым срезом закрытых (closedSlice) режим «Показывать
  // закрытые» решает, грузить ли их: «скрыть» — только основной срез, иначе
  // догружается срез закрытых и сливается с открытыми.
  const [closedMode, setClosedMode] = useState<KitShowClosed>(() => {
    const lc = urlWin ? readUrlState(urlWin).get('lc') : null;
    return isShowClosed(lc) ? lc : showClosedOf({}, baseConfig);
  });
  // Список держит режим сам; снять фильтр снаружи (переход на запись вне его)
  // значит пересобрать список с новым режимом — ключ меняется ровно тогда.
  const [listKey, setListKey] = useState(0);
  const loadClosed = !!def.closedSlice && closedMode !== 'hide';
  const result = useLoadState(
    async signal => {
      const one = async (slice: string): Promise<SliceAnswer> => {
        if (!rangeParam) return fetchSlice(slice, scopeParam, { signal, fetchImpl });
        try {
          const b = await fetchSlice(slice, { ...scopeParam, ...rangeParam }, { signal, fetchImpl });
          setRangeScope('source');
          return b;
        } catch (e) {
          if (!isRangeRejected(e)) throw e;
          // Сервер диапазона не знает — честный откат: те же строки без него, отбор
          // по загруженному, и это сказано словами (kit: «по загруженному»).
          markRangeUnsupported(slice);
          setRangeScope('loaded');
          return fetchSlice(slice, scopeParam, { signal, fetchImpl });
        }
      };
      if (!loadClosed || !def.closedSlice) return one(def.slice);
      const [openBody, closedBody] = await Promise.all([one(def.slice), one(def.closedSlice)]);
      return mergeBodies(openBody, closedBody);
    },
    [def.slice, def.closedSlice, loadClosed, fetchImpl, scopeParam, rangeKey],
    { rows: body => body.rows },
  );
  const servedAt = result.data?.served_at;
  useEffect(() => { if (servedAt) setSourceNow(servedAt); }, [servedAt]);
  // Счётчики фасетов считает СЕРВЕР по всей выдаче (S9-01). Сам список умеет
  // считать только по загруженным строкам, а рядом стоит «Показано 1000 из
  // 4000» — и число у фасета читается как счёт по всей выдаче, хотя посчитано
  // по тысяче.
  //
  // Спрашиваем ровно те оси, по которым этот раздел и правда фильтрует:
  // неизвестная ось — это 400 BAD_PARAMS на ВЕСЬ запрос, то есть одна лишняя
  // ось лишила бы счётчиков все остальные. Чего в карте нет (например статус),
  // остаётся со счётом по строкам, и список говорит это словами сам.
  //
  // Выбор проектов уходит и сюда: иначе счётчики считали бы не ту выдачу,
  // которую человек видит, — ровно та жалоба, с которой начинался S4-03.
  const facetKeys = config.list?.filters ?? [];
  const facetKey = facetKeys.join(',');
  const facetAxes = useMemo(() => axesForKeys(facetKeys, def.slice), [facetKey, def.slice]); // eslint-disable-line react-hooks/exhaustive-deps
  const serverCounts = useListFacets(def.slice, {
    axes: facetAxes,
    scopeProjects: scope,
    fetchImpl,
    // Раздел, у которого нет ни одной известной оси, в сеть не ходит вовсе:
    // пустой запрос вернул бы отказ и подписал бы счётчики «не посчитали»
    // там, где спрашивать было нечего.
    enabled: Object.keys(facetAxes).length > 0,
  });
  const body = result.data;
  const data = useMemo(
    // «Сейчас» — время источника (заголовок Date), иначе часы браузера (K2-DATE-RANGE).
    // Статус строки сверяется с осью ТИПА из модели, а не с перечнем в коде
    // (S4-STATUS-AXIS-CONFIG, 11.11): ось доходила до конфига, но не до чтения строки.
    () => (body ? sliceToKitData(body, def.map, body.served_at ?? new Date().toISOString(), { statusCodes: modelCodes }) : null),
    [body, def, modelCodes],
  );
  // Переход на запись вне фильтра (слово владелицы 11.11.2026): открыта запись,
  // которой в загруженном нет, а закрытые скрыты, — фильтр снимается сам
  // (режим «внизу»), догружаются закрытые, и запись находится. Видна — не трогаем.
  const openId = open.id;
  useEffect(() => {
    if (!def.closedSlice || loadClosed || !openId || openId === NEW_RECORD_ID || !data) return;
    if (data.records.some(r => r.id === openId)) return;
    if (urlWin) pushUrlState({ lc: 'below' }, { replace: true, win: urlWin });
    setClosedMode('below');
    setListKey(k => k + 1);
  }, [def.closedSlice, loadClosed, openId, data, urlWin]);
  // Предупреждения выдачи плюс оговорка самого раздела (S4-V2-SECTIONS): где
  // срез по природе отдаёт НЕ ВСЁ, «Показано N из N» — правда про выдачу, но не
  // про корпус, и без слов человек решит, что остального у него нет.
  const warnings = [
    ...(def.note ? [def.note] : []),
    ...(def.closedNote && def.closedSlice && !loadClosed ? [def.closedNote] : []),
    ...(body ? sliceWarnings(body) : []),
    // Оговорки про ось статусов — там же, где прочие: человек должен видеть,
    // что список статусов взят не из модели, а из умолчания приложения.
    ...(modelStatuses?.notes ?? []),
  ];

  // Прогресс «x/y» (S4-09): догружается после списка; пока считается — «…»,
  // упавшая пачка — «?» с причиной (это решает loadProgress), а не 0/0.
  const ids = useMemo(() => data?.records.map(r => r.id) ?? [], [data]);

  // Цель палитры команд (S4-14): открытая запись, иначе выделение списка.
  // Записи может не быть в загруженных строках (открыли по ссылке) — тогда
  // цель несёт её код: действовать над записью можно и без названия.
  const [selection, setSelection] = useState<string[]>([]);
  useEffect(() => {
    if (open.id && open.id !== NEW_RECORD_ID) {
      const rec = data?.records.find(r => r.id === open.id)
        ?? { id: open.id, kind: PASSPORT_OF[screen] ?? screen, title: open.id, status: '', fields: {} };
      setPaletteTarget({ type: 'record', record: rec });
    } else {
      setPaletteTarget(selection.length > 0 ? { type: 'selection', ids: selection } : null);
    }
  }, [open.id, data, selection, screen]);
  // Экран ушёл — цель снимается: палитра не должна действовать над тем, чего
  // на экране уже нет.
  useEffect(() => () => setPaletteTarget(null), []);
  const [late, setLate] = useState<Map<string, Record<string, unknown>> | null>(null);
  useEffect(() => {
    if (!nested || !ids.length) return;
    const ctl = new AbortController();
    setLate(null);
    nested.load(client, ids, ctl.signal).then(
      m => { if (!ctl.signal.aborted) setLate(m); },
      () => { /* отмена: экран ушёл или список перезагрузился */ },
    );
    return () => ctl.abort();
  }, [nested, client, ids]);
  const shownData = useMemo(() => {
    if (!data || !nested) return data;
    // Пока значений нет — «…» в КАЖДОМ догружаемом поле, а не пустая ячейка:
    // «считаем» и «нечего показать» — разные утверждения (S4-09).
    const waiting: Record<string, unknown> = {};
    for (const f of nested.lateFields) waiting[f] = { loading: true };
    return {
      ...data,
      records: data.records.map(r => ({ ...r, fields: { ...r.fields, ...waiting, ...(late?.get(r.id) ?? {}) } })),
    };
  }, [data, nested, late]);

  // Лента (K2-FEED-VIEW): тело записи, нижний уровень и рёбра-поводы. Ничего
  // не грузится на всю ленту — паспорт и задачи спринта идут по раскрытию
  // одной записи (слово владелицы 10.11: «первые 3 абзаца, остальное при раскрытии»).
  const feed = useFeed({
    spec: def.feed, passportType: PASSPORT_OF[screen], rows: body?.rows,
    records: data?.records ?? NO_RECORDS, map: def.map, client, fetchImpl, t,
  });
  const viewData = useMemo(() => {
    const base = shownData ?? data;
    if (!base || feed.edges.length === 0) return base;
    return { ...base, edges: [...base.edges, ...feed.edges] };
  }, [shownData, data, feed.edges]);

  const headId = titleId ?? `list-screen-${screen}`;
  // Иконка заголовка — из канона LORE v1 (S4-25): def.icon = иконка раздела v1.
  // «+ Новая» (S4-24): только у типов с путём создания и только при праве
  // (perms.can_create паспорта `_new`). Не смогли спросить — кнопки нет:
  // кнопка, которая откажет после заполнения формы, хуже её отсутствия.
  const passportOf = PASSPORT_OF[screen];
  const createType = isCreateType(passportOf) ? passportOf : null;
  const [canCreate, setCanCreate] = useState(false);
  useEffect(() => {
    if (!createType) { setCanCreate(false); return; }
    let live = true;
    fetchCanCreate(createType, fetchImpl).then(r => { if (live) setCanCreate(r.can); });
    return () => { live = false; };
  }, [createType, fetchImpl]);
  const newAction = createType && canCreate ? (
    <button type="button" className="sk-btn sk-btn--primary" data-testid="list-new" title={t('create.newHint')}
      onClick={() => setOpen({ ...open, id: NEW_RECORD_ID })}>
      {t('create.new')}
    </button>
  ) : undefined;
  // Группы библиотеки — по загруженным записям раздела; считаются, только пока вид открыт.
  const libSpec = def.library;
  const libRecords = (viewData ?? data)?.records;
  const noGroupTitle = libSpec ? t(libSpec.noGroupKey) : '';
  const libGroups = useMemo(
    () => (libSpec && libraryOn && libRecords ? libraryGroups(libRecords, libSpec, config, noGroupTitle) : []),
    [libSpec, libraryOn, libRecords, config, noGroupTitle],
  );
  // Переключатель «Библиотека ⇄ Список» (K2-VIEW-LIBRARY): библиотека — не вид
  // движка списка kit, а соседний вид раздела, поэтому кнопка стоит в шапке
  // рядом с видами списка, а не в их radiogroup.
  const libraryToggle = def.library ? (
    <button type="button" className="sk-btn" data-testid="list-library" aria-pressed={libraryOn}
      onClick={() => setLibOn(!libraryOn)}>
      {t(libraryOn ? 'lists.library.back' : 'lists.library.view')}
    </button>
  ) : undefined;
  // Дата календаря названа словами раздела; где их несколько — выбор (K2-VIEW-CALENDAR).
  const calendarPicker = calDates && !libraryOn && listView === 'calendar' ? (
    <div className="list-screen__caldate" role="group" aria-label={t('lists.calendar.dateGroup')}>
      {calDates.map(d => (
        <button key={d.field} type="button" className="sk-pill sk-pill--filter" aria-pressed={d.field === calField}
          onClick={() => setCalPicked(d.field)}>
          {t(d.labelKey)}
        </button>
      ))}
    </div>
  ) : undefined;
  const actions = newAction || libraryToggle || calendarPicker
    ? <>{calendarPicker}{libraryToggle}{newAction}</>
    : undefined;
  const head = heading ? { title: t(def.titleKey), titleId: headId, icon: def.icon, ...(actions ? { actions } : {}) } : undefined;
  // Peek из списка (S9-10): пробел на строке — карточка записи; тип LORE = вид строки.
  const listPeek = useMemo(
    () => loreListPeek(lang, id => (viewData ?? data)?.records.find(r => r.id === id)?.kind ?? null, fetchImpl),
    [lang, viewData, data, fetchImpl],
  );
  const ready = !(result.state === 'loading' || result.state === 'error' || result.state === 'forbidden' || !data);

  let content;
  if (result.state === 'loading' || (!data && result.state !== 'error' && result.state !== 'forbidden')) {
    content = <Skeleton lines={6} label={t('lists.loading')} />;
  } else if (result.state === 'forbidden') {
    content = <Forbidden reason={body?.outside_scope?.reason ?? (result.error instanceof Error ? result.error.message : undefined)} />;
  } else if (result.state === 'error' || !data) {
    content = <LoadError error={result.error} onRetry={result.reload} />;
  } else if (libraryOn && def.library) {
    // «Библиотека» (K2-VIEW-LIBRARY): группы слева по полю раздела, справа —
    // паспорт записи на месте (у компонента — его ADR, спеки, задачи и
    // технологии); на телефоне kit открывает чтение нижним листом.
    const libType = PASSPORT_OF[screen];
    content = (
      <>
        {head ? <ScreenHead {...head} /> : actions && <div className="list-screen__actions">{actions}</div>}
        <LibraryView
          groups={libGroups}
          selected={lib.doc ?? undefined}
          onSelect={setLibDoc}
          href={urlWin ? id => urlStateHref(urlWin, { open: id, [LIBRARY_PARAM]: null, [LIBRARY_OPEN_PARAM]: null }, { anchor: null }) : undefined}
          renderBody={libType ? doc => (
            <Suspense fallback={<Skeleton lines={8} label={t('pp.loading')} />}>
              <ListPassport key={doc.id} type={libType} id={doc.id} placement="right" fetchImpl={fetchImpl} win={urlWin} />
            </Suspense>
          ) : undefined}
        />
      </>
    );
  } else {
    content = (
      <ListView
        config={viewConfig}
        data={viewData ?? data}
        // Счётчики источника считаны БЕЗ диапазона дат — при диапазоне им не
        // место: kit считает по загруженному и говорит это (S9-01).
        // Слиты открытые и закрытые — счётчики источника (по основному срезу) уже
        // не про эту выдачу: kit считает по загруженному и говорит это.
        counts={rangeOn || loadClosed ? undefined : serverCounts}
        dateFilter={{
          field: DATE_FIELD,
          title: t('lists.date.changed'),
          value: range,
          onChange: setRange,
          scope: rangeOn && rangeParam && rangeScope === 'source' ? 'source' : 'loaded',
          timeZone: tz,
          ...(hasTime ? {} : { unavailable: t('lists.date.noTime') }),
        }}
        feedBody={feed.feedBody}
        onFeedBody={feed.onFeedBody}
        feedUnder={feed.feedUnder}
        onFeedUnder={feed.onFeedUnder}
        urlState={urlState}
        quickIcons={def.quickIcons}
        // Свежие сверху по умолчанию (D-2026-UXR-LISTS-DEFAULT-SORT-FRESHNESS): это
        // умолчание — `ls` в адресе (явный выбор или применённый вид) kit ставит поверх.
        initial={def.defaultSort || listKey ? { ...(def.defaultSort ? { sort: def.defaultSort } : {}), ...(listKey ? { closed: closedMode } : {}) } : undefined}
        key={listKey}
        onStateChange={s => {
          setListView(s.view);
          if (def.closedSlice) setClosedMode(showClosedOf(s, config));
        }}
        // Иконки значений (S4-25, выбор владелицы): релиз — книга, компонент —
        // шестерёнка, проект — замок, P0 — пламя. Были написаны в loreFilters и
        // НЕ передавались: человек их не видел ни в фильтре, ни в ячейке.
        valueIcon={loreValueIcon}
        // Закреплённые значения фасета (S9-03): текущие релизы приходят с сервера
        // тем же ответом /facets, что и счётчики, — отдельного запроса нет.
        facetPinned={key => serverCounts?.pinned?.[key] ?? NO_PINNED}
        // S4-25: иконки видов — выбор владелицы (lucide из v1), из общего словаря kit.
        viewIcons={{ list: ICON_CANON.viewList, board: ICON_CANON.viewBoard }}
        head={head}
        // Личная ширина колонок (S4-35, «ширина личная, набор командный»):
        // ключ раздела свой у каждого списка, хранилище — общее v2 с откатом
        // в память (приватный режим ширину просто не запомнит).
        widths={{ screen: screen, store: appStorage }}
        expand={nested ? { render: r => nested.render(r.id, client) } : undefined}
        peek={listPeek}
        onOpen={id => {
          setOpen({ ...open, id });
          // Название — из загруженных строк, адрес — тот же, что в адресной
          // строке сейчас: «Недавнее» становится рабочей ссылкой, а не кодом.
          shell?.openRecord(id, {
            title: data?.records.find(r => r.id === id)?.title,
            href: recordHrefOf(urlState, id),
          });
        }}
        recordPlace={{ value: open.place, onChange: place => setOpen({ ...open, place }) }}
        onSelectionChange={setSelection}
      />
    );
  }

  if (open.id && ready) {
    const place = open.place;
    const passportType = PASSPORT_OF[screen];
    content = (
      // Место паспорта — настройка в «Вид» списка; «Закрыть» — кнопка дока (владелица 08.11).
      // modal={false} внутри оболочки: «во весь экран» накрывает область
      // содержимого, шапка и меню остаются видимыми и рабочими (замечание
      // владелицы по v1.17.4), поэтому aria-modal был бы ложью.
      <RecordDock placement={place} modal={shell == null}
        onExitFull={() => setOpen({ ...open, place: 'bottom' })} onClose={() => setOpen({ ...open, id: null })} backdrop={content}>
        {open.id === NEW_RECORD_ID && createType ? (
          // Черновик новой — в ТОМ ЖЕ доке и месте, что запись; сохранили — в
          // доке открывается сама запись (то, что открывает «Читать целиком»).
          <Suspense fallback={<Skeleton lines={8} label={t('pp.loading')} />}>
            <RecordCreate type={createType} fetchImpl={fetchImpl}
              onCreated={id => { setOpen({ ...open, id }); result.reload(); }}
              onCancel={() => setOpen({ ...open, id: null })} />
          </Suspense>
        ) : passportType ? (
          <Suspense fallback={<Skeleton lines={8} label={t('pp.loading')} />}>
            <ListPassport key={open.id} type={passportType} id={open.id} placement={place} fetchImpl={fetchImpl}
              backLabel={t(def.titleKey)} backHref={backHref} onBack={() => setOpen({ ...open, id: null })}
              ids={ids} onGo={id => setOpen({ ...open, id })}
              onFull={place === 'full' ? undefined : () => setOpen({ ...open, place: 'full' })} win={urlWin} />
          </Suspense>
        ) : (
          // Паспорта у типа нет — это говорится словами и на месте щелчка, а не
          // прячется: пустой паспорт выглядел бы как потерянные данные.
          <NoPassport id={open.id} section={t(def.titleKey)} onBack={() => setOpen({ ...open, id: null })} />
        )}
      </RecordDock>
    );
  }

  return (
    <section className={open.id && ready ? 'list-screen list-screen--passport' : 'list-screen'} data-screen={screen} aria-labelledby={heading && !titleId ? headId : undefined}>
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
