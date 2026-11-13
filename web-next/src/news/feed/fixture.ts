// Фикстура ответа GET /lore/news/v2 по контракту f525c294 (NewsV2Engine.compute).
// Нужна, пока эндпоинт не на стенде (сервер сливается после S2 — решение
// владелицы 07.11.2026): экран новостей v2 работает на ней за флагом, переход
// на живой API — одна строка (web-next/src/news/source.ts).
//
// Числа здесь — ДАННЫЕ ответа, а не расчёт клиента: они подобраны так, чтобы
// выполнялись инварианты SPEC-LORE-UXR-NEWS-ALGORITHMS 1.3.0 (§10) и на экране
// были видны все разрезы: мультипроектный спринт (×N, Σ ≠ ∪), день без
// времени, будущее, «ждёт выкатки», поправка выкатки, реактивация,
// неизмеримые метрики (S2-12, S2-13), «не смогли проверить».
import type { NewsBurnPart, NewsEvent, NewsResponse, NewsTriple } from './types';

const ULORE = 'NooriUta/UnlimitedLORE';
const VOLVA = 'NooriUta/volva';
const AIDA = 'NooriUta/AIDA';
const NEWS_SPRINT = 'SPRINT_UXR_S7A_NEWS';

function ev(p: Partial<NewsEvent> & Pick<NewsEvent, 'type' | 'el' | 'kind' | 'day_local'>): NewsEvent {
  const timed = p.at_utc != null;
  return {
    key: `${p.type}:${p.el}|${p.kind}|${p.day_local}`,
    el_key: `${p.type}:${p.el}`,
    title: null,
    time_local: null,
    at_utc: null,
    time_known: timed,
    mult: 1,
    projects: [ULORE],
    components: ['FORSETI'],
    sprint: null,
    milestones: [],
    groups_n: 1,
    author: 'unknown',
    who: null,
    from: null,
    to: null,
    parent: null,
    series: null,
    future: false,
    unread: false,
    ...p,
  };
}

const tr = (events: number, elements: number, rows: number): NewsTriple => ({ events, elements, rows });

function part(p: Partial<NewsBurnPart>): NewsBurnPart {
  return {
    burn: 0, burn_dict: 0, ship_correction: 0,
    open_t0: 0, open_t1: 0, open_dict_t0: 0, open_dict_t1: 0,
    closed: 0, added: 0, added_new: 0, added_react: 0,
    waiting_t0: 0, waiting_t1: 0, uat_t0: 0, uat_t1: 0, ship_unknown: 0, shipped: 0, done_in_period: 0,
    react: { events: 0, elements: 0, rate: null, done_ever: 0, from_ready: 0, from_closed: 0, after_release: 0, examples: [] },
    unknown: 0, tasks: 0,
    examples: { shipped: [], waiting: [], added: [], closed: [], uat: [] },
    ...p,
  };
}

const ALL = part({
  burn: 3, burn_dict: 4, ship_correction: -1,
  open_t0: 40, open_t1: 37, open_dict_t0: 38, open_dict_t1: 34,
  closed: 5, added: 2, added_new: 1, added_react: 1,
  waiting_t0: 2, waiting_t1: 3, ship_unknown: 1, shipped: 1, done_in_period: 4,
  react: { events: 1, elements: 1, rate: 0.25, done_ever: 4, from_ready: 0, from_closed: 1, after_release: 0, examples: ['VOLVA_V/V-7'] },
  tasks: 60,
  examples: { shipped: ['SPRINT_UXR_S4/S4-12'], waiting: [`${NEWS_SPRINT}/S7A-02`], added: ['SPRINT_AIDA_X/A-3'], closed: [`${NEWS_SPRINT}/S7A-04`] },
});

export const NEWS_FIXTURE: NewsResponse = {
  events: [
    ev({
      type: 'release', el: 'v1.17.0', kind: 'released', title: 'v1.17.0', day_local: '2026-11-08',
      future: true,
    }),
    ev({
      type: 'task', el: `${NEWS_SPRINT}/S7A-02`, kind: 'ready', title: 'Группировка и фильтры новостей',
      day_local: '2026-11-07', time_local: '17:42', at_utc: '2026-11-07T14:42:00Z',
      projects: [ULORE, VOLVA], sprint: NEWS_SPRINT, milestones: ['M-UXR-MVP'], groups_n: 2,
      from: 'in_progress', to: 'ready_for_deploy', unread: true,
    }),
    ev({
      type: 'task', el: `${NEWS_SPRINT}/S7A-04`, kind: 'closed', title: 'Черта «прочитано» на сервере',
      day_local: '2026-11-07', time_local: '16:10', at_utc: '2026-11-07T13:10:00Z', mult: 2,
      projects: [ULORE, VOLVA], sprint: NEWS_SPRINT, milestones: ['M-UXR-MVP'], groups_n: 2,
      from: 'ready_for_deploy', to: 'done', series: 's0',
    }),
    ev({
      type: 'spec', el: 'SPEC-LORE-UXR-NEWS-ALGORITHMS', kind: 'version', title: 'Новости v2: алгоритмы единого сервиса',
      day_local: '2026-11-07', time_local: '15:00', at_utc: '2026-11-07T12:00:00Z', to: '1.3.0',
    }),
    ev({ type: 'release', el: 'v1.16.0', kind: 'released', title: 'v1.16.0', day_local: '2026-11-07' }),
    ev({
      type: 'decision', el: 'D-2026-UXR-NEWS-V2-RULES', kind: 'created', title: 'Лента новостей v2: правила',
      day_local: '2026-11-07', time_local: '11:05', at_utc: '2026-11-07T08:05:00Z', parent: 'ADR-LORE-045', to: 'accepted',
    }),
    ev({
      type: 'adr', el: 'ADR-LORE-045', kind: 'changed', title: 'Единый сервис новостей',
      day_local: '2026-11-06', time_local: '19:20', at_utc: '2026-11-06T16:20:00Z',
    }),
    ev({
      type: 'task', el: 'VOLVA_V/V-7', kind: 'reactivated', title: 'Импорт истории',
      day_local: '2026-11-06', time_local: '10:00', at_utc: '2026-11-06T07:00:00Z',
      projects: [VOLVA], components: ['VOLVA'], sprint: 'VOLVA_V', from: 'done', to: 'in_progress',
    }),
    // 01:30 по Москве 06.11 — это ещё 05.11 по UTC: местный день и время машины расходятся.
    ev({
      type: 'sprint', el: 'SPRINT_AIDA_X', kind: 'created', title: 'AIDA: X',
      day_local: '2026-11-06', time_local: '01:30', at_utc: '2026-11-05T22:30:00Z',
      projects: [AIDA], components: ['AIDA'], sprint: 'SPRINT_AIDA_X',
    }),
    ev({
      type: 'task', el: 'SPRINT_AIDA_X/A-3', kind: 'created', title: 'Схема хранилища',
      day_local: '2026-11-05', time_local: '23:30', at_utc: '2026-11-05T20:30:00Z',
      projects: [AIDA], components: ['AIDA'], sprint: 'SPRINT_AIDA_X',
    }),
    ev({
      type: 'task', el: 'SPRINT_AIDA_X/A-2', kind: 'cancelled', title: 'Старый импорт',
      day_local: '2026-11-05', time_local: '14:00', at_utc: '2026-11-05T11:00:00Z',
      projects: [AIDA], components: ['AIDA'], sprint: 'SPRINT_AIDA_X', from: 'todo', to: 'cancelled',
    }),
  ],
  groups: {
    axis: 'project',
    element_level: true,
    list: [
      { key: ULORE, events: 8, elements: 7, multi: 2, agent_events: 0, agent_elements: 0, filter: { project: ULORE } },
      { key: VOLVA, events: 4, elements: 3, multi: 2, agent_events: 0, agent_elements: 0, filter: { project: VOLVA } },
      { key: AIDA, events: 3, elements: 3, multi: 0, agent_events: 0, agent_elements: 0, filter: { project: AIDA } },
    ],
    total: { events: 12, elements: 11 },
    sum: { events: 15, elements: 13 },
    multi_group_elements: 2,
    extra: 2,
  },
  // Свёртки дня (S7A-09) — данные ответа, согласованные со строками выше и с matrix.rows.
  days: [
    {
      day: '2026-11-08', total: { events: 1, elements: 1 }, rows: 1, axis: 'project',
      by_kind: { released: tr(1, 1, 1) },
      by_type: { release: { ...tr(1, 1, 1), by_kind: { released: tr(1, 1, 1) } } },
      groups: [{ key: ULORE, ...tr(1, 1, 1) }],
    },
    {
      day: '2026-11-07', total: { events: 6, elements: 5 }, rows: 5, axis: 'project',
      by_kind: { closed: tr(2, 1, 1), created: tr(1, 1, 1), ready: tr(1, 1, 1), released: tr(1, 1, 1), version: tr(1, 1, 1) },
      by_type: {
        decision: { ...tr(1, 1, 1), by_kind: { created: tr(1, 1, 1) } },
        release: { ...tr(1, 1, 1), by_kind: { released: tr(1, 1, 1) } },
        spec: { ...tr(1, 1, 1), by_kind: { version: tr(1, 1, 1) } },
        task: { ...tr(3, 2, 2), by_kind: { closed: tr(2, 1, 1), ready: tr(1, 1, 1) } },
      },
      groups: [{ key: ULORE, ...tr(6, 5, 5) }, { key: VOLVA, ...tr(3, 2, 2) }],
    },
    {
      day: '2026-11-06', total: { events: 3, elements: 3 }, rows: 3, axis: 'project',
      by_kind: { changed: tr(1, 1, 1), created: tr(1, 1, 1), reactivated: tr(1, 1, 1) },
      by_type: {
        adr: { ...tr(1, 1, 1), by_kind: { changed: tr(1, 1, 1) } },
        sprint: { ...tr(1, 1, 1), by_kind: { created: tr(1, 1, 1) } },
        task: { ...tr(1, 1, 1), by_kind: { reactivated: tr(1, 1, 1) } },
      },
      groups: [{ key: AIDA, ...tr(1, 1, 1) }, { key: ULORE, ...tr(1, 1, 1) }, { key: VOLVA, ...tr(1, 1, 1) }],
    },
    {
      day: '2026-11-05', total: { events: 2, elements: 2 }, rows: 2, axis: 'project',
      by_kind: { cancelled: tr(1, 1, 1), created: tr(1, 1, 1) },
      by_type: { task: { ...tr(2, 2, 2), by_kind: { cancelled: tr(1, 1, 1), created: tr(1, 1, 1) } } },
      groups: [{ key: AIDA, ...tr(2, 2, 2) }],
    },
  ],
  metrics: {
    counts: {
      total: { events: 12, elements: 11 },
      by_type: {
        adr: { events: 1, elements: 1 }, decision: { events: 1, elements: 1 }, release: { events: 2, elements: 2 },
        spec: { events: 1, elements: 1 }, sprint: { events: 1, elements: 1 }, task: { events: 6, elements: 5 },
      },
      by_kind: {
        cancelled: { events: 1, elements: 1 }, changed: { events: 1, elements: 1 }, closed: { events: 2, elements: 1 },
        created: { events: 3, elements: 3 }, reactivated: { events: 1, elements: 1 }, ready: { events: 1, elements: 1 },
        released: { events: 2, elements: 2 }, version: { events: 1, elements: 1 },
      },
    },
    tasks: {
      available: true,
      all: ALL,
      by_axis: {
        project: {
          groups: [
            { key: ULORE, total: part({ burn: 2, waiting_t1: 1, shipped: 1 }), own: part({ burn: 1, shipped: 1 }), shared: part({ burn: 1, waiting_t1: 1 }), filter: { project: ULORE } },
            { key: VOLVA, total: part({ burn: 1, waiting_t1: 2, ship_correction: -1 }), own: part({ burn: 0, waiting_t1: 1 }), shared: part({ burn: 1, waiting_t1: 1 }), filter: { project: VOLVA } },
            { key: AIDA, total: part({ burn: 1 }), own: part({ burn: 1 }), shared: part({}), filter: { project: AIDA } },
          ],
          burn_own_sum: 2,
          burn_shared_union: 1,
          burn_sigma: 3,
        },
      },
      days: [
        { from: '2026-11-04T21:00:00Z', to: '2026-11-05T21:00:00Z', day_local: '2026-11-05', open_start: 40, open_end: 40, burn: 0, burn_dict: 0, waiting_end: 2, ship_unknown_end: 1, shipped: 0 },
        { from: '2026-11-05T21:00:00Z', to: '2026-11-06T21:00:00Z', day_local: '2026-11-06', open_start: 40, open_end: 39, burn: 1, burn_dict: 1, waiting_end: 2, ship_unknown_end: 1, shipped: 1 },
        { from: '2026-11-06T21:00:00Z', to: '2026-11-07T17:30:00Z', day_local: '2026-11-07', open_start: 39, open_end: 37, burn: 2, burn_dict: 3, waiting_end: 3, ship_unknown_end: 1, shipped: 0 },
      ],
      shipped_list: [
        { uid: 'SPRINT_UXR_S4/S4-12', sprint: 'SPRINT_UXR_S4', ready: '2026-11-05', release: 'v1.16.0', release_date: '2026-11-06', days: 1, now: 'closed' },
      ],
      wait_median_days: 1,
      waiting_oldest: [
        { uid: 'VOLVA_V/V-5', sprint: 'VOLVA_V', since: '2026-11-03T09:00:00Z', age_days: 4, ship: 'unknown', link: null },
        { uid: `${NEWS_SPRINT}/S7A-02`, sprint: NEWS_SPRINT, since: '2026-11-07T14:42:00Z', age_days: 0, ship: 'pending', link: 'v1.17.0' },
      ],
      entered_ready: 2,
      entered_uat: 0,
      ready_to_closed_no_release: 1,
    },
    knowledge: {
      adr: {
        exact: false, q_t1: 5, q_t0_range: [4, 6], flow_range: [-1, 1],
        reason: 'нет истории статуса — точное значение после task:SPRINT_UXR_S2_GRAPH_MEMORY/S2-10 и S2-13',
        new: 1, new_proposed: 1, new_decided: 0, superseded_now: 0, superseded_new: 0, accepted_now: 12, no_date: 0,
        ttd: { measurable: false, reason: 'момент принятия неизвестен до S2-13' },
      },
      decision: {
        exact: true, q_t1: 4, q_t0: 3, flow: 1,
        new: 1, new_proposed: 0, new_decided: 1, superseded_now: 0, superseded_new: 0, accepted_now: 30, no_date: 0,
        ttd: null,
      },
      adr_revisions: { events: 1, elements: 1 },
      adr_changes: { events: 1, elements: 1 },
      spec_versions: { events: 1, elements: 1 },
      spec_new: 0,
      decisions_per_new_adr: [],
      adr_reactivation: { measurable: false, reason: 'у ADR нет истории статуса — task:SPRINT_UXR_S2_GRAPH_MEMORY/S2-13' },
    },
    agents: { measurable: false, reason: 'автор версии не хранится — task:SPRINT_UXR_S2_GRAPH_MEMORY/S2-12' },
    delta: {
      events: { value: 12, previous: 9, delta: 3, pct: 33.3 },
      elements: { value: 11, previous: 10, delta: 1, pct: 10 },
      by_type: { task: { value: 6, previous: 5, delta: 1, pct: 20 } },
      burn: { value: 3, previous: 5, delta: -2, pct: -40 },
      waiting_t1: { value: 3, previous: 2, delta: 1, pct: null },
      shipped: { value: 1, previous: 3, delta: -2, pct: null },
      react_events: { value: 1, previous: 0, delta: 1, pct: null },
      react_elements: { value: 1, previous: 0, delta: 1, pct: null },
      previous: { from: '2026-10-29T21:00:00Z', to: '2026-10-31T17:30:00Z' },
    },
    since_mark: { events: 1, elements: 1, mark: '2026-11-07T14:00:00Z' },
  },
  matrix: {
    n: 6,
    cols: [ULORE, VOLVA, AIDA],
    rows: [
      { day: '2026-11-05', cells: [[0, 0], [0, 0], [2, 2]], total: { events: 2, elements: 2 }, sum: { events: 2, elements: 2 }, multi: 0, extra: 0 },
      { day: '2026-11-06', cells: [[1, 1], [1, 1], [1, 1]], total: { events: 3, elements: 3 }, sum: { events: 3, elements: 3 }, multi: 0, extra: 0 },
      { day: '2026-11-07', cells: [[6, 5], [3, 2], [0, 0]], total: { events: 6, elements: 5 }, sum: { events: 9, elements: 7 }, multi: 2, extra: 2 },
      { day: '2026-11-08', cells: [[1, 1], [0, 0], [0, 0]], total: { events: 1, elements: 1 }, sum: { events: 1, elements: 1 }, multi: 0, extra: 0 },
    ],
    col_totals: [
      { col: ULORE, total: { events: 8, elements: 7 }, sum: { events: 8, elements: 7 }, multi: 0, extra: 0 },
      { col: VOLVA, total: { events: 4, elements: 3 }, sum: { events: 4, elements: 3 }, multi: 0, extra: 0 },
      { col: AIDA, total: { events: 3, elements: 3 }, sum: { events: 3, elements: 3 }, multi: 0, extra: 0 },
    ],
    projects: 3,
    total: { events: 12, elements: 11 },
    sum_rows: { events: 12, elements: 11 },
  },
  meta: {
    generated_at: '2026-11-07T17:30:00Z',
    scope: { applied: false },
    period: { from: '2026-11-04T21:00:00Z', to: '2026-11-07T17:30:00Z', tz: 'Europe/Moscow', days_local: ['2026-11-05', '2026-11-07'] },
    total: { events: 12, elements: 11 },
    multi_group_elements: 2,
    truncated: false,
    errors: [],
    state: 'ok',
    validation: {
      ok: true,
      checks: [
        { inv: '1', name: 'N_ev ≥ N_el — project', ok: true, detail: 'групп 3, итог 12 · 11', examples: [] },
        { inv: '3', name: 'Σ N_el(g) − N_el = Σ(|G(x)|−1) — project', ok: true, detail: '13 − 11 = 2; Σ(|G|−1) = 2; M = 2', examples: [] },
        { inv: '11', name: 'Burn_g = своё + общее; итог = Σ своих + объединение общих', ok: true, detail: 'осей 1', examples: [] },
        { inv: '7.2a', name: 'выкатка определена для всех ждущих задач', ok: null, detail: 'не смогли определить выкатку у 1 из 2 ждущих: у спринта нет связи с релизом', examples: [] },
      ],
      drift: [],
    },
    dropped_changed_on_created_day: 1,
    algorithm: 'SPEC-LORE-UXR-NEWS-ALGORITHMS 1.3.0',
    read_mark: { state: 'ok', at: '2026-11-07T14:00:00Z' },
  },
};
