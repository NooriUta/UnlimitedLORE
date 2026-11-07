// Контракт ответа GET /lore/news/v2 (SPRINT_UXR_S7A_NEWS/S7A-09, сервер —
// ветка feature/s7a-news-server-prep, f525c294: NewsV2Engine.compute → {events,
// groups, metrics, meta}). Здесь только то, что рисует вкладка «Активность»
// (S7A-06); остальные поля проходят насквозь как unknown. Все числа считает
// сервер (SPEC-LORE-UXR-NEWS-ALGORITHMS 1.3.0) — клиент их только показывает.

/** pair(ev, el) движка. */
export interface NewsPair { events: number; elements: number }

/** Строка ленты (feedRows): элемент × вид × местный день, ×N = mult. */
export interface NewsV2Row {
  key: string;
  type: string;
  el: string;
  el_key: string;
  kind: string;
  title: string | null;
  /** Местный день YYYY-MM-DD в поясе meta.period.tz. */
  day_local: string;
  /** Местное время HH:MM; null — момент неизвестен (запись «только дата»). */
  time_local: string | null;
  /** Машинное время — ISO-момент UTC; null, если время неизвестно. */
  at_utc: string | null;
  time_known: boolean;
  /** Сколько событий свернуто в строку (×N). */
  mult: number;
  projects?: string[] | null;
  components?: string[] | null;
  sprint?: string | null;
  milestones?: string[] | null;
  groups_n?: number;
  /** Класс автора: agent | human | unknown. */
  author: string;
  who?: string | null;
  from?: string | null;
  to?: string | null;
  parent?: string | null;
  series?: string | null;
  future?: boolean;
  /** Есть, только если у пользователя есть черта «прочитано» (S7A-04). */
  unread?: boolean;
}

/** partOut движка: сгорание, ожидание выкатки, поправка выкатки, реактивация. */
export interface NewsV2TaskPart {
  burn: number;
  burn_dict?: number;
  /** Поправка выкатки (Δship) — отдельным числом, не вшита в сгорание. */
  ship_correction?: number;
  open_t0?: number;
  open_t1?: number;
  closed?: number;
  added?: number;
  /** Ждёт выкатки на конец периода (Y). */
  waiting_t1?: number;
  ship_unknown?: number;
  shipped?: number;
  react?: { events: number; elements: number; rate?: number | null };
  [k: string]: unknown;
}

export interface NewsV2TaskGroup {
  key: string;
  total: NewsV2TaskPart;
  own?: NewsV2TaskPart;
  shared?: NewsV2TaskPart;
  filter?: Record<string, string>;
}

export interface NewsV2Tasks {
  available: boolean;
  reason?: string;
  all?: NewsV2TaskPart;
  by_axis?: Record<string, { groups: NewsV2TaskGroup[]; burn_own_sum?: number; burn_shared_union?: number; burn_sigma?: number }>;
  [k: string]: unknown;
}

export interface NewsV2SourceError { source: string; error: string; critical: boolean }

export interface NewsV2Meta {
  generated_at?: string;
  period?: { from: string; to: string; tz: string; days_local?: string[] };
  total?: NewsPair;
  truncated?: boolean;
  errors?: NewsV2SourceError[];
  /** S7A-07: ok | empty | partial. Нет поля — полнота не подтверждена. */
  state?: string;
  validation?: { ok: boolean; checks?: unknown[]; drift?: unknown[] };
  read_mark?: unknown;
  [k: string]: unknown;
}

export interface NewsV2Response {
  events: NewsV2Row[];
  groups?: unknown;
  metrics?: { counts?: { total?: NewsPair; [k: string]: unknown }; tasks?: NewsV2Tasks; [k: string]: unknown };
  matrix?: unknown;
  meta: NewsV2Meta;
}

/** Ошибка HTTP со статусом — kit узнаёт 403 как «нет прав» (classifyError). */
export class NewsV2HttpError extends Error {
  readonly status: number;
  readonly code?: string;
  constructor(status: number, message: string, code?: string) {
    super(message);
    this.name = 'NewsV2HttpError';
    this.status = status;
    if (code) this.code = code;
  }
}
