// Экраны списков v2 — спринты и ADR (SPRINT_UXR_S4_UI_SHELL_LISTS/S4-04).
// Каждый экран — только конфиг kit (контракт kit/src/core/contract.ts) +
// слайс + маппинг строки; рисует всё движок списка kit (ListView). Нового
// экрана-списка (задачи, новости — MVP D-2026-UXR-MVP) хватит ещё одной записи.
import { createElement } from 'react';
import type { ReactNode } from 'react';
import { statusMeta } from '@seidr/kit';
import type { KitConfig, KitLang, KitProgressInput, KitRecord } from '@seidr/kit';
import type { LoreClient } from '../sprints/loreClient';
import { loadSprintProgress } from '../sprints/sprintProgress';
import { SprintTasks } from '../sprints/SprintTasks';
import { appT } from '../i18n';
import type { AppKey } from '../i18n';
import { adrRecord, sprintRecord } from './records';

type Category = KitConfig['statuses']['items'][number]['category'];

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
  titleKey: AppKey;
  icon: string;
  map: (row: Record<string, unknown>) => KitRecord;
  config: (lang: KitLang) => KitConfig;
  /** Свои быстрые иконки «Быстро», которым не подходит иконка статуса. */
  quickIcons: Record<string, string>;
  /**
   * Вложенное (S4-09, перенесено на общий путь в S4-22): колонка прогресса,
   * которая догружается после списка, и раскрытие строки. Раздел подключает
   * это описанием, а не своей страницей.
   */
  nested?: ListNested;
}

export interface ListNested {
  /** Поле записи с прогрессом «x/y» (колонка progress:<поле>). */
  progressField: string;
  loadProgress: (client: LoreClient, ids: readonly string[], signal: AbortSignal) => Promise<Map<string, KitProgressInput>>;
  /** Содержимое раскрытой строки; грузится лениво — по раскрытию. */
  render: (id: string, client: LoreClient) => ReactNode;
}

const BASE = { modules: [], menu: { groups: [] } } satisfies Pick<KitConfig, 'modules' | 'menu'>;

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
      views: ['list', 'board'],
      // S4-27: вид раздела по умолчанию — «открытые, закрытые внизу» (прототип v4).
      showClosed: 'below',
      quick: [
        { id: 'active', title: appT(lang, 'lists.status.active'), filter: { status: 'active' } },
        { id: 'blocked', title: appT(lang, 'lists.status.blocked'), filter: { status: 'blocked' } },
        { id: 'planned', title: appT(lang, 'lists.status.planned'), filter: { status: 'planned' } },
        { id: 'no-release', title: appT(lang, 'lists.quick.noRelease'), filter: { release: '' } },
      ],
      filters: ['status', 'project', 'components', 'release'],
      groupings: ['status', 'project', 'priority', 'milestone'],
      columns: ['title+id', 'progress:tasks', 'status', 'project', 'priority', 'release', 'updated_at'],
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
      views: ['list', 'board'],
      showClosed: 'below',
      quick: [
        { id: 'proposed', title: appT(lang, 'lists.status.proposed'), filter: { status: 'proposed' } },
        { id: 'accepted', title: appT(lang, 'lists.status.accepted'), filter: { status: 'accepted' } },
        { id: 'no-decisions', title: appT(lang, 'lists.quick.noDecisions'), filter: { decisions: '0' } },
      ],
      filters: ['status', 'component', 'project'],
      groupings: ['status', 'component', 'project'],
      columns: ['title+id', 'status', 'component', 'decisions', 'updated_at'],
    },
  };
}

export const LIST_SCREENS = {
  sprints: {
    slice: 'sprints', titleKey: 'lists.sprints.title', icon: 'sprint',
    map: sprintRecord, config: sprintsConfig, quickIcons: { 'no-release': 'wave-crest' },
    // Задачи x/y и раскрытие строки с задачами — как было у SprintsPage (S4-09).
    nested: {
      progressField: 'tasks',
      loadProgress: loadSprintProgress,
      render: (id, client) => createElement(SprintTasks, { sprintId: id, client }),
    },
  },
  adrs: {
    slice: 'adrs', titleKey: 'lists.adrs.title', icon: 'scroll-quill',
    map: adrRecord, config: adrsConfig, quickIcons: { 'no-decisions': 'laurel-crown' },
  },
} as const satisfies Record<string, ListScreenDef>;

export type ListScreenId = keyof typeof LIST_SCREENS;
