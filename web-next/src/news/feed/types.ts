// Контракт GET /lore/news/v2 (SPRINT_UXR_S7A_NEWS/S7A-02, сервер — S7A-09,
// ветка feature/s7a-news-server-prep, f525c294: NewsV2Engine.compute).
// Только типы: все числа считает сервер (SPEC-LORE-UXR-NEWS-ALGORITHMS 1.3.0),
// клиент их рисует и ни одного не выводит сам.

/** Оси группировки и фильтра — NewsV2Engine.AXES. */
/** `record` (S9-11) — свёртка по записи: ключ группы «тип:код» элемента события. */
export const NEWS_AXES = ['project', 'component', 'type', 'kind', 'sprint', 'milestone', 'author', 'who', 'day', 'record'] as const;
export type NewsAxis = (typeof NEWS_AXES)[number];

/** Оси, по которым фильтрует сервер (day — только разрез, фильтра у него нет). */
export const NEWS_FILTER_AXES = ['type', 'project', 'component', 'sprint', 'milestone', 'author', 'who', 'kind'] as const;
export type NewsFilterAxis = (typeof NEWS_FILTER_AXES)[number];

/** Оси сгорания задач (§7.2, TASK_AXES). */
export const NEWS_TASK_AXES = ['project', 'sprint', 'component', 'milestone'] as const;
export type NewsTaskAxis = (typeof NEWS_TASK_AXES)[number];

export type NewsType = 'task' | 'sprint' | 'release' | 'adr' | 'decision' | 'spec' | 'question' | (string & {});
export type NewsKind =
  | 'created' | 'changed' | 'status' | 'ready' | 'reactivated' | 'closed' | 'cancelled' | 'released' | 'version'
  | (string & {});

/** Пара «события · элементы» (§2, двойной счёт). */
export interface NewsPair { events: number; elements: number }

export interface NewsEvent {
  key: string;
  type: NewsType;
  el: string;
  el_key: string;
  kind: NewsKind;
  title: string | null;
  day_local: string;
  /** HH:MM в поясе запроса; null — у записи только дата (время не выдумывается). */
  time_local: string | null;
  /** Момент машины (UTC) — рядом с местным (D-2026-UXR-NEWS-V2-RULES, п. 3). */
  at_utc: string | null;
  time_known: boolean;
  /** Свёрнуто событий в строку (×N дедупа дня, §6). */
  mult: number;
  projects: string[] | null;
  components: string[] | null;
  sprint: string | null;
  milestones: string[] | null;
  /** В скольких группах текущей оси стоит элемент (мультипринадлежность, ×N). */
  groups_n: number;
  author: 'agent' | 'human' | 'unknown';
  who: string | null;
  from: string | null;
  to: string | null;
  parent: string | null;
  series: string | null;
  future: boolean;
  /** Есть только при черте «прочитано». */
  unread?: boolean;
}

export interface NewsSubGroups {
  axis: NewsAxis;
  groups: Array<{ key: string; events: number; elements: number; multi: number }>;
  total: NewsPair;
  multi_group_elements: number;
}

export interface NewsGroup {
  key: string;
  events: number;
  elements: number;
  multi: number;
  agent_events: number;
  agent_elements: number;
  filter: Partial<Record<NewsAxis, string>>;
  sub?: NewsSubGroups;
}

export interface NewsGroups {
  axis: NewsAxis;
  element_level: boolean;
  list: NewsGroup[];
  /** Итог — объединение (∪): элемент нескольких групп считается один раз. */
  total: NewsPair;
  /** Сумма групп (Σ): ≠ итогу ровно на мультипринадлежность. */
  sum: NewsPair;
  multi_group_elements: number;
  extra: number;
}

export interface NewsDelta { value: number; previous: number; delta: number; pct: number | null }

export interface NewsReact {
  events: number; elements: number; rate: number | null; done_ever: number;
  from_ready: number; from_closed: number; after_release: number; examples: string[];
}

/** Часть сгорания (partOut): всё, своё или общее. */
export interface NewsBurnPart {
  burn: number;
  burn_dict: number;
  ship_correction: number;
  open_t0: number; open_t1: number;
  open_dict_t0: number; open_dict_t1: number;
  closed: number; added: number; added_new: number; added_react: number;
  waiting_t0: number; waiting_t1: number; ship_unknown: number;
  shipped: number; done_in_period: number;
  react: NewsReact;
  unknown: number;
  tasks: number;
  examples: { shipped: string[]; waiting: string[]; added: string[]; closed: string[] };
}

export interface NewsTaskGroup {
  key: string;
  total: NewsBurnPart;
  own: NewsBurnPart;
  shared: NewsBurnPart;
  filter: Partial<Record<NewsAxis, string>>;
}

export interface NewsTaskAxisOut {
  groups: NewsTaskGroup[];
  burn_own_sum: number;
  burn_shared_union: number;
  burn_sigma: number;
}

export interface NewsBurnDay {
  from: string; to: string; day_local: string;
  open_start: number; open_end: number; burn: number; burn_dict: number;
  waiting_end: number; ship_unknown_end: number; shipped: number;
}

export interface NewsTasksAvailable {
  available: true;
  all: NewsBurnPart;
  by_axis: Partial<Record<NewsTaskAxis, NewsTaskAxisOut>>;
  days: NewsBurnDay[];
  shipped_list: Array<{ uid: string; sprint: string; ready: string; release: string; release_date: string; days: number; now: string }>;
  wait_median_days: number | null;
  waiting_oldest: Array<{ uid: string; sprint: string; since: string; age_days: number; ship: string; link: string | null }>;
  entered_ready: number;
  ready_to_closed_no_release: number;
}

export interface NewsUnmeasurable { available?: false; measurable?: false; reason: string }

export interface NewsQueue {
  exact: boolean;
  q_t1: number;
  q_t0?: number; flow?: number;
  q_t0_range?: [number, number]; flow_range?: [number, number];
  reason?: string;
  new: number; new_proposed: number; new_decided: number;
  superseded_now: number; superseded_new: number; accepted_now: number;
  no_date: number;
  ttd: NewsUnmeasurable | null;
}

export interface NewsKnowledge {
  adr: NewsQueue;
  decision: NewsQueue;
  adr_revisions: NewsPair;
  adr_changes: NewsPair;
  spec_versions: NewsPair;
  spec_new: number;
  decisions_per_new_adr: Array<{ id: string; children: number }>;
  adr_reactivation: NewsUnmeasurable | null;
}

export interface NewsMetrics {
  counts: {
    total: NewsPair; by_type: Record<string, NewsPair>; by_kind: Record<string, NewsPair>;
    /** Счёт по конкретному автору (сервер #974); старый сервер его не шлёт. */
    by_who?: Record<string, NewsPair>;
  };
  tasks: NewsTasksAvailable | (NewsUnmeasurable & { available: false });
  knowledge: NewsKnowledge;
  agents: { measurable: true; events: NewsPair; elements: NewsPair } | (NewsUnmeasurable & { measurable: false });
  delta: {
    events: NewsDelta; elements: NewsDelta; by_type: Record<string, NewsDelta>;
    burn?: NewsDelta; waiting_t1?: NewsDelta; shipped?: NewsDelta; react_events?: NewsDelta; react_elements?: NewsDelta;
    previous: { from: string; to: string };
  };
  since_mark?: { events: number; elements: number; mark: string };
}

export interface NewsMatrixRow {
  day: string;
  /** [события, элементы] по столбцам matrix.cols. */
  cells: Array<[number, number]>;
  total: NewsPair;
  sum: NewsPair;
  multi: number;
  extra: number;
}

export interface NewsMatrix {
  n: number;
  cols: string[];
  rows: NewsMatrixRow[];
  col_totals: Array<{ col: string; total: NewsPair; sum: NewsPair; multi: number; extra: number }>;
  projects: number;
  total: NewsPair;
  sum_rows: NewsPair;
}

export interface NewsCheck {
  inv: string;
  name: string;
  /** null — «не смогли проверить» (жёлтое), не «проверено». */
  ok: boolean | null;
  detail: string;
  examples: string[];
}

export type NewsReadMarkState = 'ok' | 'none' | 'unavailable' | (string & {});
export interface NewsReadMark { state: NewsReadMarkState; at: string | null; error?: string }

export interface NewsMeta {
  generated_at: string;
  scope: { applied: boolean; projects?: number };
  period: { from: string; to: string; tz: string; days_local: [string, string] };
  total: NewsPair;
  multi_group_elements: number;
  truncated: boolean;
  errors: Array<{ source: string; error: string; critical: boolean }>;
  /** S7A-07: ok · empty · partial («источник недоступен» ≠ «ничего не было»). */
  state: 'ok' | 'empty' | 'partial' | (string & {});
  validation: { ok: boolean; checks: NewsCheck[]; drift: NewsCheck[] };
  dropped_changed_on_created_day: number;
  algorithm: string;
  read_mark?: NewsReadMark;
}

export interface NewsResponse {
  events: NewsEvent[];
  groups: NewsGroups;
  metrics: NewsMetrics;
  matrix?: NewsMatrix;
  meta: NewsMeta;
}
