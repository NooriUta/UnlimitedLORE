// Паспорт записи, открытый из живого списка v2 (просьба владелицы 08.11: «подключить паспорта
// как есть, дальше улучшим»). Тот же путь, что у демо /kit/passport (S4-33): слайсы →
// loadPassport → toLoreRecord (lore.record/1) → fromLoreRecord → RecordView.
// S4-CONTENT-V4 (прототип v4): над записью — строка RecordReader: крошки «← Раздел / ID»,
// листалка по списку и «⤢». Свой ушко «Свойства» RecordReader НЕ включаем (aside нет):
// свойства во весь экран — рейка и свёртка самого RecordView (сессия kit, #914).
// Свой чанк: MartProse и граф тянут MD-элементы, список за них не платит.
import { useEffect, useMemo, useState } from 'react';
import {
  LoadError, RecordCrumbs, RecordPager, RecordReader, Skeleton, useKitLang, useLoadState, useRecordTab,
  type KitConfig, type KitCtx, type PassportOrder, type RecordPlacement, type UrlWindow,
} from '@seidr/kit';
import { MartProse, MdInlineEdit } from '@seidr/kit/content';
import { fetchSlice } from '../api/loreClient';
import { passportHref } from './passportHref';
import { SprintTasksPanel } from '../sprint/SprintTasksPanel';
import { withSprintTasksTab } from './sprintTasksTab';
import { useAppT } from '../i18n';
import { type PassportType } from './passportAdapters';
import { fromLoreRecord } from './loreRecordContract';
import { loadRecordContract } from './recordSource';
import { savePassportField } from './passportSave';
import { saveRelation } from './relationSave';
import { saveRecordStatus, statusEntity } from './statusSave';
import { fetchPassportOrder } from './passportOrder';
import { fetchTypeStatuses } from './passportStatuses';
import { appliedRightColumn } from '../settings/applied';
import './ListPassport.css';
import { ModelNotes } from './ModelNotes';
import { createDraftsApi, draftSlot } from '../api/drafts';
import { HISTORY_PAGE, HISTORY_TRACKED, HistoryForbidden, NOT_TRACKED, fetchHistory } from './historySource';

const esc = (s: string) => s.replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);
const md = (s: string) => <MartProse text={s} />;

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
  /**
   * Окно, в котором список держит состояние в адресе (D-21).
   *
   * Нужно, чтобы вкладка записи жила в ТОМ ЖЕ адресе, что `open` и `place`:
   * паспорт не выбирает себе окно сам, иначе в тестах и в песочнице он писал
   * бы в другое, и вкладка не доходила бы (так и поймали это у палитры).
   */
  win?: UrlWindow;
}

export default function ListPassport({ type, id, placement, fetchImpl, backLabel, backHref, onBack, ids = [], onGo, onFull, win }: ListPassportProps) {
  const t = useAppT();
  const lang = useKitLang();
  // Вкладка живёт в адресе (D-21): ссылкой на «Связи» или «Историю» можно
  // поделиться, «назад» возвращает прежнюю вкладку. Хук kit уже это умел и
  // до сих пор не вызывался ниоткуда — паспорт держал вкладку местным
  // состоянием, и адрес о ней не знал.
  const [tab, setTab] = useRecordTab('overview', win);
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
  const [statuses, setStatuses] = useState<{ items: KitConfig['statuses']['items']; notes: string[] }>({ items: [], notes: [] });
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
  const hist = useLoadState(
    () => (HISTORY_TRACKED.has(type)
      ? fetchHistory(type, id, { limit: histLimit }, fetchImpl)
      : Promise.resolve(NOT_TRACKED)),
    [type, id, fetchImpl, histLimit],
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
  const view = useMemo(() => (contract ? fromLoreRecord(contract, lang) : null), [contract, lang]);
  if (pp.state === 'error') return <LoadError error={pp.error} onRetry={pp.reload} />;
  if (!view) return <Skeleton lines={8} label={t('pp.loading')} />;
  // Правка на месте (S4-24, ADR-LORE-047 п. 14.1): сохраняем существующим путём записи и перечитываем
  // паспорт с сервера — показываем записанное, а не то, что набрали.
  const onSave = async ({ field, to }: { field: string; to: unknown }) => {
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
    await savePassportField(
      type, { id: view.record.id, title: view.record.title }, field, to, fetchImpl,
      contract?.record.version ?? null, def?.write ?? null,
    );
    pp.reload();
  };
  // Привязка и отвязка связей (S4-MODEL-PASSPORT-LIST): управление в kit было
  // написано, но хук ему никто не давал — форма привязки просто не рисовалась.
  // Какими связями управлять можно, решает сервер (`manageable` из фасада), а
  // не вид UML: путь привязки есть не у всех. Отказ доходит словами — kit
  // печатает причину рядом с управлением.
  const onRelation = async ({ rel, dir, target, action }: { rel: string; dir: 'out' | 'in'; target: string; action: 'add' | 'remove' }) => {
    await saveRelation({ type, id: view.record.id, rel, dir, target, action }, fetchImpl);
    pp.reload();
  };
  // Спринт: вкладка «Задачи» — дерево спринт → [фаза] → задача (S4-TREE-NESTED,
  // решение владелицы 10.11) из того же ответа /lore/record, и вторым видом —
  // прежняя таблица задач (группировка, правка, массовый статус) со строкой сгорания.
  const baseConfig = type === 'sprint' && contract
    ? withSprintTasksTab(view.config, view.record.kind, t('sprintTasks.title'), () => (
      <SprintTasksPanel contract={contract} onStatusSaved={pp.reload} fetchImpl={fetchImpl} win={win} />
    ))
    : view.config;
  const ctx: KitCtx = { config: {
    ...baseConfig,
    // Цикл статусов из модели ГЛАВНЕЕ умолчания приложения: умолчание —
    // внутренняя таблица kit со всеми осями сразу, из-за неё в меню задачи и
    // были чужие статусы и два «В работе». Пусто — модель не ответила, и
    // причина уже названа в строке замечаний.
    statuses: statuses.items.length ? { ...baseConfig.statuses, items: statuses.items } : baseConfig.statuses,
    hooks: { ...baseConfig.hooks, onSave, onRelation },
  }, data: view.data, role: 'reader',
    // Связи, граф, таблица связей — ссылки по коду из загруженных записей через loreRoutes
    // (S4-13): «#код» вёл никуда (приёмка на проде 09.11). Тип неизвестен — якорь, как раньше.
    // Чипы проектов и компонентов шапки — паспорт своего типа (S4-29, 53а): тип берётся из
    // поля, в котором чип пришёл; раньше чип вёл на «#код».
    href: passportHref(view.data.records, contract?.values ?? {}, x => '#' + encodeURIComponent(x)), esc, md };
  return (
    <>
      {/*
        Оговорки разбора модели — шевроном «⚠ N» (B14 ревью 10.11.2026).
        Говорить о них по-прежнему обязаны (S4-29: молчаливый откат хуже
        отсутствия порядка), но развёрнутая полоса занимала верх паспорта —
        ровно там, где человек ищет шапку, — и попадала под плавающую «×»
        дока. Свёрнутый вид НЕ молчит: число оговорок стоит в самой строке.
        Почему свёрнуто всем, а не только правящим модель, — в ModelNotes.tsx:
        признака роли у клиента сейчас нет вовсе, и выдумывать его нельзя.
      */}
      <ModelNotes notes={[...order.notes, ...statuses.notes]} />
    <RecordReader record={view.record} ctx={ctx} tab={tab} onTab={setTab} facts={view.facts} mdEditor={MdInlineEdit}
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
      }}
      placement={placement} loadedAt={contract?.meta.loaded_at} onReload={pp.reload}
      className="list-passport"
      crumbs={backLabel ? <RecordCrumbs back={{ label: backLabel, href: backHref, onClick: onBack }} current={view.record.id} /> : undefined}
      pager={onGo && ids.length > 0 ? <RecordPager ids={ids} current={view.record.id} onGo={onGo} hotkeys={placement === 'full'} /> : undefined}
      tools={onFull ? <button type="button" className="sk-iconbtn list-passport__full" aria-label={t('pp.place.full')} title={t('pp.place.full')} onClick={onFull}>⤢</button> : undefined}
      asideOpen={false} onAside={() => {}}
      {...(rightColumn === 'auto' ? {} : { defaultPropsOpen: rightColumn === 'open' })} />
    </>
  );
}
