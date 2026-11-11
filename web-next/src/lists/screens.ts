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
import { LORE_FILTER_FIELDS, STATUS_FACET } from './loreFilters';
import { appT } from '../i18n';
import { feedConfig, type FeedSpec } from './feed';
import type { AppKey } from '../i18n';
import {
  OPEN_ONLY_NOTE, UC_OWN_LINKS_NOTE,
  adrRecord, componentRecord, decisionRecord, featureRecord, milestoneRecord,
  questionRecord, releaseRecord, specRecord, sprintRecord, taskListRecord, techRecord,
} from './records';

type Category = KitConfig['statuses']['items'][number]['category'];

/** Свежие сверху — умолчание раздела, где у записи есть время (см. ListScreenDef.defaultSort). */
const FRESH_FIRST: ListSort = { key: 'updated_at', dir: 'desc' };

/** Иконки и цвета статусов, которых нет в общей таблице kit (statusMeta). */
const OWN_META: Record<string, { icon: string; color: string }> = {
  draft: { icon: 'quill-ink', color: 'var(--st-deferred)' },
  deprecated: { icon: 'broken-tablet', color: 'var(--st-cancelled)' },
};

function statusItems(lang: KitLang, codes: [code: string, category: Category][]): KitConfig['statuses']['items'] {
  return codes.map(([code, category]) => {
    const own = OWN_META[code];
    const m = statusMeta(code);
    return {
      code,
      title: appT(lang, `lists.status.${code}` as AppKey),
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
  map: (row: Record<string, unknown>) => KitRecord;
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
   * Лента раздела (K2-FEED-VIEW): то же описание, из которого собран
   * `list.feed` конфига, — экрану оно нужно, чтобы отдать kit тело записи и
   * нижний уровень. Нет — у записи раздела нет времени, ленты нет.
   */
  feed?: FeedSpec;
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
  /** Заплатки полей по id записи: имя поля → значение. */
  load: (client: LoreClient, ids: readonly string[], signal: AbortSignal) => Promise<Map<string, Record<string, unknown>>>;
  /** Содержимое раскрытой строки; грузится лениво — по раскрытию. */
  render: (id: string, client: LoreClient) => ReactNode;
}

const BASE = { modules: [], menu: { groups: [] } } satisfies Pick<KitConfig, 'modules' | 'menu'>;

/**
 * Лента разделов (K2-FEED-VIEW): поле сути, повод и нижний уровень — по
 * разделу. Ключ — раздел, у которого у записи ЕСТЬ время (`updated_at` из
 * `changed_at`); вехам и компонентам времени срез не даёт — ленты у них нет, и
 * поле не выдумывается.
 *
 * Имена md-полей — те же, что в строке среза и в `values` паспорта
 * (`LoreRecordRegistry`): у спринта context_md, у задачи note_md, у ADR
 * контекст и решение, у спеки текст, у решения суть и обоснование.
 */
export const FEEDS = {
  sprints: {
    lead: ['context_md'], inRow: true,
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
  adrs: { lead: ['context_md', 'decision_md'], because: ['DEPENDS_ON', 'SUPERSEDES'] },
  tasks: { lead: ['note_md'], because: ['JUSTIFIED_BY', 'GATES'] },
  decisions: {
    lead: ['body_md', 'rationale_md'], because: ['DECIDED_IN', 'ANSWERS'],
    becauseFields: { DECIDED_IN: 'adr' },
  },
  specs: { lead: ['content_md'] },
  questions: {
    lead: ['body_md'], inRow: true, because: ['RAISED_IN', 'GATES'],
    becauseFields: { GATES: 'gates', RAISED_IN: 'adr' },
  },
  releases: { lead: ['description_md'], inRow: true },
  tech: { lead: ['content_md'], inRow: true },
  features: { lead: ['body_md', 'context_md'] },
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
          { key: 'project', title: f(lang, 'project'), type: 'ref' },
          { key: 'components', title: f(lang, 'components'), type: 'ref' },
          { key: 'release', title: f(lang, 'release'), type: 'ref' },
          { key: 'milestone', title: f(lang, 'milestone'), type: 'ref' },
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
        ['active', 'active'], ['partial', 'active'], ['blocked', 'active'], ['ready_for_deploy', 'active'],
        ['done', 'done'], ['cancelled', 'cancelled'],
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
      groupings: ['status', 'project', 'priority', 'milestone', 'release'],
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
          { key: 'component', title: f(lang, 'component'), type: 'ref' },
          { key: 'components', title: f(lang, 'components'), type: 'ref' },
          { key: 'project', title: f(lang, 'project'), type: 'ref' },
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
      filters: [STATUS_FACET, LORE_FILTER_FIELDS.component, LORE_FILTER_FIELDS.project],
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
 * Цена выбора названа словами (`OPEN_ONLY_NOTE`): закрытых задач в этой выдаче
 * не бывает, поэтому режим «закрытые внизу» разделу не ставится — обещать
 * сортировку того, чего нет, нельзя.
 */
function tasksConfig(lang: KitLang): KitConfig {
  return {
    ...BASE,
    kinds: {
      task: {
        title: appT(lang, 'lists.tasks.title'), icon: ICON_CANON.sectionTask,
        fields: [
          { key: 'sprint', title: f(lang, 'sprint'), type: 'ref' },
          { key: 'components', title: f(lang, 'components'), type: 'ref' },
          { key: 'release', title: f(lang, 'release'), type: 'ref' },
          { key: 'effort', title: f(lang, 'effort'), type: 'number' },
        ],
      },
    },
    statuses: {
      items: statusItems(lang, [
        ['backlog', 'todo'], ['planned', 'todo'], ['design', 'todo'], ['todo', 'todo'],
        ['active', 'active'], ['partial', 'active'], ['blocked', 'active'], ['ready_for_deploy', 'active'],
        ['done', 'done'], ['cancelled', 'cancelled'],
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
      filters: [STATUS_FACET, LORE_FILTER_FIELDS.release, LORE_FILTER_FIELDS.sprint, LORE_FILTER_FIELDS.component],
      groupings: ['status', LORE_FILTER_FIELDS.release, LORE_FILTER_FIELDS.sprint],
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
  fields: [key: string, type: 'text' | 'ref' | 'number' | 'date'][];
  statuses?: [code: string, category: Category][];
  views?: NonNullable<KitConfig['list']>['views'];
  showClosed?: NonNullable<KitConfig['list']>['showClosed'];
  quick?: [id: string, titleKey: AppKey, filter: Record<string, string>][];
  filters: string[];
  groupings: string[];
  collapsedGroupings?: string[];
  columns: string[];
}

function sectionConfig(lang: KitLang, spec: SectionSpec): KitConfig {
  return {
    ...BASE,
    kinds: {
      [spec.kind]: {
        title: appT(lang, spec.titleKey), icon: spec.icon,
        fields: spec.fields.map(([key, type]) => ({ key, title: f(lang, key), type })),
      },
    },
    statuses: { items: statusItems(lang, spec.statuses ?? []) },
    list: {
      views: spec.views ?? ['list', 'cards'],
      ...(spec.showClosed ? { showClosed: spec.showClosed } : {}),
      ...(spec.quick ? { quick: spec.quick.map(([id, titleKey, filter]) => ({ id, title: appT(lang, titleKey), filter })) } : {}),
      filters: spec.filters,
      groupings: spec.groupings,
      ...(spec.collapsedGroupings ? { collapsedGroupings: spec.collapsedGroupings } : {}),
      columns: spec.columns,
    },
  };
}

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
  filters: [STATUS_FACET, LORE_FILTER_FIELDS.component, LORE_FILTER_FIELDS.project],
  groupings: ['status', LORE_FILTER_FIELDS.component, 'fields.adr'],
  columns: ['id', 'title', 'status', 'component', 'adr', 'updated_at'],
};

/**
 * Спеки: статус пуст у 353 строк из 390 (90%). Поэтому разрез по умолчанию —
 * компонент: группировка по статусу сложила бы почти всё в «неизвестно».
 */
const specsSpec: SectionSpec = {
  kind: 'spec', titleKey: 'lists.specs.title', icon: 'scroll-unfurled',
  fields: [['component', 'ref'], ['version', 'text'], ['path', 'text'], ['project', 'ref']],
  statuses: [['proposed', 'active'], ['accepted', 'done'], ['deprecated', 'cancelled'], ['superseded', 'cancelled']],
  views: ['list', 'cards'],
  quick: [['no-status', 'lists.quick.noStatus', { status: '' }], ['no-version', 'lists.quick.noVersion', { version: '' }]],
  filters: [STATUS_FACET, LORE_FILTER_FIELDS.component, LORE_FILTER_FIELDS.project],
  groupings: [LORE_FILTER_FIELDS.component, 'status'],
  columns: ['id', 'title', 'status', 'component', 'version', 'updated_at'],
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

/** Вехи: СТАТУСА НЕТ — ни колонки, ни фасета статуса (K-14). */
const milestonesSpec: SectionSpec = {
  kind: 'milestone', titleKey: 'lists.milestones.title', icon: 'crossed-axes',
  fields: [['week', 'number'], ['when', 'text'], ['priority', 'text'], ['products', 'ref'], ['sprints', 'ref']],
  views: ['list', 'cards'],
  quick: [['critical', 'lists.quick.critical', { priority: 'critical' }], ['no-sprints', 'lists.quick.noSprints', { sprints: '' }]],
  filters: [LORE_FILTER_FIELDS.priority, 'fields.products'],
  groupings: ['fields.products', LORE_FILTER_FIELDS.priority],
  columns: ['id', 'title', 'when', 'priority', 'products', 'sprints'],
};

/** Релизы: СТАТУСА НЕТ; есть вид (релиз/хотфикс) и признак текущего. */
const releasesSpec: SectionSpec = {
  kind: 'release', titleKey: 'lists.releases.title', icon: 'open-book',
  fields: [
    ['version', 'text'], ['type', 'text'], ['week', 'number'], ['current', 'text'],
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
};

/** Технологии: СТАТУСА НЕТ — это реестр версий (спеки SPEC-TECH-*). */
const techSpec: SectionSpec = {
  kind: 'tech', titleKey: 'lists.tech.title', icon: 'gears',
  fields: [['version', 'text'], ['component', 'ref'], ['checked', 'date']],
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
};

export const LIST_SCREENS = {
  sprints: {
    modelType: 'sprint',
    slice: 'sprints', titleKey: 'lists.sprints.title', icon: 'sprint',
    defaultSort: FRESH_FIRST,
    map: sprintRecord, config: lang => withFeed(lang, sprintsConfig(lang), FEEDS.sprints), feed: FEEDS.sprints, // S4-25: у «без релиза» иконки нет (выбор владелицы; подбор вне наборов — S4-32).
    quickIcons: {},
    // Итоги спринта: задач x/y, оценка Σ дн, факт Σ дн — одним запросом к
    // `sprint_totals` (S4-09). Считает сервер: одно число из двух мест
    // расходится, и у kit это уже случилось со статусными цветами (K-14).
    nested: {
      lateFields: TOTALS_FIELDS,
      load: loadSprintTotals,
      render: (id, client) => createElement(SprintTasks, { sprintId: id, client }),
    },
  },
  adrs: {
    modelType: 'adr',
    slice: 'adrs', titleKey: 'lists.adrs.title', icon: 'scroll-quill',
    defaultSort: FRESH_FIRST,
    map: adrRecord, config: lang => withFeed(lang, adrsConfig(lang), FEEDS.adrs), feed: FEEDS.adrs, quickIcons: { 'no-decisions': ICON_CANON.quickNoDecisions },
  },
  tasks: {
    modelType: 'task',
    slice: 'open_tasks', titleKey: 'lists.tasks.title', icon: ICON_CANON.sectionTask,
    defaultSort: FRESH_FIRST,
    map: taskListRecord, config: lang => withFeed(lang, tasksConfig(lang), FEEDS.tasks), feed: FEEDS.tasks, quickIcons: {},
    // Срез отдаёт только открытые задачи — это сказано словами на экране.
    note: OPEN_ONLY_NOTE,
  },
  decisions: {
    modelType: 'decision',
    slice: 'decisions', titleKey: 'lists.decisions.title', icon: 'gavel',
    defaultSort: FRESH_FIRST,
    map: decisionRecord, config: lang => withFeed(lang, sectionConfig(lang, decisionsSpec), FEEDS.decisions), feed: FEEDS.decisions, quickIcons: {},
  },
  specs: {
    modelType: 'spec',
    slice: 'specs', titleKey: 'lists.specs.title', icon: 'scroll-unfurled',
    defaultSort: FRESH_FIRST,
    map: specRecord, config: lang => withFeed(lang, sectionConfig(lang, specsSpec), FEEDS.specs), feed: FEEDS.specs, quickIcons: {},
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
    map: milestoneRecord, config: lang => sectionConfig(lang, milestonesSpec), quickIcons: {},
  },
  releases: {
    slice: 'releases', titleKey: 'lists.releases.title', icon: 'open-book',
    defaultSort: FRESH_FIRST,
    map: releaseRecord, config: lang => withFeed(lang, sectionConfig(lang, releasesSpec), FEEDS.releases), feed: FEEDS.releases, quickIcons: {},
  },
  components: {
    slice: 'components', titleKey: 'lists.components.title', icon: 'cog',
    map: componentRecord, config: lang => sectionConfig(lang, componentsSpec), quickIcons: {},
  },
  tech: {
    slice: 'tech_registry', titleKey: 'lists.tech.title', icon: 'gears',
    defaultSort: FRESH_FIRST,
    map: techRecord, config: lang => withFeed(lang, sectionConfig(lang, techSpec), FEEDS.tech), feed: FEEDS.tech, quickIcons: {},
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
} as const satisfies Record<string, ListScreenDef>;

export type ListScreenId = keyof typeof LIST_SCREENS;
