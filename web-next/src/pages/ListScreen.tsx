// Экран списка v2 — спринты / ADR (SPRINT_UXR_S4_UI_SHELL_LISTS/S4-04).
// Данные — реальный слайс LORE через клиент v2 (api/loreClient), состояния —
// хук kit (useLoadState): loading → скелет, 403 → «нет прав», сбой → ошибка с
// причиной и «Повторить». Пустоту и «обрезано» рисует сам движок списка kit
// по meta (проверенный ноль ≠ «фильтр отсеял» ≠ «обрезано сервером»).
import { RecordModelNotes as ModelNotes } from '@seidr/kit';
import { useChildRows } from '../lists/useChildRows';
import { buildExpand, childScreenOf } from '../lists/nestedExpand';
import { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { lazyChunk } from '../shell/staleChunk';
import {
  Forbidden, ICON_CANON, ListView, LoadError, NO_DATE_RANGE, ScreenHead, Skeleton, dateRangeUrlPatch,
  isDateRangeActive, isShowClosed, pushUrlState, readDateRangeUrl, readUrlState, showClosedOf, urlStateHref,
  useOptionalKitShell,
  useKitLang, useLoadState,
  DEFAULT_LIST_STATE, LIST_URL_KEYS, ViewsBar, queryToListState, writeListState,
} from '@seidr/kit';
import type { ListState } from '@seidr/kit';
import { LORE_VIEW_SECTIONS } from '../views/loreViews';
import { createLoreViewApi } from '../views/loreViewsApi';
import { getJson } from '../admin/actions';
import { adminDenied, type WhoamiBody } from '../admin/WhoamiBar';
import type { DateFilterScope, DateRangeValue, KitConfig, KitRecord, KitShowClosed, ListViewKind, RecordPlacement, UrlWindow } from '@seidr/kit';
import { ListWithRecord, useRecordOpen } from '@seidr/kit';
import { CALENDAR_DATE_PARAM, LIBRARY_OPEN_PARAM, LIBRARY_PARAM, calendarField, libraryGroups } from '../lists/library';
import { useFeed } from '../lists/useFeed';
import { fetchSlice } from '../api/loreClient';
import {
  DATE_FIELD, DATE_URL_PARAM, changedParams, isRangeRejected, markRangeUnsupported, rangeUnsupported,
} from '../lists/dateRange';
import { axesForKeys } from '../api/loreFacets';
import { useListFacets } from '../api/useListFacets';
import { useAppT } from '../i18n';
import { LIST_SCREENS, withListContract, type ListScreenDef, type ListScreenId } from '../lists/screens';
import { createLoreClient, defaultLoreClient } from '../sprints/loreClient';
import { storage as appStorage } from '../storage/safe';
import { sliceToKitData, sliceWarnings } from '../lists/records';
import { loreValueIcon } from '../lists/loreFilters';
import { paintRecords, productIndex, productValueIcon, withProductColumn, type ProductIndex } from '../lists/productPaint';
import { appliedCollapseNavOnRead, appliedPassportPlace } from '../settings/applied';
import { NEW_RECORD_ID, fetchCanCreate, isCreateType, type CreateLink, type CreateType } from '../record/recordCreate';
import { useProjectScope } from '../scope/ProjectScope';
import { useProductScope } from '../scope/ProductScope';
import { fetchTypeStatuses, type TypeStatuses } from '../record/passportStatuses';
import { setPaletteTarget } from '../palette/paletteTarget';
import type { PassportType } from '../record/passportAdapters';
import { PASSPORT_IN_SECTION } from '../nav/loreRoutes';
import { loreListPeek } from '../record/lorePeek';
import { useChartLayer, VolvaChart, VOLVA_VIEW_ICON, useVolvaSprintsLabels } from '../sprints/volvaChart';
import { browserZone } from '../time/browserZone';
import { newsRefHrefV2 } from '../news/newsLinks';
import { SECTION_CHARTS } from '../charts/sectionCharts';
import type { ListAppView } from '@seidr/kit';
import './ListScreen.css';

// Паспорт из живого списка (просьба владелицы 08.11: «подключить паспорта как есть»):
// до этого заголовок строки вёл в никуда (href по умолчанию «#id»). Свой чанк — MD-элементы.
const ListPassport = lazyChunk(() => import('../record/ListPassport'));
// Паспорт записи в ленте (BP-01-FULL-PASSPORT-FEED): тот же источник и компоненты, свой чанк.
const FeedPassport = lazyChunk(() => import('../record/FeedPassport'));
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
  // S5-DOC-PASSPORT: документ правится (тело ru/en, вид, файл, родитель) — путь записи /lore/doc.
  docs: 'doc',
  users: 'user',
  agents: 'agent',
  // Появились 09.11 вместе с типами фасада (#988, #991). Четыре — только на
  // чтение; «только чтение» приходит в `perms`, клиент это не предполагает.
  decisions: 'decision', questions: 'question', milestones: 'milestone', releases: 'release', prs: 'pr',
  // Появились 10.11 (серверный PR #1090), тоже только на чтение. Технология
  // открывается по spec_id: путь /lore/record/tech/<SPEC-TECH-…>, обычная
  // спека по этому пути даёт 404 — то есть тип выбирает раздел, а не ключ.
  components: 'component', tech: 'tech', features: 'feature',
  // S4-29 (53а): паспорт проекта (только чтение).
  projects: 'project',
  // S4-PRODUCTS-NODE: паспорт продукта (только чтение).
  products: 'product',
  // SPRINT_LORE_MODEL_DOCS_TIDY/MD-04: роли, боли, выгоды и работы пришли в v2 раньше паспорта —
  // теперь у каждого свой паспорт (только чтение); ранбук — раздел и паспорт.
  actors: 'actor', pains: 'pain', gains: 'gain', jobs: 'job', runbooks: 'runbook', quality_gates: 'quality_gate',
  // D-2026-MIG-REPOSITORY-ORGANIZATION: паспорта репозитория и организации (только чтение).
  repositories: 'repository', organizations: 'organization',
};
const NO_RECORDS: readonly KitRecord[] = [];
const NO_PINNED: readonly string[] = [];
/** kind — вид открытой записи, если он не вид экрана (PU-29: задача, открытая из вложенной таблицы спринта). */

/**
 * PU-29: вид паспорта открытой записи. Вид назван в адресе (?okind=) — паспорт этого вида
 * (задача в «Спринтах»); не назван или неизвестен — паспорт вида экрана, а не пустота.
 */
export function passportTypeFor(screen: ListScreenId, okind: string | null | undefined): PassportType | undefined {
  // Известные виды — те, у которых в приложении есть паспорт (значения PASSPORT_OF):
  // список типов из passportAdapters сюда не тянем — он живёт в ленивом чанке паспорта.
  if (okind && (Object.values(PASSPORT_OF) as string[]).includes(okind)) return okind as PassportType;
  // MDL-13: паспорт без своего раздела-списка (трек) — в разделе-хозяине по ?okind= (PASSPORT_IN_SECTION).
  if (okind && PASSPORT_IN_SECTION[okind] && PASSPORT_IN_SECTION[okind] === PASSPORT_OF[screen]) return okind as PassportType;
  return PASSPORT_OF[screen];
}
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
export function NoPassport({ id, section, onBack }: { id: string; section: string; onBack: () => void }) {
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

/**
 * Открытая запись и место — в URL (?open=&place=), как всё состояние v2; urlState=false — в памяти.
 * Правила адреса (D-21, D-24, аудит 08.11) — в kit: useRecordOpen (K5-LIST-WITH-RECORD).
 */
function useOpenRecord(urlState: ListScreenProps['urlState']) {
  const win: UrlWindow | undefined = urlState === false ? undefined
    : typeof urlState === 'object' ? urlState
      : typeof window === 'undefined' ? undefined : window;
  const r = useRecordOpen({ win, defaultPlace });
  return [r.open, r.setOpen, r.backHref, r.win] as const;
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
 * Вид «Библиотека» в адресе (K2-VIEW-LIBRARY, MP2-12): `?lib=1` — вход в вид
 * (legacy-ссылки продолжают работать), `?libo=<id>` — читаемая запись. Сам
 * вид теперь ВИД движка списка kit (`lv=library`): экран переводит `lib=1`
 * в состояние вида при загрузке и держит `lib` синхронным с выбранным видом,
 * чтобы старые ссылки и «назад» вели себя прежним образом. Выбор записи — заменой.
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
  return [lib, setOn] as const;
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
  /** Свой экран приложения (lists/screens.ts). Нет — экран типа модели: modelType + modelDef (KREG-13). */
  screen?: ListScreenId;
  /**
   * KREG-13 (владелец 26.11.2026: «сделай, чтобы мы всё же модель использовали, а не она валялась отдельно»):
   * тип модели без своего экрана — описание экрана собрано из контракта модели (surfaces.list), паспорт — общий.
   */
  modelType?: string;
  modelDef?: ListScreenDef;
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
  /** Экран открыт в админке: разделы «управление — только в админке» правятся здесь (ListScreenDef.manageOnlyInAdmin). */
  manage?: boolean;
}

/** Можно ли на этом экране создавать и править: раздел «управление — в админке» правится только в ней. */
export function screenManaged(def: ListScreenDef, manage = false): boolean {
  return !def.manageOnlyInAdmin || manage;
}

/** Статусы и показ колонок типа из модели (K-14 п. 4); нет типа — null. */
function useModelStatuses(modelType: string | undefined, fetchImpl: typeof fetch | undefined): TypeStatuses | null {
  const [modelStatuses, setModelStatuses] = useState<TypeStatuses | null>(null);
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
  return modelStatuses;
}

/** Конфиг экрана поверх модели: ось статусов и показ колонок — из неё, если пришли. */
function withModelStatuses(baseConfig: KitConfig, modelStatuses: TypeStatuses | null): KitConfig {
  const items = modelStatuses?.items ?? [];
  // S4-35 / ADR-LORE-049: показ колонок (приоритет, ширина, переполнение) —
  // из той же модели, что статусы. Нет в модели — колонки как раньше.
  const display = modelStatuses?.display;
  const withDisplay = display && baseConfig.list
    ? { ...baseConfig, list: { ...baseConfig.list, columnDisplay: display as NonNullable<NonNullable<typeof baseConfig.list>['columnDisplay']> } }
    : baseConfig;
  if (!items.length) return withDisplay;
  return { ...withDisplay, statuses: { ...withDisplay.statuses, items } };
}

export function ListScreen({ screen: ownScreen, modelType, modelDef, fetchImpl, urlState, heading = true, titleId, manage = false }: ListScreenProps) {
  // KREG-13: ключ экрана — свой экран приложения или тип модели; карты по экранам для типа модели пусты (undefined).
  const screen = (ownScreen ?? modelType ?? "") as ListScreenId;
  const baseDef: ListScreenDef = modelDef ?? LIST_SCREENS[screen];
  const passportOfScreen: string | undefined = modelType ?? PASSPORT_OF[screen];
  const passportTypeOf = (kind: string | null | undefined): string | undefined => (modelType ? modelType : passportTypeFor(screen, kind));
  // Статусная ось раздела — ИЗ МОДЕЛИ (K-14 п. 4, S4-STATUS-AXIS-CONFIG).
  //
  // Перечень статусов в `lists/screens.ts` остаётся умолчанием: пока модель не
  // прочитана (или в ней нет цикла для типа), экран показывает его И ГОВОРИТ
  // об этом. Молчаливое умолчание — это ровно тот дефект, из-за которого в
  // меню статуса задачи были чужие статусы и два «В работе»: клиент показывал
  // свой список, уверенно и неправильно.
  const modelStatuses = useModelStatuses(baseDef.modelType, fetchImpl);
  // MC-09: срез раздела — из контракта модели (surfaces.list), свой — умолчание; тот же срез — тот же объект.
  const def = useMemo(() => withListContract(baseDef, modelStatuses?.list), [baseDef, modelStatuses]);
  const managed = screenManaged(def, manage);
  const nested = def.nested;
  // Клиент вложенного (прогресс, раскрытие, смена статуса) — тот же fetch, что у списка.
  const client = useMemo(() => (fetchImpl ? createLoreClient({ fetch: fetchImpl }) : defaultLoreClient), [fetchImpl]);
  // PU-23: дети раскрытой строки (если экран их объявил); как рисовать — правило lists/nestedExpand.
  const childLoad = useMemo(() => (nested?.children ? (parent: KitRecord, signal: AbortSignal) => nested.children!.load(client, parent, signal) : undefined), [nested, client]);
  const childRows = useChildRows(childLoad);
  const lang = useKitLang();
  const t = useAppT();
  const [open, setOpen, backHref, urlWin] = useOpenRecord(urlState);
  // «Библиотека» и «Календарь» (K2-VIEW-LIBRARY, K2-VIEW-CALENDAR): состояние — в адресе.
  const [lib] = useLibraryState(urlWin);
  // MP2-12: `?lib=1` на входе — начальный вид «Библиотека»; дальше видом
  // управляет движок списка (меню видов), а не отдельная кнопка.
  const libInitial = useRef(lib.on).current;
  const [calPicked, setCalPicked] = useCalendarDate(urlWin);
  // Вид движка списка — чтобы выбор даты календаря стоял только у календаря.
  // Узнаём его из onStateChange, а не из `lv` адреса: `lv=calendar` kit пока
  // не читает (readListState), и взятый из адреса вид разошёлся бы с экраном.
  const [listView, setListView] = useState<ListViewKind | null>(null);
  const libraryOn = !!def.library && (listView ?? (libInitial ? 'library' : null)) === 'library';
  // Адрес держим согласованным: вид «Библиотека» ⇔ `lib=1` (+ `lv=library`,
  // чтобы перезагрузка и «назад» возвращали тот же вид). Пишем заменой —
  // переключение вида не должно плодить шаги истории поверх шагов kit.
  useEffect(() => {
    if (!def.library || !urlWin) return;
    const p = readUrlState(urlWin);
    const patch: Record<string, string | null> = {};
    const wantLib = libraryOn ? '1' : null;
    if ((p.get(LIBRARY_PARAM) ?? null) !== wantLib) patch[LIBRARY_PARAM] = wantLib;
    if (libraryOn && !p.has('lv')) patch.lv = 'library';
    if (Object.keys(patch).length) pushUrlState(patch, { win: urlWin, replace: true });
  }, [libraryOn, def.library, urlWin]);
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
  // Убирается и возвращается меню — в kit (ListWithRecord, K5-LIST-WITH-RECORD).
  const collapseOnRead = appliedCollapseNavOnRead();
  const baseConfig = useMemo(() => def.config(lang), [def, lang]);
  const modelCodes = useMemo(() => (modelStatuses?.items ?? []).map(s => s.code), [modelStatuses]);
  // PU-23: экран дочернего типа (спринт → «Задачи») — его конфиг и статусы модели, как у его
  // собственного списка: вложенная таблица детей рисуется ими.
  const childScreen = childScreenOf(nested?.children?.kind);
  const childModel = useModelStatuses(childScreen ? (LIST_SCREENS[childScreen] as ListScreenDef).modelType : undefined, fetchImpl);
  const childConfig = useMemo(
    () => (childScreen ? withModelStatuses(LIST_SCREENS[childScreen].config(lang), childModel) : undefined),
    [childScreen, childModel, lang],
  );
  const expand = useMemo(() => (nested ? buildExpand({
    nested, client, childRows, lang,
    // PU-29: паспорт ребёнка — в ЭТОМ разделе (?open=<id>&okind=<вид>), левая часть остаётся двухуровневой.
    childHref: (kind: string, id: string) => (urlWin ? urlStateHref(urlWin, { open: id, okind: kind === passportOfScreen ? null : kind, place: null }, { anchor: null }) : undefined),
    childConfigOf: kind => (kind === nested.children?.kind && childConfig
      ? childConfig
      : (() => { const id = childScreenOf(kind); return id ? LIST_SCREENS[id].config(lang) : undefined; })()),
  }) : undefined), [nested, client, childRows, lang, childConfig, urlWin, screen]);
  // Цвет продукта (S4-PRODUCT-HILITE): одно правило на все разделы — продукты
  // записи и её компонентов из среза products, цвет из данных продукта. Не
  // загрузился срез — список работает без колонки, а причина сказана словами.
  const [paint, setPaint] = useState<{ idx: ProductIndex } | { error: string } | null>(null);
  useEffect(() => {
    let live = true;
    fetchSlice<Record<string, unknown>>('products', undefined, { fetchImpl }).then(
      b => { if (live) setPaint({ idx: productIndex(b.rows) }); },
      e => { if (live) setPaint({ error: e instanceof Error ? e.message : String(e) }); },
    );
    return () => { live = false; };
  }, [fetchImpl]);
  const paintIdx = paint && 'idx' in paint ? paint.idx : null;
  const ownConfig = useMemo(() => withModelStatuses(baseConfig, modelStatuses), [baseConfig, modelStatuses]);
  const config = useMemo(() => {
    const own = ownConfig;
    return paintIdx ? withProductColumn(own, t('lists.field.product')) : own;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ownConfig, paintIdx, lang]);
  const valueIcon = useMemo(() => {
    const productIcon = paintIdx ? productValueIcon(paintIdx) : null;
    return (key: string, value: string) => productIcon?.(key, value) ?? loreValueIcon(key, value);
  }, [paintIdx]);
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
  // PS-PRODUCT-FILTER (владелица 21.11.2026): верхний фильтр — по продукту; продукт раскрывает в проекты бэкенд.
  const products = useProductScope();
  const scopeParam = useMemo(() => {
    const p: Record<string, string> = {};
    if (scope.length) p.scope_projects = scope.join(',');
    if (products.length) p.scope_products = products.join(',');
    return Object.keys(p).length ? p : undefined;
  }, [scope, products]);
  // Встроенный график Völva (SPRINT_VIZ_EMBED/EMB-L2, D-2026-LORE-VIZ-EMBED-PLACES):
  // вид РЯДОМ с видами раздела, только при charts.layer=volva; иначе ничего не
  // меняется. Проект — из скоупа шапки; подпись — бэкенд LORE.
  const volvaLayer = useChartLayer(fetchImpl, !!def.volvaChart, def.volvaChart);
  const volvaLabels = useVolvaSprintsLabels();
  // Графики раздела — видом «Аналитика» (lav=analytics), а не над списком (владелица 21.11.2026: «что опять делает
  // тут график? у нас же должна быть вкладка аналитика или völva»). Нет графиков у раздела — нет и вида.
  const sectionCharts = SECTION_CHARTS[screen];
  const analyticsLabel = t('lists.view.analytics');
  const appViews = useMemo(() => {
    const out: ListAppView[] = [];
    if (sectionCharts) out.push({
      id: 'analytics',
      label: analyticsLabel,
      icon: ICON_CANON.recAnalytics,
      render: () => <div className="sk-rec-charts">{sectionCharts(fetchImpl ? { fetchImpl } : {})}</div>,
    });
    if (def.volvaChart && volvaLayer === 'volva') out.push({
      id: 'volva',
      label: volvaLabels.view,
      icon: VOLVA_VIEW_ICON,
      render: () => <VolvaChart chart={def.volvaChart!} title={volvaLabels.title} projects={scope} fetchImpl={fetchImpl} />,
    });
    return out.length ? out : undefined;
  }, [sectionCharts, analyticsLabel, def.volvaChart, volvaLayer, volvaLabels.view, volvaLabels.title, scope, fetchImpl]);
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
  // Сохранённые виды раздела (сервер — KnowSavedView, LoreMeResource; 20.11.2026: «чтобы все поля работали»).
  // Вид — строка состояния списка; применяется через адрес (lv/lq/lg/ls/lf…) и пересборку списка: список
  // сам читает адрес при монтировании. Ссылка «Поделиться» ведёт на сохранённый вид (vw), видимость решает
  // сервер (visibility / roles). Без адреса (встроенный список) панели видов нет — применить вид некуда.
  const viewSection = (LORE_VIEW_SECTIONS as readonly string[]).includes(screen) && urlWin ? screen : null;
  const viewStore = useMemo(
    // «свой» вид сервер помечает own — метка пользователя на клиенте лишь сравнивается, kc_sub не нужен
    () => (viewSection ? createLoreViewApi({ user: 'me', ...(fetchImpl ? { fetchImpl } : {}) }) : null),
    [viewSection, fetchImpl],
  );
  const [listState, setListState] = useState<ListState>(() => (urlWin ? { ...DEFAULT_LIST_STATE, ...queryToListState(readUrlState(urlWin).toString()) } : DEFAULT_LIST_STATE));
  const urlHasList = useRef(!!urlWin && LIST_URL_KEYS.some(k => readUrlState(urlWin).has(k))).current;
  const applyView = (s: ListState) => {
    if (!urlWin) return;
    pushUrlState(writeListState(s), { win: urlWin, replace: true });
    setListState(s);
    setListKey(k => k + 1);
  };
  // «Командный по умолчанию» предлагается только админу (сервер всё равно проверит сам: 403).
  const [canTeamDefault, setCanTeamDefault] = useState(false);
  useEffect(() => {
    if (!viewStore) return;
    let live = true;
    (getJson('/lore/whoami', { fetchImpl }) as Promise<WhoamiBody>).then(
      b => { if (live) setCanTeamDefault(!adminDenied(b)); },
      () => { if (live) setCanTeamDefault(false); },
    );
    return () => { live = false; };
  }, [viewStore, fetchImpl]);
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
    () => {
      if (!body) return null;
      const d = sliceToKitData(body, def.map, body.served_at ?? new Date().toISOString(), { statusCodes: modelCodes, lang });
      // S4-PRODUCT-HILITE: продукт записи — полем `product` (правило одно на все разделы).
      return paintIdx ? { ...d, records: paintRecords(d.records, paintIdx) } : d;
    },
    [body, def, modelCodes, paintIdx, lang],
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
    // Цвет продукта не загрузился — список без колонки «Продукт», и это сказано.
    ...(paint && 'error' in paint ? [t('lists.productPaint.failed', { reason: paint.error })] : []),
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
        ?? { id: open.id, kind: passportOfScreen ?? screen, title: open.id, status: '', fields: {} };
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
    nested.load(client, ids, ctl.signal, data?.records ?? []).then(
      m => { if (!ctl.signal.aborted) setLate(m); },
      () => { /* отмена: экран ушёл или список перезагрузился */ },
    );
    return () => ctl.abort();
    // records нужны загрузчику вехи (PU-27); ids — из тех же data, отдельной смены у них нет.
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
    spec: def.feed, passportType: passportOfScreen, rows: body?.rows,
    records: data?.records ?? NO_RECORDS, map: def.map, client, fetchImpl, t,
  });
  // Лента паспортов (SPRINT_LORE_BOARD_PASSPORTS/BP-01-FULL-PASSPORT-FEED, прототип принят
  // 25.11.2026): kit зовёт это только для ВИДИМЫХ записей — паспорт невидимой не грузится.
  // Раздел без паспорта — переключателя «Полные паспорта» нет: обещать нечего.
  const feedPassport = useMemo(() => {
    if (!passportOfScreen) return undefined;
    return (r: KitRecord) => {
      const type = passportTypeOf(r.kind) ?? passportOfScreen!;
      return (
        <Suspense fallback={<Skeleton lines={4} label={t('pp.loading')} />}>
          <FeedPassport type={type} id={r.id} fetchImpl={fetchImpl} />
        </Suspense>
      );
    };
  }, [screen, fetchImpl, t]);
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
  const passportOf = passportOfScreen;
  const createType = managed && isCreateType(passportOf) ? passportOf : null;
  const [canCreate, setCanCreate] = useState(false);
  useEffect(() => {
    if (!createType) { setCanCreate(false); return; }
    let live = true;
    fetchCanCreate(createType, fetchImpl).then(r => { if (live) setCanCreate(r.can); });
    return () => { live = false; };
  }, [createType, fetchImpl]);
  // AP-PASSPORT-EDIT (1б): «+ боль» из вкладки паспорта — черновик другого типа в том же доке; после записи
  // связь ставится сама, и док возвращается к паспорту-источнику (он перечитается).
  const [linkedCreate, setLinkedCreate] = useState<{ type: CreateType; link: CreateLink } | null>(null);
  // Ушли к другой записи — черновик «+ боль» остаётся у своей и не всплывает при возврате.
  useEffect(() => { setLinkedCreate(c => (c && c.link.id !== open.id ? null : c)); }, [open.id]);
  const newAction = createType && canCreate ? (
    <button type="button" className="sk-btn sk-btn--primary" data-testid="list-new" title={t('create.newHint')}
      onClick={() => setOpen({ ...open, id: NEW_RECORD_ID })}>
      {t('create.new')}
    </button>
  ) : undefined;
  // Группы библиотеки (MP2-12): считает движок списка по ОТФИЛЬТРОВАННЫМ
  // записям вида «Библиотека» — группы не расходятся с фильтрами списка.
  const libSpec = def.library;
  const noGroupTitle = libSpec ? t(libSpec.noGroupKey) : '';
  const libGroupsOf = useMemo(
    () => (recs: readonly KitRecord[]) => (libSpec ? libraryGroups(recs, libSpec, config, noGroupTitle) : []),
    [libSpec, config, noGroupTitle],
  );
  // K2-LIBRARY-DUP-PASSPORT, решение владелицы 14.11: «в библиотеке оставь только левую часть
  // меню, не дублируй второй раз компонент паспорта, а паспорт открывается обычно как для
  // таблицы». Своей читалки у вида нет: выбор в дереве — ?open= (то же, что щелчок по строке
  // списка), паспорт встаёт на своё место (?place=). На экране не больше одного паспорта.
  const libraryProp = libSpec ? {
    groups: libGroupsOf,
    selected: open.id ?? undefined,
    onSelect: (id: string) => setOpen({ ...open, id }),
    reader: false,
  } : undefined;
  // Старые ссылки ?libo=<id> (читалка до 14.11) открывают тот же паспорт через ?open=.
  const legacyLibDoc = useRef(lib.doc).current;
  useEffect(() => {
    if (!legacyLibDoc || !urlWin) return;
    pushUrlState({ [LIBRARY_OPEN_PARAM]: null }, { win: urlWin, replace: true });
    if (!open.id) setOpen({ ...open, id: legacyLibDoc });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [legacyLibDoc, urlWin]);
  // Дата календаря названа словами раздела; где их несколько — выбор (K2-VIEW-CALENDAR).
  const calendarPicker = calDates && listView === 'calendar' ? (
    <div className="list-screen__caldate" role="group" aria-label={t('lists.calendar.dateGroup')}>
      {calDates.map(d => (
        <button key={d.field} type="button" className="sk-pill sk-pill--filter" aria-pressed={d.field === calField}
          onClick={() => setCalPicked(d.field)}>
          {t(d.labelKey)}
        </button>
      ))}
    </div>
  ) : undefined;
  const actions = newAction || calendarPicker
    ? <>{calendarPicker}{newAction}</>
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
  } else {
    content = (
      <ListView
        config={viewConfig}
        // поле-ссылка (спринт, компонент, проект …) ведёт к своей записи (владелица 18.11.2026)
        refHref={({ id, type }) => (type ? newsRefHrefV2(type, id) : null)}
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
        feedPassport={feedPassport}
        urlState={urlState}
        quickIcons={def.quickIcons}
        // Свежие сверху по умолчанию (D-2026-UXR-LISTS-DEFAULT-SORT-FRESHNESS): это
        // умолчание — `ls` в адресе (явный выбор или применённый вид) kit ставит поверх.
        initial={{
          // MP2-12: legacy-вход `?lib=1` — начальный вид «Библиотека».
          ...(libInitial && libSpec ? { view: 'library' as ListViewKind } : {}),
          ...(def.defaultSort ? { sort: def.defaultSort } : {}),
          // Группировка по умолчанию (репозитории — по проекту, прототип 19.11); `lg` в адресе главнее.
          ...(def.defaultGroup ? { group: def.defaultGroup } : {}),
          ...(listKey ? { closed: closedMode } : {}),
        }}
        library={libraryProp}
        key={listKey}
        onStateChange={s => {
          setListView(s.view);
          setListState(s);
          if (def.closedSlice) setClosedMode(showClosedOf(s, config));
        }}
        // Иконки значений (S4-25, выбор владелицы): релиз — книга, компонент —
        // шестерёнка, проект — замок, P0 — пламя. Были написаны в loreFilters и
        // НЕ передавались: человек их не видел ни в фильтре, ни в ячейке.
        valueIcon={valueIcon}
        // Закреплённые значения фасета (S9-03): текущие релизы приходят с сервера
        // тем же ответом /facets, что и счётчики, — отдельного запроса нет.
        facetPinned={key => serverCounts?.pinned?.[key] ?? NO_PINNED}
        // S4-25: иконки видов — выбор владелицы (lucide из v1), из общего словаря kit.
        viewIcons={{ list: ICON_CANON.viewList, board: ICON_CANON.viewBoard }}
        head={head}
        appViews={appViews}
        // Личная ширина колонок (S4-35, «ширина личная, набор командный»):
        // ключ раздела свой у каждого списка, хранилище — общее v2 с откатом
        // в память (приватный режим ширину просто не запомнит).
        widths={{ screen: screen, store: appStorage }}
        // PU-23: дети другого типа — вложенная таблица своего экрана, того же — строки этой таблицы.
        expand={expand}
        peek={listPeek}
        onOpen={id => {
          setOpen({ ...open, id, kind: null });
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

  // Список остаётся, запись — в доке справа, снизу или во весь экран: раскладка и её правила в kit
  // (ListWithRecord, K5-LIST-WITH-RECORD), здесь — только чем рисовать запись LORE.
  // modal={false} внутри оболочки: «во весь экран» накрывает область содержимого, шапка и меню
  // остаются видимыми и рабочими (замечание владелицы по v1.17.4), поэтому aria-modal был бы ложью.
  const passportType = open.id ? passportTypeOf(open.kind) : undefined;
  content = (
    <ListWithRecord list={content} open={open} onOpen={setOpen} ready={ready} modal={shell == null} controls="bar"
      collapseNavOnRead={collapseOnRead} defaultPlace={defaultPlace()}
      record={slot => (linkedCreate && slot.id === linkedCreate.link.id ? (
        <Suspense fallback={<Skeleton lines={8} label={t('pp.loading')} />}>
          <RecordCreate key={`${linkedCreate.type}:${linkedCreate.link.rel}`} type={linkedCreate.type} link={linkedCreate.link} fetchImpl={fetchImpl}
            onCreated={() => setLinkedCreate(null)} onCancel={() => setLinkedCreate(null)} />
        </Suspense>
      ) : slot.id === NEW_RECORD_ID && createType ? (
        // Черновик новой — в ТОМ ЖЕ доке и месте, что запись; сохранили — в
        // доке открывается сама запись (то, что открывает «Читать целиком»).
        <Suspense fallback={<Skeleton lines={8} label={t('pp.loading')} />}>
          <RecordCreate type={createType} fetchImpl={fetchImpl}
            onCreated={id => { slot.go(id); result.reload(); }}
            onCancel={slot.close} />
        </Suspense>
      ) : passportType ? (
        <Suspense fallback={<Skeleton lines={8} label={t('pp.loading')} />}>
          <ListPassport key={slot.id} type={passportType} id={slot.id} placement={slot.place} fetchImpl={fetchImpl}
            backLabel={t(def.titleKey)} backHref={backHref} onBack={slot.close}
            ids={ids} onGo={slot.go}
            onFull={slot.full} win={urlWin} backPlace={slot.backPlace}
            // MP2-11: место меняет экран — и состояние, и адрес одним путём (setOpen пишет ?place=).
            onPlace={slot.setPlace}
            readOnly={!managed}
            onCreateLinked={managed ? setLinkedCreate : undefined}
            onClose={slot.close} />
        </Suspense>
      ) : (
        // Паспорта у типа нет — это говорится словами и на месте щелчка, а не
        // прячется: пустой паспорт выглядел бы как потерянные данные.
        <NoPassport id={slot.id} section={t(def.titleKey)} onBack={slot.close} />
      ))} />
  );

  return (
    <section className={open.id && ready ? 'list-screen list-screen--passport' : 'list-screen'} data-screen={screen} aria-labelledby={heading && !titleId ? headId : undefined}>
      {/* Пока списка нет (загрузка, ошибка, нет прав) — та же шапка без видов: заголовок не прыгает. */}
      {head && !ready && <ScreenHead {...head} />}
      {warnings.length > 0 && (
        <ul className="list-screen__warn" aria-label={t('lists.warnings')}>
          {warnings.map(w => <li key={w}>{w}</li>)}
        </ul>
      )}
      {/* MP2-08 (владелица 13.11): оговорки модели (статусы взяты из умолчания, у статуса нет цвета)
          — техническое сообщение, его место под значком тех. сведений, как в паспорте, а не полосой
          над списком. Полоса выше — про ВЫДАЧУ (обрезано, закрытые скрыты), она остаётся на месте. */}
      <ModelNotes notes={modelStatuses?.notes ?? []} />
      {viewStore && viewSection && (
        <ViewsBar store={viewStore} section={viewSection} user="me" state={listState} onApply={applyView}
          win={urlWin} applyStartView={!urlHasList} canTeamDefault={canTeamDefault} />
      )}
      {content}
    </section>
  );
}

export default ListScreen;
