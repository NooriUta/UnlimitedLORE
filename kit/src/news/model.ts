// Модель экрана новостей v2 (SPRINT_UXR_S7A_NEWS/S7A-02): запрос, состояние в
// URL, проверка контракта, подписи и ссылки. Ни одной метрики: всё считает
// сервер (SPEC-LORE-UXR-NEWS-ALGORITHMS 1.3.0), здесь — только форма.
import type { KitLang } from '../i18n';
import type { PillTone } from '../elements/Pill';
import { newsT, type NewsKey } from './i18n';
import {
  NEWS_AXES, NEWS_FILTER_AXES, type NewsAxis, type NewsEvent, type NewsFilterAxis, type NewsResponse,
} from './types';

export type NewsPeriod = 'day' | 'week' | 'month';
export type NewsZone = 'local' | 'utc';
export type NewsOrder = 'desc' | 'asc';
export const NEWS_PERIOD_DAYS: Record<NewsPeriod, number> = { day: 1, week: 7, month: 30 };
export const NEWS_MATRIX_COLS = [4, 6, 10] as const;

export interface NewsQuery {
  period: NewsPeriod;
  zone: NewsZone;
  group: NewsAxis;
  sub: NewsAxis | null;
  order: NewsOrder;
  matrix: number;
  filters: Partial<Record<NewsFilterAxis, string[]>>;
  els: string[];
  /**
   * Откуда взят els (S7A-03): метрика, по числу которой кликнули, и её итог.
   * Только подпись — на сервер не уходит. Примеры к числу сервер присылает не
   * больше 10, и «показано k из N» — сравнение двух присланных чисел.
   */
  drill: NewsDrill | null;
}

export interface NewsDrill { metric: string; total: number }

export const DEFAULT_NEWS_QUERY: NewsQuery = {
  period: 'week', zone: 'local', group: 'project', sub: null, order: 'desc', matrix: 6, filters: {}, els: [], drill: null,
};

/**
 * Клик по числу метрики (S7A-03): примеры элементов, приложенные сервером к
 * числу, → фильтр els «тип:id». Нечем сузить (0 или нет примеров) — null:
 * пустой els значит «без фильтра», то есть вся лента под видом метрики.
 */
export function metricDrill(
  metric: string, total: number, examples: readonly string[], type = 'task',
): { els: string[]; drill: NewsDrill } | null {
  if (!total || !examples.length) return null;
  return { els: examples.map(id => `${type}:${id}`), drill: { metric, total } };
}

function readDrill(v: string | null): NewsDrill | null {
  const m = v ? /^(.+):(\d+)$/.exec(v) : null;
  return m ? { metric: m[1], total: Number(m[2]) } : null;
}

/** Метрики, по числу которых можно кликнуть (S7A-03): id → подпись числа. */
export const NEWS_DRILL_METRICS = ['shipped', 'waiting', 'added', 'closed', 'react'] as const;
export type NewsDrillMetric = (typeof NEWS_DRILL_METRICS)[number];

/** id метрики группы сгорания: «waiting@project=AIDA/X» — число одной группы. */
export function groupDrillId(metric: NewsDrillMetric, axis: string, key: string): string {
  return `${metric}@${axis}=${key}`;
}

/** Подпись метрики разворота для строки фильтра: «Доехало S» или «Ждёт выкатки Y · X». */
export function drillLabel(metric: string, lang: KitLang): string {
  const m = /^(\w+)(?:@(\w+)=(.+))?$/.exec(metric);
  const base = m?.[1] ?? metric;
  const label = (NEWS_DRILL_METRICS as readonly string[]).includes(base) ? newsT(lang, `kpi.${base}` as NewsKey) : base;
  return m?.[2] && m[3] ? `${label} · ${newsGroupLabel(m[2], m[3], lang)}` : label;
}

/**
 * Фиксированный разрез ленты (вкладка «Активность» паспорта, S7A-06). У
 * релиза своей оси в контракте нет — его разрез идёт по элементу релиза (els).
 */
export type NewsScope = Partial<Record<Exclude<NewsFilterAxis, 'type' | 'kind' | 'author'>, string>> & { release?: string };

export interface NewsParamsOptions {
  /** Пояс пользователя (IANA) для «местного» дня. */
  timeZone: string;
  scope?: NewsScope;
}

const isAxis = (v: string | null): v is NewsAxis => v !== null && (NEWS_AXES as readonly string[]).includes(v);
const isFilterAxis = (v: string): v is NewsFilterAxis => (NEWS_FILTER_AXES as readonly string[]).includes(v);

/** Параметры GET /lore/news/v2 (LoreNewsV2Resource): limit не шлём — окно целиком (паритет 14). */
export function buildNewsParams(q: NewsQuery, opts: NewsParamsOptions): URLSearchParams {
  const p = new URLSearchParams();
  p.set('days', String(NEWS_PERIOD_DAYS[q.period]));
  p.set('tz', q.zone === 'utc' ? 'UTC' : opts.timeZone);
  const filters: Partial<Record<NewsFilterAxis, string[]>> = { ...q.filters };
  const scope = opts.scope ?? {};
  for (const [k, v] of Object.entries(scope)) {
    if (k !== 'release' && v && isFilterAxis(k)) filters[k] = [v];
  }
  for (const ax of NEWS_FILTER_AXES) {
    const vs = filters[ax];
    if (vs && vs.length) p.set(ax, vs.join(','));
  }
  const els = scope.release ? [`release:${scope.release}`] : q.els;
  if (els.length) p.set('els', els.join(','));
  p.set('group_by', q.group);
  if (q.sub && q.sub !== q.group) p.set('sub', q.sub);
  if (q.matrix > 0) p.set('matrix', String(q.matrix));
  return p;
}

/** Запись разреза в URL: умолчания — null (параметр снимается). */
export function writeNewsQuery(q: NewsQuery, prefix: string): Record<string, string | null> {
  const d = DEFAULT_NEWS_QUERY;
  const f = NEWS_FILTER_AXES.filter(a => q.filters[a]?.length).map(a => `${a}:${q.filters[a]!.join('|')}`).join(';');
  return {
    [`${prefix}p`]: q.period === d.period ? null : q.period,
    [`${prefix}z`]: q.zone === d.zone ? null : q.zone,
    [`${prefix}g`]: q.group === d.group ? null : q.group,
    [`${prefix}s`]: q.sub ?? null,
    [`${prefix}o`]: q.order === d.order ? null : q.order,
    [`${prefix}m`]: q.matrix === d.matrix ? null : String(q.matrix),
    [`${prefix}f`]: f || null,
    [`${prefix}e`]: q.els.length ? q.els.join('|') : null,
    [`${prefix}d`]: q.drill && q.els.length ? `${q.drill.metric}:${q.drill.total}` : null,
  };
}

export function readNewsQuery(sp: URLSearchParams, prefix: string): NewsQuery {
  const d = DEFAULT_NEWS_QUERY;
  const g = (k: string) => sp.get(`${prefix}${k}`);
  const period = g('p');
  const zone = g('z');
  const order = g('o');
  const m = Number(g('m'));
  const els = (g('e') ?? '').split('|').filter(Boolean);
  const filters: NewsQuery['filters'] = {};
  for (const part of (g('f') ?? '').split(';')) {
    const i = part.indexOf(':');
    if (i <= 0) continue;
    const ax = part.slice(0, i);
    const vs = part.slice(i + 1).split('|').filter(Boolean);
    if (isFilterAxis(ax) && vs.length) filters[ax] = vs;
  }
  return {
    period: period === 'day' || period === 'week' || period === 'month' ? period : d.period,
    zone: zone === 'utc' || zone === 'local' ? zone : d.zone,
    group: isAxis(g('g')) ? (g('g') as NewsAxis) : d.group,
    sub: isAxis(g('s')) ? (g('s') as NewsAxis) : null,
    order: order === 'asc' || order === 'desc' ? order : d.order,
    matrix: Number.isInteger(m) && m > 0 ? m : d.matrix,
    filters,
    els,
    // Подпись метрики без самого els не восстанавливаем: она врала бы о фильтре.
    drill: els.length ? readDrill(g('d')) : null,
  };
}

/** Ответ не по контракту — ошибка, а не «пусто» (паритет 26, D-2026-UXR-NEWS-V2-RULES п. 4). */
export class NewsContractError extends Error {
  constructor(field: string) {
    super(`news/v2: ответ не по контракту — нет поля ${field}`);
    this.name = 'NewsContractError';
  }
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

export function parseNewsResponse(data: unknown): NewsResponse {
  if (!isObj(data)) throw new NewsContractError('{events, groups, metrics, meta}');
  if (!Array.isArray(data.events)) throw new NewsContractError('events');
  if (!isObj(data.groups) || !Array.isArray(data.groups.list)) throw new NewsContractError('groups');
  if (!isObj(data.metrics)) throw new NewsContractError('metrics');
  if (!isObj(data.meta)) throw new NewsContractError('meta');
  return data as unknown as NewsResponse;
}

// ── подписи ──

/** Иконки типов записей — как разделы v1 (паритет 2). */
export const NEWS_TYPE_META: Record<string, { icon: string }> = {
  release: { icon: 'open-book' },
  sprint: { icon: 'sprint' },
  task: { icon: 'sprint' },
  adr: { icon: 'scroll-quill' },
  decision: { icon: 'gavel' },
  spec: { icon: 'spell-book' },
};

/** Иконка и тон события (паритет 1). «Готово к выкатке» — жёлтым. */
export const NEWS_KIND_META: Record<string, { icon: string; tone: PillTone }> = {
  created: { icon: 'sprout', tone: 'suc' },
  changed: { icon: 'pencil', tone: 'inf' },
  status: { icon: 'pencil', tone: 't2' },
  version: { icon: 'stack', tone: 'inf' },
  ready: { icon: 'rocket', tone: 'wrn' },
  reactivated: { icon: 'backward-time', tone: 'dng' },
  closed: { icon: 'check-mark', tone: 'suc' },
  cancelled: { icon: 'cancel', tone: 't3' },
  released: { icon: 'upgrade', tone: 'acc' },
};

export function typeLabel(type: string, lang: KitLang): string {
  return type in NEWS_TYPE_META ? newsT(lang, `type.${type}` as NewsKey) : type;
}

export function kindLabel(kind: string, lang: KitLang): string {
  return kind in NEWS_KIND_META ? newsT(lang, `kind.${kind}` as NewsKey) : kind;
}

export function axisLabel(axis: string, lang: KitLang): string {
  return newsT(lang, `axis.${axis}` as NewsKey);
}

/** Слаг «Владелец/Репо» → «Репо» (паритет 22). */
export function shortProject(slug: string): string {
  const i = slug.lastIndexOf('/');
  return i >= 0 ? slug.slice(i + 1) : slug;
}

const NONE: Record<string, NewsKey> = {
  '(no-project)': 'none.project', '(no-component)': 'none.component',
  '(no-sprint)': 'none.sprint', '(no-milestone)': 'none.milestone',
};

/** Подпись значения оси: заглушки сервера — словами, проекты — коротко. */
export function newsGroupLabel(axis: string, key: string, lang: KitLang): string {
  if (key in NONE) return newsT(lang, NONE[key]);
  const other = /^\(other:(\d+)\)$/.exec(key);
  if (other) return newsT(lang, 'others', { n: other[1] });
  switch (axis) {
    case 'project': return shortProject(key);
    case 'type': return typeLabel(key, lang);
    case 'kind': return kindLabel(key, lang);
    case 'author': return key === 'agent' || key === 'human' || key === 'unknown' ? newsT(lang, `author.${key}` as NewsKey) : key;
    default: return key;
  }
}

/** «ДД.ММ» из YYYY-MM-DD. */
export function shortDay(day: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  return m ? `${m[3]}.${m[2]}` : day;
}

/**
 * Время машины (UTC) для показа рядом с местным: HH:MM; если день по UTC не
 * тот, что местный, — с датой ДД.ММ. Это перестановка строки, не расчёт.
 */
export function utcClock(atUtc: string | null, dayLocal: string): string | null {
  if (!atUtc) return null;
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/.exec(atUtc);
  if (!m) return null;
  return m[1] === dayLocal ? m[2] : `${shortDay(m[1])} ${m[2]}`;
}

/**
 * Значения оси у строки ленты — для раскладки строк по группам дня. Строка
 * мультипроектного события стоит во ВСЕХ своих группах (паритет 21 с
 * исправлением). Чисел здесь нет: итоги групп приходят от сервера.
 */
export function eventAxisValues(e: NewsEvent, axis: NewsAxis): string[] {
  switch (axis) {
    case 'project': return e.projects?.length ? e.projects : ['(no-project)'];
    case 'component': return e.components?.length ? e.components : ['(no-component)'];
    case 'type': return [e.type];
    case 'kind': return [e.kind];
    case 'sprint': return [e.sprint ?? '(no-sprint)'];
    case 'milestone': return e.milestones?.length ? e.milestones : ['(no-milestone)'];
    case 'author': return [e.author];
    case 'day': return [e.day_local];
  }
}

// ── ссылки ──

const enc = encodeURIComponent;

/**
 * Куда ведёт строка ленты (паритет 12; D-2026-UXR-NEWS-V2-RULES п. 2 — задачи
 * и спеки кликабельны). Пока у v2 нет своих паспортов (S5), ведём в паспорта
 * LORE по тем же адресам, что поиск v1 (searchRoutes.ts). Экран может
 * подставить свой hrefOf.
 */
export function newsHref(e: NewsEvent): string | null {
  switch (e.type) {
    case 'task': return `/lore?section=sprints&passport=${enc(e.sprint ?? e.el.split('/')[0])}`;
    case 'sprint': return `/lore?section=sprints&passport=${enc(e.el)}`;
    case 'adr': return `/lore?section=adrs&passport=${enc(e.el)}`;
    case 'decision': return `/lore?section=decisions&passport=${enc(e.el)}`;
    case 'spec': return `/lore?section=knowledge&passport=${enc(`spec:${e.el}`)}`;
    // Релиз — парой «проект#id»: один номер версии живёт в нескольких репозиториях.
    case 'release': {
      const p = e.projects?.[0];
      return `/lore?section=releases&rel=${enc(p ? `${p}#${e.el}` : e.el)}`;
    }
    default: return null;
  }
}

/** Число со знаком: «+3», «−1», «0» (минус — типографский). */
export function signed(n: number): string {
  return n > 0 ? `+${n}` : n < 0 ? `−${Math.abs(n)}` : '0';
}

/** Пара «события · элементы». */
export function pairText(p: { events: number; elements: number }): string {
  return `${p.events} · ${p.elements}`;
}

/** Процент из ответа сервера — с запятой в ru. */
export function pctText(v: number, lang: KitLang): string {
  const s = String(v);
  return `${lang === 'ru' ? s.replace('.', ',') : s} %`;
}

/** Тон знака сгорания: плюс — suc, минус — dng, ноль — t3 (паритет 7). */
export function signTone(n: number): PillTone {
  return n > 0 ? 'suc' : n < 0 ? 'dng' : 't3';
}
