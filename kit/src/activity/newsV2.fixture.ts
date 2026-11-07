// Фикстура ответа GET /lore/news/v2 — собрана по контракту NewsV2Engine
// (feature/s7a-news-server-prep, f525c294), для вкладки «Активность» (S7A-06),
// пока сервер не на стенде. Числа метрик — образец формы ответа, не расчёт:
// клиент их только рисует. Неделя 2026-11-01…07, пояс Europe/Moscow.
import type { NewsV2Response, NewsV2TaskPart } from './newsV2';

const part = (p: Partial<NewsV2TaskPart>): NewsV2TaskPart => ({
  burn: 0, burn_dict: 0, ship_correction: 0, open_t0: 0, open_t1: 0, closed: 0, added: 0,
  waiting_t1: 0, ship_unknown: 0, shipped: 0, react: { events: 0, elements: 0, rate: null }, ...p,
});

export const NEWS_V2_FIXTURE: NewsV2Response = {
  events: [
    {
      key: 'task:SPRINT_UXR_S7A_NEWS/S7A-06|changed|2026-11-07', type: 'task', el: 'SPRINT_UXR_S7A_NEWS/S7A-06',
      el_key: 'task:SPRINT_UXR_S7A_NEWS/S7A-06', kind: 'changed', title: 'Вкладка «Активность» на паспортах',
      day_local: '2026-11-07', time_local: '21:40', at_utc: '2026-11-07T18:40:00Z', time_known: true, mult: 3,
      projects: ['unlimitedlore'], components: ['LORE-web'], sprint: 'SPRINT_UXR_S7A_NEWS', milestones: ['M-UXR-MVP'],
      groups_n: 1, author: 'agent', who: 'claude', from: 'todo', to: 'in_progress', parent: null, series: 's0',
      future: false, unread: true,
    },
    {
      key: 'task:SPRINT_UXR_S7A_NEWS/S7A-09|changed|2026-11-07', type: 'task', el: 'SPRINT_UXR_S7A_NEWS/S7A-09',
      el_key: 'task:SPRINT_UXR_S7A_NEWS/S7A-09', kind: 'changed', title: 'Сервер новостей v2',
      day_local: '2026-11-07', time_local: '20:48', at_utc: '2026-11-07T17:48:00Z', time_known: true, mult: 1,
      projects: ['unlimitedlore'], components: ['LORE-backend'], sprint: 'SPRINT_UXR_S7A_NEWS', milestones: ['M-UXR-MVP'],
      groups_n: 1, author: 'human', who: 'owner', from: 'in_progress', to: 'ready', parent: null, series: 's0',
      future: false, unread: true,
    },
    {
      key: 'spec:SPEC-LORE-UXR-NEWS-ALGORITHMS|version|2026-11-06', type: 'spec', el: 'SPEC-LORE-UXR-NEWS-ALGORITHMS',
      el_key: 'spec:SPEC-LORE-UXR-NEWS-ALGORITHMS', kind: 'version', title: 'Алгоритмы новостей 1.3.0',
      day_local: '2026-11-06', time_local: '16:05', at_utc: '2026-11-06T13:05:00Z', time_known: true, mult: 1,
      projects: ['unlimitedlore'], components: [], sprint: 'SPRINT_UXR_S7A_NEWS', milestones: ['M-UXR-MVP'],
      groups_n: 1, author: 'human', who: 'owner', from: '1.2.0', to: '1.3.0', parent: null, series: null,
      future: false, unread: false,
    },
    {
      key: 'decision:D-2026-UXR-NEWS-V2-RULES|created|2026-11-06', type: 'decision', el: 'D-2026-UXR-NEWS-V2-RULES',
      el_key: 'decision:D-2026-UXR-NEWS-V2-RULES', kind: 'created', title: 'Правила новостей v2',
      day_local: '2026-11-06', time_local: null, at_utc: null, time_known: false, mult: 1,
      projects: ['unlimitedlore'], components: [], sprint: null, milestones: [],
      groups_n: 1, author: 'unknown', who: null, from: null, to: 'accepted', parent: 'ADR-LORE-UXR', series: null,
      future: false, unread: false,
    },
    {
      key: 'task:SPRINT_UXR_S10_SEIDR_KIT/K-04|closed|2026-11-05', type: 'task', el: 'SPRINT_UXR_S10_SEIDR_KIT/K-04',
      el_key: 'task:SPRINT_UXR_S10_SEIDR_KIT/K-04', kind: 'closed', title: 'Каркас записи kit',
      day_local: '2026-11-05', time_local: '12:10', at_utc: '2026-11-05T09:10:00Z', time_known: true, mult: 2,
      projects: ['unlimitedlore'], components: ['seidr-kit'], sprint: 'SPRINT_UXR_S10_SEIDR_KIT', milestones: ['M-UXR-MVP'],
      groups_n: 1, author: 'agent', who: 'claude', from: 'ready', to: 'done', parent: null, series: null,
      future: false, unread: false,
    },
    {
      key: 'release:v1.16.0|released|2026-11-03', type: 'release', el: 'v1.16.0', el_key: 'release:v1.16.0',
      kind: 'released', title: 'v1.16.0', day_local: '2026-11-03', time_local: null, at_utc: null, time_known: false,
      mult: 1, projects: ['unlimitedlore'], components: [], sprint: null, milestones: [], groups_n: 1,
      author: 'unknown', who: null, from: null, to: null, parent: null, series: null, future: false, unread: false,
    },
  ],
  metrics: {
    counts: { total: { events: 9, elements: 6 } },
    tasks: {
      available: true,
      all: part({ burn: 3, ship_correction: 1, waiting_t1: 2, shipped: 1, closed: 2, react: { events: 1, elements: 1, rate: 0.2 } }),
      by_axis: {
        project: {
          groups: [{
            key: 'unlimitedlore',
            total: part({ burn: 3, ship_correction: 1, waiting_t1: 2, react: { events: 1, elements: 1 } }),
            own: part({ burn: 3, ship_correction: 1, waiting_t1: 2, react: { events: 1, elements: 1 } }),
            shared: part({}),
          }],
          burn_own_sum: 3, burn_shared_union: 0, burn_sigma: 3,
        },
        sprint: {
          groups: [
            {
              key: 'SPRINT_UXR_S7A_NEWS',
              total: part({ burn: 1, waiting_t1: 1 }),
              own: part({ burn: 1, waiting_t1: 1 }),
              shared: part({}),
            },
            {
              key: 'SPRINT_UXR_S10_SEIDR_KIT',
              total: part({ burn: 2, ship_correction: 1, waiting_t1: 1, react: { events: 1, elements: 1 } }),
              own: part({ burn: 2, ship_correction: 1, waiting_t1: 1, react: { events: 1, elements: 1 } }),
              shared: part({}),
            },
          ],
          burn_own_sum: 3, burn_shared_union: 0, burn_sigma: 3,
        },
        milestone: {
          groups: [{
            key: 'M-UXR-MVP',
            total: part({ burn: 3, ship_correction: 1, waiting_t1: 2, react: { events: 1, elements: 1 } }),
            own: part({ burn: 2, ship_correction: 1, waiting_t1: 1 }),
            shared: part({ burn: 1, waiting_t1: 1, react: { events: 1, elements: 1 } }),
          }],
          burn_own_sum: 2, burn_shared_union: 1, burn_sigma: 3,
        },
      },
    },
  },
  meta: {
    generated_at: '2026-11-07T19:00:00Z',
    period: { from: '2026-10-31T21:00:00Z', to: '2026-11-07T19:00:00Z', tz: 'Europe/Moscow', days_local: ['2026-11-01', '2026-11-07'] },
    total: { events: 9, elements: 6 },
    truncated: false,
    errors: [],
    state: 'ok',
    validation: { ok: true, checks: [], drift: [] },
    read_mark: { state: 'ok', at: '2026-11-07T12:00:00Z' },
    algorithm: 'SPEC-LORE-UXR-NEWS-ALGORITHMS 1.3.0',
  },
};
