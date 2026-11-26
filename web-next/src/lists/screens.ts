// Экраны списков v2 — спринты и ADR (SPRINT_UXR_S4_UI_SHELL_LISTS/S4-04).
// Каждый экран — только конфиг kit (контракт kit/src/core/contract.ts) +
// слайс + маппинг строки; рисует всё движок списка kit (ListView). Нового
// экрана-списка (задачи, новости — MVP D-2026-UXR-MVP) хватит ещё одной записи.
import { ICON_CANON } from '@seidr/kit';
import { createElement } from 'react';
import type { ReactNode } from 'react';
import { statusMeta } from '@seidr/kit';
import type { KitConfig, KitLang, KitRecord, ListSort } from '@seidr/kit';
import type { LoreClient } from '../sprints/loreClient';
import { TOTALS_FIELDS, loadSprintTotals } from '../sprints/sprintTotals';
import { SprintTasks } from '../sprints/SprintTasks';
import { loadSprintChildren } from '../sprints/sprintChildren';
import { MILESTONE_TOTALS_FIELDS, loadMilestoneTotals } from '../milestone/milestoneTotals';
import { MilestoneRowDetail } from '../milestone/MilestoneRowDetail';
import { LORE_FILTER_FIELDS, STATUS_FACET } from './loreFilters';
import { appT } from '../i18n';
import { feedConfig, type FeedSpec } from './feed';
import { contractScreen, listContractOf, type ListContract } from './listContract';
import type { AppKey } from '../i18n';
import {
  CLOSED_HIDDEN_NOTE, UC_OWN_LINKS_NOTE,
  actorRecord, adrRecord, componentRecord, decisionRecord, featureRecord, gainRecord, jobRecord, milestoneRecord,
  painRecord, productRecord, projectRecord, questionRecord, releaseRecord, specRecord, docRecord, runbookRecord, qualityGateRecord, userRecord, agentRecord, sprintRecord, taskListRecord,
  techRecord, repositoryRecord, organizationRecord, prRecord,
} from './records';
import type { RowMapCtx } from './records';
import { staleByStatus, withCalendar, withLibrary, type CalendarDate, type LibrarySpec } from './library';

type Category = KitConfig['statuses']['items'][number]['category'];

/** Свежие сверху — умолчание раздела, где у записи есть время (см. ListScreenDef.defaultSort). */
const FRESH_FIRST: ListSort = { key: 'updated_at', dir: 'desc' };

/** Иконки и цвета статусов, которых нет в общей таблице kit (statusMeta). */
const OWN_META: Record<string, { icon: string; color: string }> = {
  // S4-32 (выбор владелицы 14.11: «9b», «10e») — иконки из канона, не строкой на месте.
  draft: { icon: ICON_CANON.statusDraft, color: 'var(--st-deferred)' },
  deprecated: { icon: ICON_CANON.statusDeprecated, color: 'var(--st-cancelled)' },
};

function statusItems(lang: KitLang, codes: [code: string, category: Category][], titlePrefix = 'lists.status'): KitConfig['statuses']['items'] {
  return codes.map(([code, category]) => {
    const own = OWN_META[code];
    const m = statusMeta(code);
    return {
      code,
      title: appT(lang, `${titlePrefix}.${code}` as AppKey),
      category,
      icon: own?.icon ?? m.icon,
      color: own?.color ?? m.color,
    };
  });
}

const f = (lang: KitLang, key: string) => appT(lang, `lists.field.${key}` as AppKey);

export interface ListScreenDef {
  /** Слайс GET /lore/slice/{slice}. */
  slice: string;
  /**
   * Имя ТИПА в модели (`/lore/model` → `statuses.<type>`) — K-14 п. 4.
   *
   * Статусная ось раздела берётся из модели, а не из перечня в этом файле:
   * иначе словарь LORE живёт в клиенте, и при добавлении статуса (как это уже
   * было с `ready_for_deploy`) экран показывает не то, что знает сервер.
   * Перечень ниже остаётся УМОЛЧАНИЕМ на случай, когда модель недоступна, и
   * тогда экран говорит об этом словами.
   *
   * Нет имени — у раздела нет статусной оси в модели (вехи, релизы,
   * компоненты, реестр технологий): это законно, ось просто не из модели.
   */
  modelType?: string;
  titleKey: AppKey;
  icon: string;
  /** Строка среза → запись; `ctx.statusCodes` — ось типа из модели (S4-STATUS-AXIS-CONFIG). */
  map: (row: Record<string, unknown>, ctx?: RowMapCtx) => KitRecord;
  config: (lang: KitLang) => KitConfig;
  /** Свои быстрые иконки «Быстро», которым не подходит иконка статуса. */
  quickIcons: Record<string, string>;
  /**
   * Оговорка про выдачу раздела — печатается на экране (S4-V2-SECTIONS).
   *
   * Нужна там, где срез по своей природе отдаёт НЕ ВСЁ: «Показано N из N»
   * тогда правда про выдачу, но не про корпус, и без слов человек решит, что
   * остального у него нет.
   */
  note?: string;
  /**
   * Срез ЗАКРЫТЫХ записей раздела, когда основной срез отдаёт только открытые
   * (задачи: `open_tasks` + `closed_tasks`). Закрытые тогда — фильтр по
   * умолчанию, а не отсечка: режим «Показывать закрытые» не «скрыть» —
   * догружается этот срез; открыта запись, которой в загруженном нет, — фильтр
   * снимается сам (слово владелицы 11.11.2026).
   */
  closedSlice?: string;
  /** Оговорка, пока закрытые скрыты: где снять фильтр. */
  closedNote?: string;
  /**
   * Вложенное (S4-09, перенесено на общий путь в S4-22): колонка прогресса,
   * которая догружается после списка, и раскрытие строки. Раздел подключает
   * это описанием, а не своей страницей.
   */
  nested?: ListNested;
  /**
   * Порядок по умолчанию — по свежести записи (D-2026-UXR-LISTS-DEFAULT-SORT-FRESHNESS,
   * владелица 10.11: «не по мере заведения, а по свежести»).
   *
   * Ставится разделу, чей маппер даёт записи время (`updated_at`); это умолчание,
   * а не выбор: порядок в адресе (`ls`) или из вида главнее. Раздел без времени
   * в срезе умолчания не получает — поле не выдумывается.
   */
  defaultSort?: ListSort;
  /**
   * Группировка по умолчанию (`list.groupings` раздела): репозитории — по проекту (прототип 19.11.2026).
   * Это умолчание, а не выбор: `lg` в адресе главнее. Нет — без группировки.
   */
  defaultGroup?: string;
  /**
   * Управление разделом — только в админке (организации, решение владелицы 19.11.2026): в пользовательском меню
   * раздел только для чтения — без «+ Новая» и без правки связей в паспорте, даже у super-admin.
   */
  manageOnlyInAdmin?: boolean;
  /**
   * Лента раздела (K2-FEED-VIEW): то же описание, из которого собран
   * `list.feed` конфига, — экрану оно нужно, чтобы отдать kit тело записи и
   * нижний уровень. Нет — у записи раздела нет времени, ленты нет.
   */
  feed?: FeedSpec;
  /**
   * Вид «Библиотека» (K2-VIEW-LIBRARY): группы слева по полю раздела, справа —
   * паспорт записи. Нет — раздел не про документы, вида нет.
   */
  library?: LibrarySpec;
  /**
   * Даты календаря (K2-VIEW-CALENDAR) — названы явно, первая по умолчанию.
   * Нет — у записи раздела нет даты, календаря нет: пустой хуже отсутствия.
   */
  calendarDates?: readonly CalendarDate[];
  /**
   * Встроенный график Völva видом раздела (SPRINT_VIZ_EMBED/EMB-L2,
   * D-2026-LORE-VIZ-EMBED-PLACES): имя графика в белом списке бэкенда
   * (lore.volva.embed.charts). Вид появляется только при charts.layer=volva —
   * РЯДОМ с видами list.views, а не вместо них. Нет — встройки в разделе нет.
   */
  volvaChart?: string;
}

export interface ListNested {
  /**
   * Поля записи, которые приходят ПОСЛЕ списка (S4-09, обобщено 09.11).
   *
   * Было одно поле прогресса, и этого хватало, пока догружалось одно число.
   * С итогами спринта за один проход приходят три значения — задач x/y, оценка
   * Σ и факт Σ, — и грузить их тремя запросами ради одной строки было бы
   * расточительством. Перечень нужен не загрузчику, а экрану: пока значений
   * нет, в каждом из этих полей стоит «…», то есть «считаем» вместо пустоты.
   */
  lateFields: readonly string[];
  /**
   * Заплатки полей по id записи: имя поля → значение. `records` — загруженные
   * записи списка (PU-27: вехе нужны её спринты из строки, чтобы сложить их итоги).
   */
  load: (client: LoreClient, ids: readonly string[], signal: AbortSignal, records?: readonly KitRecord[]) => Promise<Map<string, Record<string, unknown>>>;
  /** Содержимое раскрытой строки; грузится лениво — по раскрытию. */
  render: (id: string, client: LoreClient) => ReactNode;
  /**
   * PU-23: дети раскрытой строки, грузятся лениво — по раскрытию. Как их рисовать, решает одно
   * правило (lists/nestedExpand.tsx, владелица 14.11.2026): тип ребёнка ≠ тип строки — вложенная
   * таблица дочернего типа с конфигом ЕГО экрана; тот же тип (иерархия) — строки той же таблицы,
   * свои ячейки которых может подменить cell.
   */
  children?: {
    /** Тип ребёнка (modelType его экрана). Не задан — берётся из kind загруженных записей. */
    kind?: string;
    /** Дети строки `parent` — записями дочернего типа, тем же маппингом, что у его экрана. */
    load: (client: LoreClient, parent: KitRecord, signal: AbortSignal) => Promise<KitRecord[]>;
    cell?: (col: string, child: KitRecord, client: LoreClient) => ReactNode | undefined;
  };
}

const BASE = { modules: [], menu: { groups: [] } } satisfies Pick<KitConfig, 'modules' | 'menu'>;

/**
 * Лента разделов (K2-FEED-VIEW): поле сути, повод и нижний уровень — по
 * разделу. Ключ — раздел, у которого у записи ЕСТЬ время (`updated_at` из
 * `changed_at`); компонентам времени срез не даёт — ленты у них нет, и
 * поле не выдумывается.
 *
 * Имена md-полей — те же, что в строке среза и в `values` паспорта
 * (`LoreRecordRegistry`): у спринта context_md, у задачи note_md, у ADR
 * контекст и решение, у спеки текст, у решения суть и обоснование.
 */
export const FEEDS = {
  sprints: {
    lead: ['context_md'], titles: ['pp.adr.context'], inRow: true,
    because: ['DEPENDS_ON', 'IMPLEMENTED_IN'],
    // Два уровня: под полосой спринта — его задачи, по раскрытию.
    under: {
      titleKey: 'lists.feed.under.tasks',
      load: async (client, id, signal) => {
        const body = await client.slice<Record<string, unknown>>('tasks_of_sprint', { sprint_id: id }, signal);
        const records = body.rows.map(taskListRecord);
        return { records, ...(body.page?.has_more && typeof body.page.total === 'number' ? { total: body.page.total } : {}) };
      },
    },
  },
  // Голова тела — с сервера (body_head, K2-FEED-BODY-MORE), остаток — паспортом.
  adrs: { lead: ['context_md', 'decision_md'], titles: ['pp.adr.context', 'pp.adr.decision'], headInRow: true, because: ['DEPENDS_ON', 'SUPERSEDES'] },
  tasks: { lead: ['note_md'], titles: ['lists.feed.sec.note'], headInRow: true, because: ['JUSTIFIED_BY', 'GATES'] },
  decisions: {
    lead: ['body_md', 'rationale_md'], titles: ['pp.adr.decision', 'lists.feed.sec.rationale'], headInRow: true, because: ['DECIDED_IN', 'ANSWERS'],
    becauseFields: { DECIDED_IN: 'adr' },
  },
  specs: { lead: ['content_md'], titles: ['pp.field.body'], headInRow: true },
  questions: {
    lead: ['body_md'], titles: ['lists.feed.sec.essence'], inRow: true, because: ['RAISED_IN', 'GATES'],
    becauseFields: { GATES: 'gates', RAISED_IN: 'adr' },
  },
  releases: { lead: ['description_md'], inRow: true },
  // 1.18: лента PR — по моменту мержа, суть — заголовок.
  prs: { lead: ['title'], inRow: true },
  tech: { lead: ['content_md'], titles: ['lists.feed.sec.info'], inRow: true },
  // PU-27: у вехи появилось время (changed_at) — значит и лента, как у прочих разделов со
  // временем. Цель и решения вехи срез уже везёт строкой (goal_md, decisions_md).
  milestones: { lead: ['goal_md', 'decisions_md'], titles: ['lists.feed.sec.goal', 'pp.tab.decisions'], inRow: true },
  // «Контекст» первым — как у сервера (LoreBodyHead.SOURCES), владелица 11.11.2026.
  features: { lead: ['context_md', 'body_md'], titles: ['pp.adr.context', 'lists.feed.sec.description'], headInRow: true },
} as const satisfies Partial<Record<string, FeedSpec>>;

/** Конфиг раздела + лента: вид `feed`, `list.feed` и подписи рёбер-поводов. */
function withFeed(lang: KitLang, cfg: KitConfig, spec: FeedSpec): KitConfig {
  const { feed, edges } = feedConfig(spec, k => appT(lang, k));
  const list = cfg.list!;
  return {
    ...cfg,
    ...(edges ? { edges: { ...(cfg.edges ?? {}), ...edges } } : {}),
    list: { ...list, views: list.views.includes('feed') ? list.views : [...list.views, 'feed'], feed },
  };
}

function sprintsConfig(lang: KitLang): KitConfig {
  return {
    ...BASE,
    kinds: {
      sprint: {
        title: appT(lang, 'lists.sprints.title'), icon: 'sprint',
        fields: [
          { key: 'project', title: f(lang, 'project'), type: 'ref', refKind: 'project' },
          { key: 'components', title: f(lang, 'components'), type: 'ref', refKind: 'component' },
          { key: 'release', title: f(lang, 'release'), type: 'ref', refKind: 'release' },
          { key: 'milestone', title: f(lang, 'milestone'), type: 'ref', refKind: 'milestone' },
          // MDL-13 «треки б»: трек спринта по ребру ON_TRACK — дорожки списка (группировка «Трек»).
          { key: 'track', title: f(lang, 'track'), type: 'ref', refKind: 'track' },
          { key: 'priority', title: f(lang, 'priority'), type: 'number' },
          { key: 'tasks', title: f(lang, 'tasks'), type: 'number' },
          // Итоги спринта (S4-09, просьба владелицы 09.11). Единица — в
          // ЗАГОЛОВКЕ колонки («Оценка, дн»), а не в каждой ячейке: иначе «д»
          // повторяется в каждой строке и съедает ширину, за которую мы же и
          // боремся (S4-35).
          { key: 'effort_total', title: f(lang, 'effortTotal'), type: 'number' },
          { key: 'actual_total', title: f(lang, 'actualTotal'), type: 'number' },
        ],
      },
    },
    // Порядок жизненного цикла (D-2026-UXR-STATUS-AXIS): план → работа → итог.
    statuses: {
      items: statusItems(lang, [
        ['backlog', 'todo'], ['planned', 'todo'], ['design', 'todo'], ['todo', 'todo'],
        ['active', 'active'], ['partial', 'active'], ['blocked', 'active'], ['ready_for_deploy', 'active'], ['uat', 'active'],
        // WK-05 (PU-29 п.8): статусы ядра, которые сервер принимает.
        ['waiting', 'active'], ['review', 'active'],
        ['done', 'done'], ['failed', 'cancelled'], ['cancelled', 'cancelled'],
      ]),
    },
    list: {
      // S4-22: один набор данных — любой вид; таймлайн по плановым датам спринта.
      views: ['list', 'cards', 'board', 'feed', 'timeline'],
      timeline: { start: 'planned_start', end: 'planned_end' },
      // S4-27: вид раздела по умолчанию — «открытые, закрытые внизу» (прототип v4).
      showClosed: 'below',
      quick: [
        { id: 'active', title: appT(lang, 'lists.status.active'), filter: { status: 'active' } },
        { id: 'blocked', title: appT(lang, 'lists.status.blocked'), filter: { status: 'blocked' } },
        { id: 'planned', title: appT(lang, 'lists.status.planned'), filter: { status: 'planned' } },
        { id: 'no-release', title: appT(lang, 'lists.quick.noRelease'), filter: { release: '' } },
      ],
      // Имена фасетов — из общего набора loreFilters (S4-05): пока они жили
      // строками здесь и ключами там, наборы разошлись молча.
      filters: [STATUS_FACET, LORE_FILTER_FIELDS.release, LORE_FILTER_FIELDS.project, LORE_FILTER_FIELDS.component],
      groupings: ['status', 'project', 'priority', 'milestone', 'track', 'release'],
      // S9-02: релизов у LORE больше сотни — разрез свёрнут при первом показе,
      // иначе раскрытые группы снова дают стену строк, из которой задача и выросла.
      collapsedGroupings: ['release'],
      // Код и название — разными колонками, как в прототипе v4 (владелица 08.11).
      columns: ['id', 'title', 'progress:tasks', 'sum:effort_total', 'sum:actual_total', 'status', 'project', 'priority', 'release', 'updated_at'],
    },
  };
}

function adrsConfig(lang: KitLang): KitConfig {
  return {
    ...BASE,
    kinds: {
      adr: {
        title: appT(lang, 'lists.adrs.title'), icon: 'scroll-quill',
        fields: [
          { key: 'component', title: f(lang, 'component'), type: 'ref', refKind: 'component' },
          { key: 'components', title: f(lang, 'components'), type: 'ref', refKind: 'component' },
          { key: 'project', title: f(lang, 'project'), type: 'ref', refKind: 'project' },
          { key: 'tags', title: f(lang, 'tags'), type: 'text' },
          { key: 'decisions', title: f(lang, 'decisions'), type: 'number' },
        ],
      },
    },
    // accepted — «действует» (открыто), а не «закрыто»: при наивной связке
    // принятые ADR прятались как закрытые (контракт 2 S1).
    statuses: {
      items: statusItems(lang, [
        ['draft', 'todo'], ['deferred', 'todo'], ['proposed', 'active'], ['accepted', 'active'],
        ['rejected', 'cancelled'], ['deprecated', 'cancelled'], ['superseded', 'cancelled'],
      ]),
    },
    list: {
      views: ['list', 'cards', 'board', 'feed'],
      showClosed: 'below',
      quick: [
        { id: 'proposed', title: appT(lang, 'lists.status.proposed'), filter: { status: 'proposed' } },
        { id: 'accepted', title: appT(lang, 'lists.status.accepted'), filter: { status: 'accepted' } },
        { id: 'no-decisions', title: appT(lang, 'lists.quick.noDecisions'), filter: { decisions: '0' } },
      ],
      filters: [STATUS_FACET, LORE_FILTER_FIELDS.component, LORE_FILTER_FIELDS.project, LORE_FILTER_FIELDS.tags],
      groupings: ['status', 'component', 'project'],
      columns: ['id', 'title', 'status', 'component', 'decisions', 'updated_at'],
    },
  };
}

/**
 * Раздел «Задачи» (S4-V2-SECTIONS). Пункт в меню был с самого начала, экрана
 * под ним не было.
 *
 * Источник — `open_tasks`, а не `all_tasks`: второй несёт `note_md`, и на живом
 * замере весь корпус дал 4 млн символов на 57 730 строк (SE-01 в `LoreSlices`).
 * Закрытые — второй срез `closed_tasks` той же лёгкой проекции; он грузится,
 * когда режим «Показывать закрытые» их показывает. Умолчание режима — «скрыть»:
 * это фильтр, который человек снимает, а не отсечка на сервере (11.11.2026).
 */
function tasksConfig(lang: KitLang): KitConfig {
  return {
    ...BASE,
    kinds: {
      task: {
        title: appT(lang, 'lists.tasks.title'), icon: ICON_CANON.sectionTask,
        fields: [
          { key: 'sprint', title: f(lang, 'sprint'), type: 'ref', refKind: 'sprint' },
          { key: 'components', title: f(lang, 'components'), type: 'ref', refKind: 'component' },
          { key: 'release', title: f(lang, 'release'), type: 'ref', refKind: 'release' },
          // Проект задачи — проекты её спринта; задача в нескольких — в каждой группе (правило 19.11.2026).
          { key: 'project', title: f(lang, 'project'), type: 'ref', refKind: 'project' },
          { key: 'effort', title: f(lang, 'effort'), type: 'number' },
        ],
      },
    },
    statuses: {
      items: statusItems(lang, [
        ['backlog', 'todo'], ['planned', 'todo'], ['design', 'todo'], ['todo', 'todo'],
        ['active', 'active'], ['partial', 'active'], ['blocked', 'active'], ['ready_for_deploy', 'active'], ['uat', 'active'],
        // WK-05 (PU-29 п.8): статусы ядра, которые сервер принимает.
        ['waiting', 'active'], ['review', 'active'],
        ['done', 'done'], ['failed', 'cancelled'], ['cancelled', 'cancelled'],
      ]),
    },
    list: {
      views: ['list', 'cards', 'board'],
      // Закрытых в выдаче не бывает — режим «закрытые внизу» был бы обманом.
      showClosed: 'hide',
      quick: [
        { id: 'active', title: appT(lang, 'lists.status.active'), filter: { status: 'active' } },
        { id: 'blocked', title: appT(lang, 'lists.status.blocked'), filter: { status: 'blocked' } },
        { id: 'no-sprint', title: appT(lang, 'lists.quick.noSprint'), filter: { sprint: '' } },
      ],
      filters: [STATUS_FACET, LORE_FILTER_FIELDS.release, LORE_FILTER_FIELDS.sprint, LORE_FILTER_FIELDS.component, LORE_FILTER_FIELDS.project],
      groupings: ['status', LORE_FILTER_FIELDS.release, LORE_FILTER_FIELDS.sprint, LORE_FILTER_FIELDS.project],
      // Спринтов и релизов много — эти разрезы свёрнуты с первого показа (S9-02).
      collapsedGroupings: [LORE_FILTER_FIELDS.release, LORE_FILTER_FIELDS.sprint],
      columns: ['id', 'title', 'status', 'release', 'sprint', 'components', 'effort', 'updated_at'],
    },
  };
}

/**
 * Описатель раздела (S4-V2-SECTIONS). Восемь оставшихся разделов отличаются
 * только ДАННЫМИ — поля, статусы, фасеты, колонки, — поэтому они и задаются
 * данными, а не восемью копиями одной функции. Это та же доктрина, что в
 * модели: «раздел — данные, а не экран».
 *
 * `statuses` необязателен: его ОТСУТСТВИЕ означает «у этого типа статусной оси
 * нет» (вехи, релизы, компоненты, технологии). Пустой словарь kit теперь
 * принимает (K-14), а фиктивный статус рисовал бы чип, которого у записи нет.
 */
interface SectionSpec {
  kind: string;
  titleKey: AppKey;
  icon: string;
  /** Третий элемент `restricted` — значение сервер отдаёт только с правом; пусто — kit поле не рисует (AP-PEOPLE-PAGE). */
  fields: [key: string, type: 'text' | 'ref' | 'number' | 'date', opts?: { restricted?: boolean }][];
  statuses?: [code: string, category: Category][];
  /**
   * Свой набор подписей статуса: тот же код значит у типа другое («active» у гейта — «Работает»,
   * у задачи — «В работе»). Не задан — общие `lists.status.*`.
   */
  statusTitlePrefix?: string;
  views?: NonNullable<KitConfig['list']>['views'];
  showClosed?: NonNullable<KitConfig['list']>['showClosed'];
  quick?: [id: string, titleKey: AppKey, filter: Record<string, string>][];
  filters: string[];
  groupings: string[];
  collapsedGroupings?: string[];
  columns: string[];
  /**
   * PU-23: родитель того же типа (иерархия, ссылка на себя). Таблица показывает детей строками под
   * родителем с отступом — list.tree, та же настройка, что у вида «Дерево». Нет — список плоский.
   * order нужен виду «Дерево»; в таблице соседи одного уровня идут порядком сортировки списка.
   */
  tree?: NonNullable<KitConfig['list']>['tree'];
  /** Слова проверенного ноля раздела (kit list.empty): почему записей нет. Нет — общие слова kit. */
  empty?: [title: AppKey, hint: AppKey];
}

/**
 * Вид записи на другом конце поля-ссылки: по нему kit делает значение ссылкой на запись (refHref ListScreen).
 * Владелица 18.11.2026: «если объект ссылка хорошо бы была возможность перехода». parent/children — тот же вид,
 * что у записи (иерархия). Сторож — refKinds.test.ts: ссылка без вида осталась бы текстом молча.
 */
const REF_KIND: Record<string, string> = {
  project: 'project', component: 'component', components: 'component', release: 'release', milestone: 'milestone',
  sprint: 'sprint', sprints: 'sprint', products: 'product', product: 'product', adr: 'adr', adrs: 'adr',
  tech: 'tech', actors: 'actor', owner: 'person', gates: 'quality_gate', releases: 'release',
};
function refKindOf(kind: string, key: string): string | undefined {
  return key === 'parent' || key === 'children' ? kind : REF_KIND[key];
}

/**
 * Правило владелицы 19.11.2026: «везде где есть проект делай группировку по проекту … если проектов несколько в
 * каждую группу». Есть поле-ссылка на проект — есть разрез по проекту; запись в нескольких проектах kit кладёт в
 * каждую группу сам (grouping.ts). Сторож — groupByProject.test.ts.
 */
function withProjectGrouping(groupings: string[], hasProject: boolean): string[] {
  if (!hasProject || groupings.some(g => g === 'project' || g === LORE_FILTER_FIELDS.project)) return groupings;
  return [...groupings, LORE_FILTER_FIELDS.project];
}

function sectionConfig(lang: KitLang, spec: SectionSpec): KitConfig {
  return {
    ...BASE,
    kinds: {
      [spec.kind]: {
        title: appT(lang, spec.titleKey), icon: spec.icon,
        fields: spec.fields.map(([key, type, opts]) => ({
          key, title: f(lang, key), type,
          ...(type === 'ref' ? { refKind: refKindOf(spec.kind, key) } : {}),
          ...(opts?.restricted ? { restricted: true } : {}),
        })),
      },
    },
    statuses: { items: statusItems(lang, spec.statuses ?? [], spec.statusTitlePrefix) },
    list: {
      views: spec.views ?? ['list', 'cards'],
      ...(spec.showClosed ? { showClosed: spec.showClosed } : {}),
      ...(spec.quick ? { quick: spec.quick.map(([id, titleKey, filter]) => ({ id, title: appT(lang, titleKey), filter })) } : {}),
      filters: spec.filters,
      groupings: withProjectGrouping(spec.groupings, spec.fields.some(([key, type]) => key === 'project' && type === 'ref')),
      ...(spec.collapsedGroupings ? { collapsedGroupings: spec.collapsedGroupings } : {}),
      columns: spec.columns,
      ...(spec.tree ? { tree: spec.tree } : {}),
      ...(spec.empty ? { empty: { title: appT(lang, spec.empty[0]), hint: appT(lang, spec.empty[1]) } } : {}),
    },
  };
}

/**
 * 1.18 (владелица 21.11.2026: «в меню под релизы вход в PR сделай»): PR — заголовок (нет — ключ), проект, состояние,
 * момент мержа, ветки, релизы по ключу. Фильтры: проект, состояние, «без заголовка», «без релиза». Статуса плана нет.
 */
const prsSpec: SectionSpec = {
  kind: 'pr', titleKey: 'lists.prs.title', icon: 'branch-arrow',
  fields: [['project', 'ref'], ['state', 'text'], ['merged_at', 'date'], ['branches', 'text'], ['releases', 'ref'],
    ['no_title', 'text'], ['no_release', 'text']],
  statuses: [],
  views: ['list', 'cards'],
  quick: [['no-title', 'lists.quick.prNoTitle', { no_title: '✓' }], ['no-release', 'lists.quick.prNoRelease', { no_release: '✓' }]],
  filters: [LORE_FILTER_FIELDS.project, 'fields.state', 'fields.no_title', 'fields.no_release'],
  groupings: [LORE_FILTER_FIELDS.project, 'fields.state'],
  columns: ['title', 'project', 'state', 'merged_at', 'branches', 'releases'],
};

/** Решения: статусов девять видов, у 46 строк из 778 статуса нет вовсе. */
const decisionsSpec: SectionSpec = {
  kind: 'decision', titleKey: 'lists.decisions.title', icon: 'gavel',
  fields: [['component', 'ref'], ['components', 'ref'], ['project', 'ref'], ['tags', 'text'], ['adr', 'ref']],
  // Ось — объявленный словарь `decisionStatuses`, не «что встретилось в данных».
  // В корпусе есть 2 строки `rejected` и одна «🚫 CANCELLED» (статус ЗАДАЧИ в
  // поле решения) — их здесь НЕТ намеренно: вне оси → «неизвестно» на экране,
  // то есть грязь видна, а не замазана похожим кодом.
  statuses: [
    ['deferred', 'todo'], ['proposed', 'active'],
    ['accepted', 'done'], ['fixed', 'done'], ['done', 'done'],
    ['superseded', 'cancelled'],
  ],
  views: ['list', 'cards', 'board', 'feed'],
  showClosed: 'below',
  quick: [['proposed', 'lists.status.proposed', { status: 'proposed' }], ['no-adr', 'lists.quick.noAdr', { adr: '' }]],
  filters: [STATUS_FACET, LORE_FILTER_FIELDS.component, LORE_FILTER_FIELDS.project, LORE_FILTER_FIELDS.tags],
  groupings: ['status', LORE_FILTER_FIELDS.component, 'fields.adr'],
  columns: ['id', 'title', 'status', 'component', 'adr', 'updated_at'],
};

/**
 * Спеки: статус пуст у 353 строк из 390 (90%). Поэтому разрез по умолчанию —
 * компонент: группировка по статусу сложила бы почти всё в «неизвестно».
 */
const specsSpec: SectionSpec = {
  kind: 'spec', titleKey: 'lists.specs.title', icon: 'scroll-unfurled',
  // components — поле фасета и разреза (LORE_FILTER_FIELDS.component): без него
  // в виде фасет «Компоненты» печатал сырой ключ (K4-FACET-LABELS).
  fields: [['component', 'ref'], ['components', 'ref'], ['version', 'text'], ['path', 'text'], ['project', 'ref']],
  statuses: [['proposed', 'active'], ['accepted', 'done'], ['deprecated', 'cancelled'], ['superseded', 'cancelled']],
  views: ['list', 'cards'],
  quick: [['no-status', 'lists.quick.noStatus', { status: '' }], ['no-version', 'lists.quick.noVersion', { version: '' }]],
  filters: [STATUS_FACET, LORE_FILTER_FIELDS.component, LORE_FILTER_FIELDS.project],
  groupings: [LORE_FILTER_FIELDS.component, 'status'],
  columns: ['id', 'title', 'status', 'component', 'version', 'updated_at'],
};

/**
 * Документы (S5-DOC-PASSPORT): статуса у KnowDoc нет вовсе, поэтому разрез — компонент,
 * и колонок статуса/даты правки нет: их нечем заполнить (у дока нет SCD2-версий и updated_at).
 */
const docsSpec: SectionSpec = {
  kind: 'doc', titleKey: 'lists.docs.title', icon: 'bookshelf',
  fields: [['component', 'ref'], ['components', 'ref'], ['docKind', 'text'], ['parent', 'ref'], ['project', 'ref']],
  statuses: [],
  views: ['list', 'cards'],
  // Дерево документов (DOC_CHILD_OF): «верхнего уровня» — без родителя.
  quick: [['top-level', 'lists.quick.topLevel', { parent: '' }]],
  filters: [LORE_FILTER_FIELDS.component, LORE_FILTER_FIELDS.project],
  groupings: [LORE_FILTER_FIELDS.component, 'fields.docKind'],
  columns: ['id', 'title', 'docKind', 'component', 'parent'],
  tree: { parent: 'parent', order: 'title' },
};

/** MD-04, второй заход по QG: гейты качества — состояние, итог прогона, компонент, проект-владелец. */
const qualityGatesSpec: SectionSpec = {
  kind: 'quality_gate', titleKey: 'lists.qualityGates.title', icon: 'checkered-flag',
  fields: [['lastRun', 'text'], ['component', 'ref'], ['components', 'ref'], ['project', 'ref'], ['sprint', 'text']],
  // Категории kit: «работает» и «молчит» — открыты (гейт действует), «выведен» — снят.
  statuses: [['draft', 'todo'], ['active', 'active'], ['stale', 'active'], ['retired', 'cancelled']],
  statusTitlePrefix: 'lists.qgStatus',
  views: ['list', 'cards'],
  quick: [['no-status', 'lists.quick.noStatus', { status: '' }], ['no-project', 'lists.quick.noProjects', { project: '' }]],
  filters: [STATUS_FACET, 'fields.lastRun', LORE_FILTER_FIELDS.component, LORE_FILTER_FIELDS.project],
  groupings: ['status', LORE_FILTER_FIELDS.component, LORE_FILTER_FIELDS.project],
  columns: ['id', 'title', 'status', 'lastRun', 'component', 'project'],
};

/** MD-04: ранбуки — область, ADR и проекты; статуса в срезе нет. */
const runbooksSpec: SectionSpec = {
  kind: 'runbook', titleKey: 'lists.runbooks.title', icon: 'spell-book',
  fields: [['area', 'text'], ['adrs', 'ref'], ['project', 'ref']],
  statuses: [],
  views: ['list', 'cards'],
  quick: [['no-adr', 'lists.quick.noAdr', { adrs: '' }]],
  filters: ['fields.area', LORE_FILTER_FIELDS.project],
  groupings: ['fields.area', LORE_FILTER_FIELDS.project],
  columns: ['id', 'title', 'area', 'adrs', 'project'],
};

/** S9-05 A: люди — статуса нет, разрез по проектам. */
const usersSpec: SectionSpec = {
  kind: 'user', titleKey: 'lists.users.title', icon: 'person',
  // Пакет 1.18: заголовок — имя (профиль или KC), логин — своей колонкой рядом.
  fields: [['project', 'ref'], ['login', 'text']],
  statuses: [],
  views: ['list', 'cards'],
  quick: [['no-projects', 'lists.quick.noProjects', { project: '' }]],
  filters: [LORE_FILTER_FIELDS.project],
  groupings: [LORE_FILTER_FIELDS.project],
  columns: ['title', 'login', 'project'],
};

/** S9-05 A: агенты — профиль и владелец; статуса нет. */
const agentsSpec: SectionSpec = {
  kind: 'agent', titleKey: 'lists.agents.title', icon: 'robot-golem',
  // client_id сервер отдаёт только администратору (AP-PEOPLE-PAGE, решение 1б): зрителю поля на карточке нет вовсе
  fields: [['clientId', 'text', { restricted: true }], ['agentRole', 'text'], ['harness', 'text'], ['owner', 'ref'], ['project', 'ref']],
  statuses: [],
  views: ['list', 'cards'],
  quick: [['no-owner', 'lists.quick.noOwner', { owner: '' }]],
  filters: [LORE_FILTER_FIELDS.project],
  groupings: ['fields.agentRole', LORE_FILTER_FIELDS.project],
  // Без внутреннего кода (слово владелицы 22.11.2026: «и код для агентов скрывай, это лишнее»): агент опознаётся
  // именем и учёткой, а AGENT-FULL-msbt0fed человеку ничего не говорит и занимал первую, самую заметную колонку.
  // Так же устроен раздел людей. Код никуда не делся: он остаётся опознавателем записи, адресом паспорта и
  // значением поиска — спрятана колонка, а не данные.
  columns: ['title', 'agentRole', 'clientId', 'owner'],
};

/** Вопросы: группировка по статусу — прямая просьба владелицы (06.11). */
const questionsSpec: SectionSpec = {
  kind: 'question', titleKey: 'lists.questions.title', icon: 'help',
  fields: [
    ['component', 'ref'], ['components', 'ref'], ['project', 'ref'], ['priority', 'text'],
    ['owner', 'text'], ['due', 'date'], ['gates', 'ref'], ['adr', 'ref'],
  ],
  statuses: [['deferred', 'todo'], ['open', 'active'], ['closed', 'done'], ['dropped', 'cancelled']],
  views: ['list', 'cards', 'board'],
  showClosed: 'below',
  quick: [
    ['open', 'lists.status.open', { status: 'open' }],
    ['deferred', 'lists.status.deferred', { status: 'deferred' }],
    ['gating', 'lists.quick.gating', { gates: '*' }],
  ],
  filters: [STATUS_FACET, LORE_FILTER_FIELDS.component, LORE_FILTER_FIELDS.project, 'fields.owner'],
  groupings: ['status', LORE_FILTER_FIELDS.component, 'fields.owner'],
  columns: ['id', 'title', 'status', 'component', 'owner', 'due'],
};

/**
 * Вехи: СТАТУСА НЕТ — ни колонки, ни фасета статуса (K-14).
 *
 * PU-27: «задачи x/y» по задачам спринтов вехи (как у спринтов, S4-09) и время
 * правки (`updated_at` из changed_at среза). Своё поле «Продукты» остаётся —
 * на случай, когда краска продукта не загрузилась; при краске его вытесняет
 * общая колонка «Продукт» (withProductColumn), иначе выходил дубль.
 */
const milestonesSpec: SectionSpec = {
  kind: 'milestone', titleKey: 'lists.milestones.title', icon: 'crossed-axes',
  fields: [['week', 'number'], ['when', 'text'], ['priority', 'text'], ['products', 'ref'], ['sprints', 'ref'], ['tasks', 'number']],
  views: ['list', 'cards'],
  quick: [['critical', 'lists.quick.critical', { priority: 'critical' }], ['no-sprints', 'lists.quick.noSprints', { sprints: '' }]],
  filters: [LORE_FILTER_FIELDS.priority, 'fields.products'],
  groupings: ['fields.products', LORE_FILTER_FIELDS.priority],
  columns: ['id', 'title', 'progress:tasks', 'when', 'priority', 'products', 'sprints', 'updated_at'],
};

/** Релизы: СТАТУСА НЕТ; есть вид (релиз/хотфикс) и признак текущего. */
const releasesSpec: SectionSpec = {
  kind: 'release', titleKey: 'lists.releases.title', icon: 'open-book',
  fields: [
    ['version', 'text'], ['type', 'text'], ['week', 'number'], ['current', 'text'], ['released', 'date'],
    ['project', 'ref'], ['sprints', 'number'], ['prs', 'number'],
  ],
  views: ['list', 'cards', 'feed', 'timeline'],
  quick: [['current', 'lists.quick.current', { current: 'true' }], ['hotfix', 'lists.quick.hotfix', { type: 'hotfix' }]],
  filters: [LORE_FILTER_FIELDS.project, 'fields.type'],
  groupings: [LORE_FILTER_FIELDS.project, 'fields.type'],
  columns: ['id', 'title', 'version', 'type', 'project', 'sprints', 'prs', 'updated_at'],
};

/** Компоненты: СТАТУСА НЕТ — это справочник. */
const componentsSpec: SectionSpec = {
  kind: 'component', titleKey: 'lists.components.title', icon: 'cog',
  fields: [
    ['area', 'text'], ['parent', 'ref'], ['owner', 'text'], ['team', 'text'],
    ['children', 'ref'], ['tech', 'ref'], ['project', 'ref'], ['adrs', 'number'], ['specs', 'number'],
  ],
  views: ['list', 'cards'],
  quick: [['no-owner', 'lists.quick.noOwner', { owner: '' }]],
  filters: ['fields.area', LORE_FILTER_FIELDS.project, 'fields.owner'],
  groupings: ['fields.area', 'fields.owner'],
  columns: ['id', 'title', 'area', 'owner', 'adrs', 'specs'],
  tree: { parent: 'parent', order: 'title' },
};

/** Проекты (S4-29, 53а): СТАТУСА НЕТ — справочник git-проектов; щелчок — паспорт проекта. */
const projectsSpec: SectionSpec = {
  kind: 'project', titleKey: 'lists.projects.title', icon: 'open-folder',
  fields: [['full_title', 'text'], ['default_branch', 'text']],
  views: ['list', 'cards'],
  quick: [['no-branch', 'lists.quick.noBranch', { default_branch: '' }]],
  filters: [],
  groupings: [],
  columns: ['id', 'title', 'full_title', 'default_branch'],
};

/**
 * D-2026-MIG-REPOSITORY-ORGANIZATION (прототип mig-repos-orgs.html): репозитории — полный путь, роль, проект /
 * компонент, зеркала. Статуса нет. Группировка по проекту — общий механизм: репозиторий в нескольких — в каждой группе.
 */
const repositoriesSpec: SectionSpec = {
  kind: 'repository', titleKey: 'lists.repositories.title', icon: 'chest',
  fields: [
    ['role', 'text'], ['project', 'ref'], ['component', 'ref'], ['components', 'ref'],
    ['mirrors', 'text'], ['mirrorOf', 'text'], ['host', 'text'], ['hostOwner', 'text'], ['default_branch', 'text'],
  ],
  statuses: [],
  views: ['list', 'cards'],
  quick: [['no-project', 'lists.quick.noProjects', { project: '' }]],
  filters: ['fields.host', 'fields.hostOwner', 'fields.role', LORE_FILTER_FIELDS.project],
  groupings: [LORE_FILTER_FIELDS.project, 'fields.role', 'fields.host', 'fields.hostOwner'],
  columns: ['title', 'role', 'project', 'component', 'mirrors'],
};

/**
 * Организации — самостоятельный объект, пока пустой: тип заведён переносом, какие организации завести и с чем
 * связать — решает владелица. Пустой раздел говорит это словами, а не общим «пусто».
 */
const organizationsSpec: SectionSpec = {
  kind: 'organization', titleKey: 'lists.organizations.title', icon: 'castle',
  fields: [['name', 'text']],
  statuses: [],
  views: ['list', 'cards'],
  quick: [['no-name', 'lists.quick.noName', { name: '' }]],
  filters: [],
  groupings: [],
  columns: ['id', 'title'],
  empty: ['lists.organizations.emptyTitle', 'lists.organizations.emptyHint'],
};

/** Технологии: СТАТУСА НЕТ — это реестр версий (спеки SPEC-TECH-*). */
const techSpec: SectionSpec = {
  kind: 'tech', titleKey: 'lists.tech.title', icon: 'gears',
  // components — поле фасета и разреза; без него фасет печатал сырой ключ (K4-FACET-LABELS).
  fields: [['version', 'text'], ['component', 'ref'], ['components', 'ref'], ['checked', 'date']],
  views: ['list', 'cards'],
  quick: [['no-version', 'lists.quick.noVersion', { version: '' }]],
  filters: [LORE_FILTER_FIELDS.component],
  groupings: [LORE_FILTER_FIELDS.component],
  columns: ['id', 'title', 'version', 'component', 'checked'],
};

/**
 * Фичи и US: статусы свои (shipped / active / in_rework и пусто) — не ось задач.
 * Числа «сценариев» и «задач» берутся готовыми из среза, без догрузки.
 *
 * Раздел читает `use_cases` — ВСЕ уровни шкалы целей, поэтому в нём вперемешку
 * корни (фичи) и вложенные сценарии (US). Отсюда и состав: «Уровень цели» —
 * фасет, разрез и колонка (раньше он различал только cloud и kite, теперь —
 * все четыре уровня шкалы), а быстрый фильтр «Верхний уровень» отбирает одни
 * фичи (записи без родителя) — тем же признаком, которым их отличает человек.
 *
 * Чего здесь НЕ стало и почему:
 * • «Веха» (поле, быстрый фильтр, колонка) — столбца `milestone_id` в срезе
 *   нет. Колонка была бы прочерками, а «Без вехи» совпадал бы со всей выдачей.
 * • «Сценариев x/y» (progress:ucs) — нет второго числа (`uc_shipped`). Вместо
 *   прогресса обычный счёт сценариев плюс счёт задач (`task_count`).
 * Вернуть и то и то можно одним серверным столбцом каждому — см. отчёт.
 */
const featuresSpec: SectionSpec = {
  kind: 'feature', titleKey: 'lists.features.title', icon: 'gift-of-knowledge',
  fields: [
    ['components', 'ref'], ['project', 'ref'], ['level', 'text'],
    ['parent', 'ref'], ['shipped', 'date'], ['ucs', 'number'], ['tasks', 'number'],
  ],
  statuses: [['active', 'active'], ['in_rework', 'active'], ['shipped', 'done']],
  views: ['list', 'cards', 'board'],
  showClosed: 'below',
  quick: [
    ['active', 'lists.status.active', { status: 'active' }],
    ['top-level', 'lists.quick.topLevel', { parent: '' }],
  ],
  filters: [STATUS_FACET, LORE_FILTER_FIELDS.component, LORE_FILTER_FIELDS.project, 'fields.level'],
  groupings: ['status', 'fields.level', LORE_FILTER_FIELDS.component],
  columns: ['id', 'title', 'status', 'level', 'ucs', 'tasks', 'components'],
  tree: { parent: 'parent', order: 'title' },
};

/**
 * Даты календаря по разделам (K2-VIEW-CALENDAR), названы явно:
 * • спринт — план начала (planned_start_date) и факт закрытия (done_date);
 * • релиз — дата выпуска (release_date).
 * Вехам (date_display — «прогноз Q4 2026», текст, а не дата) и задачам (в срезе
 * нет ни срока, ни даты закрытия — только время правки) календаря нет.
 */
const SPRINT_DATES = [
  { field: 'planned_start', labelKey: 'lists.calendar.plannedStart' },
  { field: 'done_date', labelKey: 'lists.calendar.doneDate' },
] as const satisfies readonly CalendarDate[];
const RELEASE_DATES = [{ field: 'released', labelKey: 'lists.calendar.released' }] as const satisfies readonly CalendarDate[];

const joinMeta = (...parts: unknown[]) => parts.filter(p => typeof p === 'string' && p).join(' · ') || undefined;

/**
 * Библиотеки разделов (K2-VIEW-LIBRARY). Разрез выбран по данным:
 * • компоненты — по области (замер 11.11: area заполнена у 105 из 110, команда —
 *   примерно у четверти, корень дерева — один на десятки компонентов, и у
 *   половины корней детей нет); устарел — область deprecated;
 * • ADR, спеки, решения, технологии — по компоненту; устарел — статус
 *   закрытой ветки «отменено» (заменён, отклонён, выведен).
 */
const LIBRARIES = {
  components: {
    groupBy: 'area', noGroupKey: 'lists.library.noArea',
    stale: r => r.fields.area === 'deprecated',
    meta: r => joinMeta(r.fields.parent ? `↑ ${String(r.fields.parent)}` : '', r.fields.team, r.fields.owner),
  },
  adrs: { groupBy: 'component', noGroupKey: 'lists.library.noComponent', stale: staleByStatus },
  specs: { groupBy: 'component', noGroupKey: 'lists.library.noComponent', stale: staleByStatus, meta: r => joinMeta(r.fields.version) },
  decisions: { groupBy: 'component', noGroupKey: 'lists.library.noComponent', stale: staleByStatus, meta: r => joinMeta(r.fields.adr) },
  tech: { groupBy: 'component', noGroupKey: 'lists.library.noComponent', meta: r => joinMeta(r.fields.version) },
} as const satisfies Record<string, LibrarySpec>;
// ── Нода «Продукт» (S4-PRODUCTS-NODE, владелица 11.11) ───────────────────────
// Продукты и минимальный профиль клиента: боли, выгоды, работы, роли. Статусов у
// этих записей нет (справочники) — ни колонки, ни фасета статуса (K-14). VP-канва —
// отдельный спринт; здесь только списки. Иконки — канон v1 (product/icons.ts,
// LorePage SECTIONS) и SECTION_ICONS kit.

/** Продукты: статья словаря product; родитель и подпродукты — рёбра PARENT_PRODUCT. */
const productsSpec: SectionSpec = {
  kind: 'product', titleKey: 'lists.products.title', icon: 'bullseye',
  // WK-01: вид продукта (tech | service, набор) — колонка, фильтр и группировка списка. Ключ не «kind»:
  // kind у записи kit — её тип (product), и колонка «kind» показала бы «Продукты».
  fields: [['product_kind', 'text'], ['parent', 'ref'], ['children', 'ref'], ['components', 'ref'], ['project', 'ref']],
  views: ['list', 'cards'],
  quick: [['top-level', 'lists.quick.topLevel', { parent: '' }]],
  filters: [LORE_FILTER_FIELDS.project, 'fields.product_kind', 'fields.parent'],
  groupings: ['fields.parent', 'fields.product_kind'],
  columns: ['id', 'title', 'product_kind', 'parent', 'children', 'components', 'project'],
  tree: { parent: 'parent', order: 'title' },
};

/** Боли: «заявлено» (ADDRESSES) и «снимает» (RELIEVES) — два разных утверждения (ADR-LORE-032 D5). */
const painsSpec: SectionSpec = {
  kind: 'pain', titleKey: 'lists.pains.title', icon: 'thorn-helix',
  fields: [['severity', 'text'], ['actors', 'ref'], ['claimed', 'number'], ['relieved', 'number']],
  views: ['list', 'cards'],
  filters: ['fields.severity', 'fields.actors'],
  groupings: ['fields.severity', 'fields.actors'],
  // «Никто не снимает» — тот же вопрос, что находка pain_without_relief гигиены продукта.
  quick: [['not-relieved', 'lists.quick.notRelieved', { relieved: '0' }]],
  columns: ['id', 'title', 'severity', 'actors', 'claimed', 'relieved'],
};

const gainsSpec: SectionSpec = {
  kind: 'gain', titleKey: 'lists.gains.title', icon: 'gift-of-knowledge',
  fields: [['rank', 'text'], ['actors', 'ref'], ['claimed', 'number'], ['delivered', 'number']],
  views: ['list', 'cards'],
  filters: ['fields.rank', 'fields.actors'],
  groupings: ['fields.rank', 'fields.actors'],
  quick: [['not-delivered', 'lists.quick.notDelivered', { delivered: '0' }]],
  columns: ['id', 'title', 'rank', 'actors', 'claimed', 'delivered'],
};

const jobsSpec: SectionSpec = {
  kind: 'job', titleKey: 'lists.jobs.title', icon: 'archery-target',
  fields: [['job_kind', 'text'], ['importance', 'text'], ['actors', 'ref'], ['claimed', 'number'], ['performed', 'number']],
  views: ['list', 'cards'],
  filters: ['fields.job_kind', 'fields.importance', 'fields.actors'],
  groupings: ['fields.job_kind', 'fields.importance'],
  quick: [['not-performed', 'lists.quick.notPerformed', { performed: '0' }]],
  columns: ['id', 'title', 'job_kind', 'importance', 'actors', 'claimed', 'performed'],
};

/** Пользовательские роли (клиентские сегменты): вид актора — фасет и разрез по умолчанию. */
const actorsSpec: SectionSpec = {
  kind: 'actor', titleKey: 'lists.actors.title', icon: 'hooded-figure',
  fields: [['actor_kind', 'text'], ['project', 'ref'], ['ucs', 'number']],
  views: ['list', 'cards'],
  filters: ['fields.actor_kind', LORE_FILTER_FIELDS.project],
  groupings: ['fields.actor_kind', LORE_FILTER_FIELDS.project],
  // «Мёртвая роль» v1 (аналитика продукта): роль без сценариев.
  quick: [['no-ucs', 'lists.quick.noUcs', { ucs: '0' }]],
  columns: ['id', 'title', 'actor_kind', 'project', 'ucs'],
};

export const LIST_SCREENS = {
  sprints: {
    modelType: 'sprint',
    slice: 'sprints', titleKey: 'lists.sprints.title', icon: 'sprint',
    defaultSort: FRESH_FIRST,
    map: sprintRecord, config: lang => withCalendar(withFeed(lang, sprintsConfig(lang), FEEDS.sprints), SPRINT_DATES), feed: FEEDS.sprints,
    calendarDates: SPRINT_DATES,
    // Völva вместо нечитаемого Ганта — видом рядом с таймлайном, пока встройку не приняли.
    volvaChart: 'sprints_timeline',
    // S4-32 (выбор владелицы 14.11: «21c»): у «Без релиза» теперь своя иконка.
    quickIcons: { 'no-release': ICON_CANON.quickNoRelease },
    // Итоги спринта: задач x/y, оценка Σ дн, факт Σ дн — одним запросом к
    // `sprint_totals` (S4-09). Считает сервер: одно число из двух мест
    // расходится, и у kit это уже случилось со статусными цветами (K-14).
    nested: {
      lateFields: TOTALS_FIELDS,
      load: loadSprintTotals,
      render: (id, client) => createElement(SprintTasks, { sprintId: id, client }),
      // PU-23: задачи — другой тип, под спринтом встаёт вложенная таблица экрана «Задачи».
      children: { kind: 'task', load: loadSprintChildren },
    },
  },
  adrs: {
    modelType: 'adr',
    slice: 'adrs', titleKey: 'lists.adrs.title', icon: 'scroll-quill',
    defaultSort: FRESH_FIRST,
    map: adrRecord, config: lang => withLibrary(withFeed(lang, adrsConfig(lang), FEEDS.adrs)), feed: FEEDS.adrs, library: LIBRARIES.adrs, quickIcons: { 'no-decisions': ICON_CANON.quickNoDecisions },
  },
  tasks: {
    modelType: 'task',
    slice: 'open_tasks', titleKey: 'lists.tasks.title', icon: ICON_CANON.sectionTask,
    defaultSort: FRESH_FIRST,
    map: taskListRecord, config: lang => withFeed(lang, tasksConfig(lang), FEEDS.tasks), feed: FEEDS.tasks, quickIcons: {},
    // Закрытые — фильтр по умолчанию, а не срез (слово владелицы 11.11): режим
    // «Показывать закрытые» их показывает — догружается closed_tasks.
    closedSlice: 'closed_tasks',
    closedNote: CLOSED_HIDDEN_NOTE,
  },
  decisions: {
    modelType: 'decision',
    slice: 'decisions', titleKey: 'lists.decisions.title', icon: 'gavel',
    defaultSort: FRESH_FIRST,
    map: decisionRecord, config: lang => withLibrary(withFeed(lang, sectionConfig(lang, decisionsSpec), FEEDS.decisions)), feed: FEEDS.decisions, library: LIBRARIES.decisions, quickIcons: {},
  },
  specs: {
    modelType: 'spec',
    slice: 'specs', titleKey: 'lists.specs.title', icon: 'scroll-unfurled',
    defaultSort: FRESH_FIRST,
    map: specRecord, config: lang => withLibrary(withFeed(lang, sectionConfig(lang, specsSpec), FEEDS.specs)), feed: FEEDS.specs, library: LIBRARIES.specs, quickIcons: {},
  },
  docs: {
    modelType: 'doc',
    slice: 'docs', titleKey: 'lists.docs.title', icon: 'bookshelf',
    map: docRecord, config: lang => sectionConfig(lang, docsSpec), quickIcons: {},
  },
  // MD-04, второй заход по QG: гейты качества — раздел «Работа» и паспорт (только чтение).
  quality_gates: {
    modelType: 'quality_gate',
    slice: 'quality_gates', titleKey: 'lists.qualityGates.title', icon: 'checkered-flag',
    map: qualityGateRecord, config: lang => sectionConfig(lang, qualityGatesSpec), quickIcons: {},
  },
  // MD-04: ранбуки — раздел «Знания» и паспорт (тип runbook, только чтение).
  runbooks: {
    slice: 'runbooks', titleKey: 'lists.runbooks.title', icon: 'spell-book',
    map: runbookRecord, config: lang => sectionConfig(lang, runbooksSpec), quickIcons: {},
  },
  users: {
    modelType: 'user',
    slice: 'users', titleKey: 'lists.users.title', icon: 'person',
    map: userRecord, config: lang => sectionConfig(lang, usersSpec), quickIcons: {},
  },
  agents: {
    modelType: 'agent',
    slice: 'agents', titleKey: 'lists.agents.title', icon: 'robot-golem',
    map: agentRecord, config: lang => sectionConfig(lang, agentsSpec), quickIcons: {},
  },
  questions: {
    // Срез `questions`, а НЕ `open_questions`: второй — синоним на переход и
    // отдаёт все вопросы, несмотря на имя (182 закрытых из 262).
    modelType: 'question',
    slice: 'questions', titleKey: 'lists.questions.title', icon: 'help',
    defaultSort: FRESH_FIRST,
    map: questionRecord, config: lang => withFeed(lang, sectionConfig(lang, questionsSpec), FEEDS.questions), feed: FEEDS.questions, quickIcons: {},
  },
  milestones: {
    slice: 'milestones', titleKey: 'lists.milestones.title', icon: 'crossed-axes',
    defaultSort: FRESH_FIRST,
    map: milestoneRecord, config: lang => withFeed(lang, sectionConfig(lang, milestonesSpec), FEEDS.milestones), feed: FEEDS.milestones, quickIcons: {},
    // PU-27: «задачи x/y» вехи — сумма итогов её спринтов (sprint_totals считает сервер);
    // в раскрытой строке — сгорание вехи (BURN-DOWN и «Цель к сроку»), тем же кодом, что у спринта,
    nested: {
      lateFields: MILESTONE_TOTALS_FIELDS,
      load: loadMilestoneTotals,
      // K4-CHARTS (19.11, «можно и на дорожную карту»): под сгоранием — графики спринтов вехи.
      render: id => createElement(MilestoneRowDetail, { milestoneId: id }),
    },
  },
  // 1.18: PR под «Релизами»; свежие сверху — по моменту мержа (updated_at записи = merged_at).
  prs: {
    slice: 'prs', titleKey: 'lists.prs.title', icon: 'branch-arrow',
    defaultSort: FRESH_FIRST,
    map: prRecord, config: lang => withFeed(lang, sectionConfig(lang, prsSpec), FEEDS.prs), feed: FEEDS.prs, quickIcons: {},
  },
  releases: {
    slice: 'releases', titleKey: 'lists.releases.title', icon: 'open-book',
    defaultSort: FRESH_FIRST,
    map: releaseRecord, config: lang => withCalendar(withFeed(lang, sectionConfig(lang, releasesSpec), FEEDS.releases), RELEASE_DATES), feed: FEEDS.releases,
    calendarDates: RELEASE_DATES, quickIcons: {},
  },
  components: {
    slice: 'components', titleKey: 'lists.components.title', icon: 'cog',
    map: componentRecord, config: lang => withLibrary(sectionConfig(lang, componentsSpec)), quickIcons: {},
    library: LIBRARIES.components,
  },
  projects: {
    slice: 'git_projects', titleKey: 'lists.projects.title', icon: 'open-folder',
    map: projectRecord, config: lang => sectionConfig(lang, projectsSpec), quickIcons: {},
  },
  // D-2026-MIG-REPOSITORY-ORGANIZATION: репозитории и организации — раздел «Система», паспорт (только чтение).
  repositories: {
    slice: 'repositories', titleKey: 'lists.repositories.title', icon: 'chest',
    map: repositoryRecord, config: lang => sectionConfig(lang, repositoriesSpec), quickIcons: {},
    defaultGroup: LORE_FILTER_FIELDS.project,
  },
  organizations: {
    slice: 'organizations', titleKey: 'lists.organizations.title', icon: 'castle',
    map: organizationRecord, config: lang => sectionConfig(lang, organizationsSpec), quickIcons: {},
    manageOnlyInAdmin: true,
  },
  tech: {
    slice: 'tech_registry', titleKey: 'lists.tech.title', icon: 'gears',
    defaultSort: FRESH_FIRST,
    map: techRecord, config: lang => withLibrary(withFeed(lang, sectionConfig(lang, techSpec), FEEDS.tech)), feed: FEEDS.tech, library: LIBRARIES.tech, quickIcons: {},
  },
  features: {
    modelType: 'feature',
    // `use_cases`, а НЕ `features`: второй по построению отбирает только корни
    // шкалы целей (`goal_level IN ['cloud','kite']`) — 8 строк при 31 вложенном
    // сценарии у них же (замер 10.11), то есть US в разделе не было вовсе.
    // Обязательного параметра у `use_cases` нет, предела выдачи тоже — обрезки
    // больше нет ни по уровню, ни по числу строк.
    //
    // Заголовок раздела при этом остался «Фичи» (`lists.features.title`,
    // `shell.sec.feature`): теперь он неточен — внутри и фичи, и US, — но
    // слова в меню выбирает владелица, а не этот файл.
    slice: 'use_cases', titleKey: 'lists.features.title', icon: 'gift-of-knowledge',
    defaultSort: FRESH_FIRST,
    map: featureRecord, config: lang => withFeed(lang, sectionConfig(lang, featuresSpec), FEEDS.features), feed: FEEDS.features, quickIcons: {},
    // Оговорка осталась, но про ДРУГУЮ, настоящую причину: компонент и проект
    // срез отдаёт только свои, а у вложенных сценариев они наследованные.
    note: UC_OWN_LINKS_NOTE,
  },
  // S4-PRODUCTS-NODE: продукты (паспорт v2 — тип product) и профиль клиента.
  products: {
    slice: 'products', titleKey: 'lists.products.title', icon: 'bullseye',
    map: productRecord, config: lang => sectionConfig(lang, productsSpec), quickIcons: {},
  },
  actors: {
    slice: 'actors', titleKey: 'lists.actors.title', icon: 'hooded-figure',
    map: actorRecord, config: lang => sectionConfig(lang, actorsSpec), quickIcons: {},
  },
  pains: {
    slice: 'pains', titleKey: 'lists.pains.title', icon: 'thorn-helix',
    map: painRecord, config: lang => sectionConfig(lang, painsSpec), quickIcons: {},
  },
  gains: {
    slice: 'gains', titleKey: 'lists.gains.title', icon: 'gift-of-knowledge',
    map: gainRecord, config: lang => sectionConfig(lang, gainsSpec), quickIcons: {},
  },
  jobs: {
    slice: 'jobs', titleKey: 'lists.jobs.title', icon: 'archery-target',
    map: jobRecord, config: lang => sectionConfig(lang, jobsSpec), quickIcons: {},
  },
} as const satisfies Record<string, ListScreenDef>;

export type ListScreenId = keyof typeof LIST_SCREENS;

/**
 * MC-09: срез раздела — из контракта модели (`surfaces.list.<type>`), если он пришёл; срез выше — умолчание на
 * случай, когда модели нет. Оформление (иконки, колонки, маппинг) остаётся своим. Тот же срез — тот же объект:
 * экран не перезагружает строки, когда модель подтвердила умолчание.
 */
export function withListContract<D extends ListScreenDef>(def: D, contract: ListContract | null | undefined): D {
  if (!contract || contract.slice === def.slice) return def;
  return { ...def, slice: contract.slice };
}

/** Экран раздела, у которого есть тип модели: modelType экрана или вид его паспорта (`kindOf`). */
function screenOfType(type: string, kindOf: (id: ListScreenId) => string | undefined): ListScreenDef | undefined {
  for (const id of Object.keys(LIST_SCREENS) as ListScreenId[]) {
    const def = LIST_SCREENS[id] as ListScreenDef;
    if ((def.modelType ?? kindOf(id)) === type) return def;
  }
  return undefined;
}

/**
 * Экран списка ЛЮБОГО типа модели: свой экран приложения со срезом из контракта; своего нет — экран, собранный
 * из одного контракта (тип пришёл новой моделью — без сборки клиента). Нет ни того ни другого — null.
 */
export function listScreenFor(type: string, model: unknown, kindOf: (id: ListScreenId) => string | undefined = () => undefined): ListScreenDef | null {
  const contract = listContractOf(model, type);
  const own = screenOfType(type, kindOf);
  if (own) return withListContract(own, contract);
  return contract ? contractScreen(type, contract) : null;
}
