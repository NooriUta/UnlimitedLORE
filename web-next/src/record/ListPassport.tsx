// Паспорт записи, открытый из живого списка v2 (просьба владелицы 08.11: «подключить паспорта
// как есть, дальше улучшим»). Тот же путь, что у демо /kit/passport (S4-33): слайсы →
// loadPassport → toLoreRecord (lore.record/1) → fromLoreRecord → RecordView.
// S4-CONTENT-V4 (прототип v4): над записью — строка RecordReader: крошки «← Раздел / ID»,
// листалка по списку и «⤢». Свой ушко «Свойства» RecordReader НЕ включаем (aside нет):
// свойства во весь экран — рейка и свёртка самого RecordView (сессия kit, #914).
// Свой чанк: MartProse и граф тянут MD-элементы, список за них не платит.
import { RecordNotFound } from '../api/liveRecord';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  RecordCrumbs, RecordPager, RecordReader, RecordScreen, pushUrlState,
  useKitLang, useLoadState, useRecordTab,
  HISTORY_QUERY_ALL, RecordPlace, type KitConfig, type KitCtx, type KitHistoryQuery, type KitLang, type PassportOrder, type RecordPlacement, type UrlWindow, useUrlParam } from '@seidr/kit';
import { MartProse, type LiveBlocks } from '@seidr/kit/content';
import { appT } from '../i18n';
import { loreRefHref, loreRefLook, mdEditorWithRefs } from './loreMdRefs';
import { parentsOf } from './loreRefCreate';
import { fetchLoreGraph, graphNotes, mergeGraph, relsOf, topUpOpen, LORE_GRAPH_TYPES, type LoreGraphBody } from './loreGraph';
import { loreListPeek, loreRefPeek } from './lorePeek';
import { appliedPeekHover } from '../settings/applied';
import { fetchSlice } from '../api/loreClient';
import { passportHref } from './passportHref';
import { SprintTasksPanel } from '../sprint/SprintTasksPanel';
import { ProjectExportButton } from './ProjectExportButton';
import { MilestoneBurnLine } from '../milestone/MilestoneBurnLine';
import { PrHeadLine } from './PrHeadLine';
import { MilestoneCharts, SprintCharts } from '../charts/TaskFlowCharts';
import { GateCharts, ProjectCharts } from '../charts/Batch2Charts';
import { withSprintTasksTab } from './sprintTasksTab';
import { withDocHtmlTab } from './docHtmlTab';
import { withUserFeedTab } from './userFeedTab';
import { AgentHeadLine } from './AgentHeadLine';
import { UserCharts } from '../charts/UserCharts';
import { useAppT } from '../i18n';
import { type PassportType } from './passportAdapters';
import { fromLoreRecord, optionsFromSlice, withFieldOptions, type OptionState } from './loreRecordContract';
import { toDictItems, type DictApiRow } from '../sprint/taskDicts';
import { loadRecordContract } from './recordSource';
import { savePassportField } from './passportSave';
import { saveMerging, type MdFieldState as FieldState } from '@seidr/kit/content';
import { fetchLoreRecord } from '../api/liveRecord';
import { saveRelation } from './relationSave';
import { relationOptionsHook } from './relationOptions';
import { saveRecordStatus, statusEntity } from './statusSave';
import { fetchPassportOrder } from './passportOrder';
import { fetchTypeStatuses } from './passportStatuses';
import { appliedRightColumn } from '../settings/applied';
import './ListPassport.css';
import { loreQueryRun } from './loreQueryBlock';
import { loreGraphRun } from './loreGraphBlock';
import { createDraftsApi, draftSlot } from '../api/drafts';
import { HISTORY_PAGE, HISTORY_TRACKED, HistoryForbidden, NOT_TRACKED, fetchHistory, historyQueryOpts } from './historySource';

const esc = (s: string) => s.replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);
/** Чтение тела: ссылка ведёт в паспорт (MD-READ-PEEK), наведение/тап — карточка Peek (S9-10). */
function ProseWithPeek({ text, type, id }: { text: string; type: string; id: string }) {
  const lang = useKitLang();
  const blocks = blocksFor(type, id, lang);
  // Выключатель «Карточки по наведению» (настройки) читается из применённого атрибута.
  const peek = useMemo(() => loreRefPeek(lang, { enabled: appliedPeekHover() }), [lang]);
  const look = useMemo(() => loreRefLook(lang), [lang]);
  return <MartProse text={text} refHref={loreRefHref} refLook={look} refPeek={peek} blocks={blocks} />;
}

// S6-04: живые блоки lore-query и lore-graph в теле записи; $this.id / $this.type — эта запись.
// Исполнитель — один на запись (кеш), иначе блок перезапрашивал бы данные на каждой перерисовке.
const BLOCKS = new Map<string, LiveBlocks>();
function blocksFor(type: string, id: string, lang: KitLang): LiveBlocks {
  const k = `${type}|${id}|${lang}`;
  let b = BLOCKS.get(k);
  if (!b) {
    const vars = { 'this.id': id, 'this.type': type };
    // lore-graph — общим графом kit (GraphExplorer) по серверному /lore/graph.
    b = { 'lore-query': loreQueryRun(vars), 'lore-graph': loreGraphRun(vars, undefined, lang) };
    BLOCKS.set(k, b);
  }
  return b;
}
const mdFor = (type: string, id: string) => (s: string) => <ProseWithPeek text={s} type={type} id={id} />;

export interface ListPassportProps {
  type: PassportType;
  id: string;
  placement: RecordPlacement;
  fetchImpl?: typeof fetch;
  /** Подпись раздела списка для крошек «← Спринты». */
  backLabel?: string;
  /** Крошки «←» — вернуться к списку (закрыть паспорт). */
  onBack?: () => void;
  /**
   * Адрес списка без открытой записи: крошка становится ссылкой — её можно
   * открыть в новой вкладке и скопировать (находка P1 аудита 08.11: «крошка —
   * кнопка, не ссылка»). Нет адреса — остаётся кнопка, поддельную ссылку не
   * рисуем.
   */
  backHref?: string;
  /** id записей списка в порядке показа — для листалки. */
  ids?: readonly string[];
  /** Перейти к соседней записи листалкой. */
  onGo?: (id: string) => void;
  /** «⤢» — развернуть на весь экран; нет — кнопки нет (уже во весь экран). */
  onFull?: () => void;
  /** MP2-11: куда ⤢ возвращает из полного экрана — место, из которого вошли. */
  backPlace?: RecordPlacement;
  /**
   * Закрыть паспорт — «×» в строке записи сразу после ☰ (владелица 14.11.2026: «крестик поставь за меню —
   * строка станет одной»). Док тогда своей полосы не рисует (RecordDock controls="bar").
   */
  onClose?: () => void;
  /**
   * Только чтение, что бы ни разрешал сервер: правки полей и связей нет (организации в пользовательском меню —
   * управление в админке, решение владелицы 19.11.2026).
   */
  readOnly?: boolean;
  /**
   * Смена места паспорта (MP2-11): меню «право / низ / полный». Экран может
   * задать свой обработчик; без него место пишется в адрес (?place=), где его
   * и читает список, — адрес остаётся одной правдой о месте записи.
   */
  onPlace?: (place: RecordPlacement) => void;
  /**
   * Окно, в котором список держит состояние в адресе (D-21).
   *
   * Нужно, чтобы вкладка записи жила в ТОМ ЖЕ адресе, что `open` и `place`:
   * паспорт не выбирает себе окно сам, иначе в тестах и в песочнице он писал
   * бы в другое, и вкладка не доходила бы (так и поймали это у палитры).
   */
  win?: UrlWindow;
}

export default function ListPassport({ type, id, placement, fetchImpl, backLabel, backHref, onBack, ids = [], onGo, onFull, onPlace, win, backPlace, onClose, readOnly = false }: ListPassportProps) {
  const t = useAppT();
  const lang = useKitLang();
  // Вкладка живёт в адресе (D-21): ссылкой на «Связи» или «Историю» можно
  // поделиться, «назад» возвращает прежнюю вкладку. Хук kit уже это умел и
  // до сих пор не вызывался ниоткуда — паспорт держал вкладку местным
  // состоянием, и адрес о ней не знал.
  //
  // Умолчание — ПУСТО, то есть «не выбрана» (S4-MOBILE-COMPARE): что открыть,
  // решает kit — на десктопе обзор, как прежде, на телефоне первую вкладку по
  // модели (у спринта задачи, как в v1). Подставленный здесь 'overview' kit
  // принял бы за выбор человека.
  const [tab, setTab] = useRecordTab('', win);
  // Личная настройка «Правая колонка записи» наконец доходит до записи
  // (S4-02, находка CJM на проде 09.11.2026). Раньше выбор ложился атрибутом
  // `data-right-column` на корень документа, и этот атрибут не читал НИКТО:
  // настройка сохранялась и не меняла ничего, а рядом в панели стоял второй,
  // тоже мёртвый блок про то же. `auto` — выбора не было, решает сам паспорт.
  const rightColumn = appliedRightColumn();
  // Порядок разделов из модели (S4-29). Пока грузится — умолчание приложения,
  // и это honest-состояние: экран работает, просто порядок пока клиентский.
  const [order, setOrder] = useState<{ order: PassportOrder; notes: string[] }>({ order: { decided: false, sections: [], notes: [] }, notes: [] });
  useEffect(() => {
    let alive = true;
    fetchPassportOrder(type, { fetchImpl }).then(r => { if (alive) setOrder(r); }, () => { /* сказано в notes */ });
    return () => { alive = false; };
  }, [type, fetchImpl]);
  // Цикл статусов ТИПА из модели (S4-STATUS-AXIS-CONFIG). Жалоба владелицы на
  // проде: в меню статуса задачи «В работе» дважды и чужие статусы — потому
  // что список собирался из внутренней таблицы kit, то есть из всех осей
  // разом. Теперь спрашиваем цикл этого типа; модель не ответила — остаётся
  // умолчание приложения, и это сказано словами в той же строке замечаний.
  const [statuses, setStatuses] = useState<{ items: KitConfig['statuses']['items']; notes: string[]; byKind?: Record<string, KitConfig['statuses']['items']> }>({ items: [], notes: [] });
  useEffect(() => {
    let alive = true;
    fetchTypeStatuses(type, { fetchImpl }).then(r => { if (alive) setStatuses(r); }, () => { /* сказано в notes */ });
    return () => { alive = false; };
  }, [type, fetchImpl]);
  const slice = useMemo(() => <T,>(name: string, params?: Record<string, string>) => fetchSlice<T>(name, params, { fetchImpl }), [fetchImpl]);
  const drafts = useMemo(() => createDraftsApi(fetchImpl), [fetchImpl]);
  // Вкладка «История» (S5-11) была в kit, но в v2 её никто не подключал:
  // RecordView.history нигде не передавался. Тип вне таблицы SCD2 — это
  // «история не ведётся», и сервер мы о нём не спрашиваем.
  // Листание истории (S9-09): растим предел и перечитываем страницу. Растить,
  // а не склеивать куски: сервер отдаёт историю одной выборкой с page, и
  // склейка на клиенте разошлась бы с ней при чужой правке посреди листания.
  const [histLimit, setHistLimit] = useState(HISTORY_PAGE);
  // Фильтры и свёртка правок агента (S9-09): kit рисует их, только когда экран
  // их применяет (onQuery). Сужает и сворачивает СЕРВЕР — страница и счёт честны.
  const [histQuery, setHistQuery] = useState<KitHistoryQuery>(HISTORY_QUERY_ALL);
  const histOpts = historyQueryOpts(histQuery);
  const histKey = JSON.stringify(histOpts);
  const hist = useLoadState(
    () => (HISTORY_TRACKED.has(type)
      ? fetchHistory(type, id, { limit: histLimit, ...histOpts }, fetchImpl)
      : Promise.resolve(NOT_TRACKED)),
    [type, id, fetchImpl, histLimit, histKey],
  );
  // Источник паспорта — боевой фасад /lore/record (S4-MODEL-PASSPORT-LIST).
  // Вместе с ним приходит `record.version` (без неё нет защиты от затирания,
  // S5-08), настоящие `perms` и состояние блоков. Фасад не ответил — паспорт
  // собирается из срезов, и причина НАЗВАНА строкой в состоянии данных:
  // молчаливый откат выглядел бы настоящим паспортом без версии.
  const pp = useLoadState(
    () => loadRecordContract(type, id, lang, slice, { fetchImpl }),
    [type, id, lang, slice, fetchImpl],
  );
  const contract = pp.data ?? null;
  // S4-24: цель связи — выбором из среза её типа, а не вводом кода. Хук держим
  // стабильным: выбор перезапрашивает варианты, когда меняется его ссылка.
  const relationOptions = useMemo(() => relationOptionsHook(contract?.schema.relations ?? [], (name, params) => slice<Record<string, unknown>>(name, params)), [contract, slice]);
  const view = useMemo(() => (contract ? fromLoreRecord(contract, lang) : null), [contract, lang]);
  // S5-08: после 409 запись перечитана, а паспорт ещё нет (перечитать его — значит
  // снять поле правки вместе с решаемым спором). Новая база и версия поля живут
  // здесь, пока паспорт показывает ту версию, с которой их перечитали.
  const rebased = useRef(new Map<string, FieldState & { readVersion: string | null }>());
  // Редактор MD с карточкой «Новый», знающий родителей этой записи (MD-WINDOW).
  const parentsKey = JSON.stringify(parentsOf(view?.record));
  // S6-04: живые блоки исполняются и в правимом поле (раньше там оставались кодом).
  const mdEditor = useMemo(() => mdEditorWithRefs(JSON.parse(parentsKey) as Record<string, string>, l => blocksFor(type, id, l), { type, id }), [parentsKey, type, id]);
  // Граф (GC-04): вкладка «Граф» берёт окрестность записи с сервера на глубину из адреса —
  // фасад давал один шаг. Ошибка — строкой блока графа, а не пустым графом.
  // Глубина 1–4 и снятые типы связей (goff) — из адреса. Владелица 11.11: «показать связи
  // определённого типа, связи 2, 3, 4 уровней» — снятый тип исключается из ОБХОДА на сервере
  // (rels = все типы окрестности минус снятые), а не только прячется на экране.
  const [gdepthRaw] = useUrlParam('gdepth');
  const gdepth = gdepthRaw === '2' || gdepthRaw === '3' || gdepthRaw === '4' ? Number(gdepthRaw) : 1;
  const [goffRaw] = useUrlParam('goff');
  const goff = (goffRaw ?? '').split(',').filter(Boolean).sort().join(',');
  const [graph, setGraph] = useState<{ key: string; body?: LoreGraphBody; error?: string } | null>(null);
  // Все типы связей окрестности по записи и глубине — из ответа без фильтра (rels_available
  // его не учитывает; у старого сервера — счёт рёбер полного ответа).
  const graphRels = useRef(new Map<string, { rel: string; count: number }[]>());
  const graphBase = view && tab === 'graph' ? `${type}|${view.record.id}|${gdepth}` : null;
  const graphKey = graphBase ? `${graphBase}|${goff}` : null;
  useEffect(() => {
    if (!graphKey || !graphBase || !view) return;
    let alive = true;
    const off = goff ? goff.split(',') : [];
    const q = { type, id: view.record.id, depth: gdepth };
    const known = graphRels.current.get(graphBase);
    const all = known
      ? Promise.resolve(known)
      : fetchLoreGraph(q, fetchImpl).then(body => {
        const rels = relsOf(body);
        graphRels.current.set(graphBase, rels);
        if (alive && !off.length) setGraph({ key: graphKey, body });
        return rels;
      });
    all.then(rels => {
      if (!off.length) return known ? fetchLoreGraph(q, fetchImpl) : null;
      const on = rels.map(r => r.rel).filter(r => !off.includes(r));
      // Сняты все типы — обходить нечего: только сама запись, без запроса.
      if (!on.length) return { nodes: [], edges: [], meta: { complete: true, truncated: false } } as LoreGraphBody;
      return fetchLoreGraph({ ...q, rels: on }, fetchImpl);
    }).then(body => { if (alive && body) setGraph({ key: graphKey, body }); },
      e => { if (alive) setGraph({ key: graphKey, error: e instanceof Error ? e.message : String(e) }); });
    return () => { alive = false; };
  }, [graphKey]); // eslint-disable-line react-hooks/exhaustive-deps
  // S9-08 (препрод 14.11): раскрытый кластер (gopen) при выдаче, упёршейся в потолок сервера, —
  // его тип догружается обходом строго по нему, а не остаётся обрезком.
  const [gopenRaw] = useUrlParam('gopen');
  const gopen = (gopenRaw ?? '').split(',').filter(Boolean).sort().join(',');
  const [topUp, setTopUp] = useState<{ key: string; body: LoreGraphBody } | null>(null);
  const graphBody = graph && graph.key === graphKey ? graph.body : undefined;
  const topUpKey = graphKey && graphBody?.meta.truncated && gopen ? `${graphKey}|${gopen}` : null;
  useEffect(() => {
    if (!topUpKey || !graphBody || !view) return;
    let alive = true;
    topUpOpen(graphBody, gopen.split(','), { type, id: view.record.id, depth: gdepth }, fetchImpl)
      .then(body => { if (alive) setTopUp({ key: topUpKey, body }); }, () => { /* догрузка не вышла — кластер остаётся «не меньше» */ });
    return () => { alive = false; };
  }, [topUpKey, graphBody]); // eslint-disable-line react-hooks/exhaustive-deps
  // Правка характеристик (S4-24): варианты enum-полей — из справочников сервера
  // (срез dictionary по dict_type поля схемы). Справочник не пришёл — поле не
  // правится (выбирать не из чего), а не показывает пустой список.
  const dictKeys = useMemo(() => [...new Set((contract?.schema.fields ?? [])
    .filter(f => f.kind === 'enum' && f.editable && f.write && f.dict).map(f => f.dict as string))].sort().join(','), [contract]);
  const [dicts, setDicts] = useState<Record<string, { code: string; title: string }[]>>({});
  useEffect(() => {
    if (!dictKeys) return;
    let alive = true;
    for (const key of dictKeys.split(',')) {
      slice<DictApiRow>('dictionary', { dict_type: key }).then(
        body => {
          const rows = body?.rows ?? [];
          if (alive) setDicts(prev => ({ ...prev, [key]: toDictItems(rows, lang) }));
        },
        () => { /* справочник не пришёл — enum остаётся только для чтения */ },
      );
    }
    return () => { alive = false; };
  }, [dictKeys, slice, lang]);
  // S4-24 (#1241): варианты enum из среза сервера (автор/исполнитель/принимающий — task_identities).
  // Не прочитались — поле говорит причину и даёт «Повторить», свободного ввода нет.
  const optFields = (contract?.schema.fields ?? []).filter(f => f.kind === 'enum' && f.editable && f.write && !f.dict && f.options);
  const optKey = optFields.map(f => `${f.key}:${f.options!.slice}`).join(',');
  const [optSeq, setOptSeq] = useState(0);
  const [sliceOpts, setSliceOpts] = useState<Record<string, OptionState>>({});
  useEffect(() => {
    if (!optKey) return;
    let alive = true;
    for (const f of optFields) {
      const spec = f.options!;
      slice<Record<string, unknown>>(spec.slice, spec.param ? { [spec.param]: id } : undefined).then(
        body => { if (alive) setSliceOpts(prev => ({ ...prev, [f.key]: { items: optionsFromSlice(body?.rows ?? [], spec, g => t(g === 'agent' ? 'pp.opt.agents' : g === 'person' ? 'pp.opt.people' : 'pp.opt.other')) } })); },
        e => { if (alive) setSliceOpts(prev => ({ ...prev, [f.key]: { error: e instanceof Error ? e.message : String(e), retry: () => setOptSeq(n => n + 1) } })); },
      );
    }
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [optKey, id, slice, optSeq]);
  // MP2-11: место паспорта — одна правда в адресе (?place=). Меню «право /
  // низ / полный» пишет его явно (в том числе «право»: снятый параметр
  // вернулся бы к личной настройке, а не к выбранному месту). Экран списка
  // читает адрес по popstate/hashchange; pushState события не шлёт, поэтому
  // оповещаем тем же событием, каким браузер сообщает о «назад/вперёд».
  const setPlace = (p: RecordPlacement) => {
    if (onPlace) { onPlace(p); return; }
    if (win) {
      pushUrlState({ place: p }, { replace: true, win });
      if (typeof window !== 'undefined' && (win as unknown) === window) window.dispatchEvent(new PopStateEvent('popstate'));
      return;
    }
    if (p === 'full') onFull?.();
  };
  // MP2-09/MP2-10: строка над паспортом есть В ЛЮБОМ состоянии — загрузка,
  // сбой, чтение. Прежде при загрузке и сбое её не было, и паспорт прыгал
  // высотой и шириной между состояниями; теперь бар один и тот же.
  const barCrumbs = backLabel ? <RecordCrumbs back={{ label: backLabel, href: backHref, onClick: onBack }} current={view?.record.id ?? id} /> : undefined;
  const barPager = onGo && ids.length > 0 ? <RecordPager ids={ids} current={view?.record.id ?? id} onGo={onGo} hotkeys={placement === 'full'} /> : undefined;
  const barTools = (
    <>
      <RecordPlace value={placement} onPlace={setPlace} back={backPlace} />
      {onClose && (
        <button type="button" className="sk-iconbtn sk-place__btn" onClick={onClose}
          aria-label={t('pp.close')} title={`${t('pp.close')} (Esc)`}>×</button>
      )}
    </>
  );
  // Дерево состояний ОДИНАКОВОЕ сверху: сборщик → оговорки → бар → тело.
  // Бар стоит на одном и том же месте во всех трёх ветках, поэтому React
  // сохраняет его узлы (и фокус, и раскрытое меню) при переходе
  // загрузка → чтение → сбой: строка не пересобирается и не «скачет».
  // Рамка экрана — в kit (RecordScreen, K5-PASSPORT-FROM-MODEL шаг 4): сборщик предупреждений,
  // оговорки модели, полоса и состояние под ней; здесь — только что считать «записи нет».
  const screenBar = { crumbs: barCrumbs, pager: barPager, tools: barTools };
  const screenNotes = [...order.notes, ...statuses.notes];
  if (pp.state === 'error') {
    return (
      <RecordScreen bar={screenBar} notes={screenNotes}
        state={pp.error instanceof RecordNotFound ? { kind: 'notFound', id } : { kind: 'error', error: pp.error, onRetry: pp.reload }} />
    );
  }
  if (!view) return <RecordScreen bar={screenBar} notes={screenNotes} state={{ kind: 'loading' }} />;
  // Правка на месте (S4-24, ADR-LORE-047 п. 14.1): сохраняем существующим путём записи и перечитываем
  // паспорт с сервера — показываем записанное, а не то, что набрали.
  const onSave = async ({ field, from, to }: { field: string; from?: unknown; to: unknown }) => {
    // СТАТУС сохраняется СВОИМ путём — у него на сервере отдельный эндпоинт
    // (`POST /lore/status`), и он единственный, кто двигает SCD2 состояния.
    //
    // Эта ветка — исправление дефекта, замеченного владелицей 09.11 («не могу
    // поменять статус адр через новый редиз»). Корень был не на сервере: он
    // смену статуса ADR принимает давно. `saveRecordStatus` я написал в тот же
    // день, покрыл тестами и НЕ ПОДКЛЮЧИЛ — греп показал вызовы только из его
    // собственного теста. То есть чип стал нажимаемым (права приходят фасадом,
    // `perms.can_status`), а сохранять было нечем, и это молчало.
    //
    // Следствие было шире жалобы: статус не менялся НИ У ОДНОГО типа, просто
    // первым это понадобилось на ADR.
    if (field === 'status') {
      await saveRecordStatus({
        type: statusEntity(type),
        id: view.record.id,
        // «Было» — ровно то, что показано человеку: сервер сверит и откажет
        // 409-м, если статус успели изменить, вместо тихой перезаписи.
        to: String(to),
        was: contract?.record.status ?? null,
      }, fetchImpl);
      pp.reload();
      return;
    }
    // Версия на момент ЧТЕНИЯ записи (S5-08): сервер сверит её и откажет
    // 409-м, если запись успели изменить. Без неё сохранение затирало чужую
    // правку молча. У ADR проверки на сервере нет — там версия не уходит, и
    // С PR #969 проверку принимают все четыре типа, включая ADR.
    // Путь записи РАЗДЕЛА берём из схемы сервера (`write`), а не из своей
    // таблицы «тип → поле»: у спринта разделов два («Контекст» и «Итог»), у
    // ADR три, и таблица по одному имени на тип молча не записала бы
    // остальные (замечание серверной сессии 09.11 по его же реестру).
    const def = contract?.schema.fields.find(f => f.key === field);
    const readVersion = contract?.record.version ?? null;
    const saveAs = (text: unknown, version: string | null) => savePassportField(
      type, { id: view.record.id, title: view.record.title }, field, text, fetchImpl,
      version, def?.write ?? null,
    );
    // Текст (MD) — со слиянием по блокам при 409 (S5-08): правки разных блоков
    // сливаются сами, спорные блоки показывает поле правки построчным диффом.
    // Остальные поля (дата, число, имя) — одно значение, сливать в них нечего:
    // 409 доходит словами «перечитайте».
    const isText = typeof to === 'string' && (def?.kind === 'md' || field === 'body_md' || field.endsWith('_md'));
    if (isText) {
      const key = field;
      const known = rebased.current.get(key);
      const live = known && known.readVersion === readVersion ? known : null;
      await saveMerging({
        base: live ? live.text : typeof from === 'string' ? from : String(contract?.values[field] ?? ''),
        mine: to,
        version: live ? live.version : readVersion,
        save: saveAs,
        reread: async () => {
          const fresh = await fetchLoreRecord(type, view.record.id, { fetchImpl });
          const v = fresh.values[field];
          return { text: typeof v === 'string' ? v : '', version: fresh.record.version ?? null };
        },
        rebase: fresh => { rebased.current.set(key, { ...fresh, readVersion }); },
      });
      rebased.current.delete(key);
    } else {
      await saveAs(to, readVersion);
    }
    pp.reload();
  };
  // Привязка и отвязка связей (S4-MODEL-PASSPORT-LIST): управление в kit было
  // написано, но хук ему никто не давал — форма привязки просто не рисовалась.
  // Какими связями управлять можно, решает сервер (`manageable` из фасада), а
  // не вид UML: путь привязки есть не у всех. Отказ доходит словами — kit
  // печатает причину рядом с управлением.
  // MDL-13: у связи с обязательной причиной kit сперва спрашивает её (ReasonDialog) — причина идёт тем же путём.
  const onRelation = async ({ rel, dir, target, action, reason }: { rel: string; dir: 'out' | 'in'; target: string; action: 'add' | 'remove'; reason?: string }) => {
    await saveRelation({ type, id: view.record.id, rel, dir, target, action, ...(reason !== undefined ? { reason } : {}) }, fetchImpl);
    pp.reload();
  };
  // Спринт: вкладка «Задачи» — дерево спринт → [фаза] → задача (S4-TREE-NESTED,
  // решение владелицы 10.11) из того же ответа /lore/record, и вторым видом —
  // прежняя таблица задач (группировка, правка, массовый статус) со строкой сгорания.
  const sprintConfig = type === 'sprint' && contract
    ? withSprintTasksTab(view.config, view.record.kind, t('sprintTasks.title'), () => (
      <SprintTasksPanel contract={contract} onStatusSaved={pp.reload} fetchImpl={fetchImpl} win={win} />
    ))
    : view.config;
  // Документ: HTML-тело (content_html) — отдельной вкладкой «HTML», рендер только в песочнице (MDL-08 ч.2).
  const docConfig = type === 'doc' ? withDocHtmlTab(sprintConfig, view.record.kind, t('docHtml.tab'), contract?.values.content_html) : sprintConfig;
  // AP-PEOPLE-PAGE: личная страница человека — вкладка «Лента» (новости с фильтром по автору, ось who = kc_sub).
  const baseConfig = type === 'user' ? withUserFeedTab(docConfig, view.record.kind, t('userFeed.tab'), view.record.id) : docConfig;
  const dictOf = (key: string) => contract?.schema.fields.find(f => f.key === key)?.dict;
  const withOptions = withFieldOptions(baseConfig, view.record.kind, dicts, dictOf, sliceOpts);
  const g = graph && graph.key === graphKey ? graph : null;
  const graphData = g?.body
    ? (() => { const d = mergeGraph(view.data, topUp && topUp.key === topUpKey ? topUp.body : g.body); return { ...d, meta: { ...d.meta, graphRels: (graphBase && graphRels.current.get(graphBase)) || d.meta.graphRels, graphNotes: graphNotes(g.body.meta, lang) } }; })()
    : g?.error
      ? { ...view.data, meta: { ...view.data.meta, graphNotes: [`${appT(lang, 'pp.graphFailed')}: ${g.error}`] } }
      : view.data;
  const graphPeek = loreListPeek(lang, id => view.data.records.find(r => r.id === id)?.kind ?? null);
  const ctx: KitCtx = { config: {
    ...withOptions,
    // Цикл статусов из модели ГЛАВНЕЕ умолчания приложения: умолчание —
    // внутренняя таблица kit со всеми осями сразу, из-за неё в меню задачи и
    // были чужие статусы и два «В работе». Пусто — модель не ответила, и
    // причина уже названа в строке замечаний.
    // Меню смены статуса — цикл своего типа (items); строки других типов — их цикл (byKind).
    statuses: { ...baseConfig.statuses, ...(statuses.items.length ? { items: statuses.items } : {}), ...(statuses.byKind ? { byKind: statuses.byKind } : {}) },
    hooks: readOnly ? { ...baseConfig.hooks } : { ...baseConfig.hooks, onSave, onRelation, relationOptions },
    // Граф (GC-03): выбранный узел — карточка Peek этой записи, та же, что в списке и в тексте.
    graph: baseConfig.graph ? { ...baseConfig.graph, peek: graphPeek.render, types: LORE_GRAPH_TYPES(lang) } : baseConfig.graph,
  }, data: graphData, role: 'reader',
    // Связи, граф, таблица связей — ссылки по коду из загруженных записей через loreRoutes
    // (S4-13): «#код» вёл никуда (приёмка на проде 09.11). Тип неизвестен — якорь, как раньше.
    // Чипы проектов и компонентов шапки — паспорт своего типа (S4-29, 53а): тип берётся из
    // поля, в котором чип пришёл; раньше чип вёл на «#код».
    href: passportHref(view.data.records, contract?.values ?? {}, x => '#' + encodeURIComponent(x)), esc, md: mdFor(type, id) };
  return (
    // MP2-08: один сборщик технических сообщений на экран — оговорки модели
    // (рядом с паспортом) и состояние данных (внутри паспорта) попадают в
    // один значок «⚠ N» в строке над записью, а не полосами в компоновке.
    // Оговорки модели (S4-29, MP2-08) и полоса над записью (MP2-09/10) — рамкой kit RecordScreen:
    // тот же узел, что в ветках загрузки и сбоя.
    <RecordScreen bar={screenBar} notes={screenNotes} state={{ kind: 'ready' }}>
      {/* PU-27: у вехи — сгорание по задачам её спринтов (строка BURN-DOWN и
          «Цель к сроку»), той же строкой, что у спринта; срок — «Когда» вехи. */}
      {/* MDA-04: у git-проекта — выгрузка в папку .md (Obsidian) zip-архивом. */}
      {/* MD-05: шапка PR — ветки и вид, «не влит», плашка «заголовок не дотянут» (прототип md05-pr-passport). */}
      {type === 'pr' && contract && <PrHeadLine values={contract.values} />}
      {/* AP-PEOPLE-PAGE: карточка агента вне админки — значок harness, профиль, машина и «чей он» ссылкой на владельца. */}
      {type === 'agent' && contract && <AgentHeadLine values={contract.values} links={contract.links} {...(fetchImpl ? { fetchImpl } : {})} />}
      {type === 'project' && <ProjectExportButton slug={view.record.id} {...(fetchImpl ? { fetchImpl } : {})} />}
      {type === 'milestone' && (
        <MilestoneBurnLine
          milestoneId={view.record.id}
          fetchImpl={fetchImpl}
          {...(typeof contract?.values.date === 'string' ? { when: contract.values.date } : {})}
        />
      )}
    <RecordReader record={view.record} ctx={ctx} tab={tab} onTab={setTab} facts={view.facts} mdEditor={mdEditor}
      // Графики (19.11, пачки 1–2): веха — прогноз и поток (+ Velocity и Burnup по спринтам вехи, #1632); спринт —
      // поток и время цикла; проект — возраст открытых задач и ритм релизов; гейт — доля пройденных. Владелица
      // 21.11: «графики встают над header а не отдельной вкладкой аналитика — перенеси во вкладку аналитика» →
      // слот kit `charts`: вкладка «Графики» первой в режиме «Аналитика».
      charts={passportCharts(type, view.record.id, fetchImpl)}
      // Порядок и места разделов — данными модели (S4-29): «задачи первыми,
      // потом контент, зависимости в конце контента, редкое под Ещё».
      sections={order.order}
      // Черновик правки — на сервере (S5-09): «Восстановить черновик от
      // ЧЧ:ММ» и автосохранение. Версия записи теперь приходит фасадом
      // (строкой), и `base_version` черновика — та же строка (PR #964),
      // поэтому пометка «запись изменили после черновика» наконец работает:
      // раньше версии в паспорте не было вовсе, и помечать было нечем.
      mdDrafts={field => draftSlot({ api: drafts, type, id: view.record.id, field, version: contract?.record.version ?? null })}
      history={{
        // «Не прочитали» и «запрещено» — разные состояния, и оба не «пусто».
        // useLoadState различает «пусто» и «частично» — вкладке истории эти
        // оттенки не нужны: версий ноль она покажет сама, а предупреждения
        // приходят в warnings ответа. Поэтому и empty, и partial — это 'ok'.
        state: hist.state === 'error'
          ? (hist.error instanceof HistoryForbidden ? 'forbidden' : 'error')
          : hist.state === 'loading' ? 'loading' : 'ok',
        data: hist.data,
        error: hist.error,
        onRetry: hist.reload,
        // «Показать ещё» есть только пока сервер говорит, что дальше есть.
        onMore: hist.data?.page?.has_more ? () => setHistLimit(n => n + HISTORY_PAGE) : undefined,
        loadingMore: hist.state === 'loading' && histLimit > HISTORY_PAGE,
        query: histQuery,
        // Новый запрос — с первой страницы: старый предел относился к другой выборке.
        onQuery: q => { setHistQuery(q); setHistLimit(HISTORY_PAGE); },
      }}
      placement={placement} loadedAt={contract?.meta.loaded_at} onReload={pp.reload}
      className="list-passport"
      asideOpen={false} onAside={() => {}}
      {...(rightColumn === 'auto' ? {} : { defaultPropsOpen: rightColumn === 'open' })} />
    </RecordScreen>
  );
}

/** Графики паспорта по типу записи — вкладкой «Графики» в «Аналитике» (владелица 21.11.2026); у прочих типов нет. */
export function passportCharts(type: string, id: string, fetchImpl?: typeof fetch): ReactNode | undefined {
  const f = fetchImpl ? { fetchImpl } : {};
  if (type === 'milestone') return <MilestoneCharts milestoneId={id} {...f} />;
  if (type === 'sprint') return <SprintCharts sprintId={id} {...f} />;
  if (type === 'project') return <ProjectCharts slug={id} {...f} />;
  if (type === 'quality_gate') return <GateCharts qgId={id} {...f} />;
  // AP-PEOPLE-PAGE: личная страница человека — закрыто по неделям, задачи по статусам и по проектам.
  if (type === 'user') return <UserCharts kcSub={id} {...f} />;
  return undefined;
}
