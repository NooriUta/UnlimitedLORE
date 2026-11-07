// Модель вкладки «Активность» (SPRINT_UXR_S7A_NEWS/S7A-06): запрос по оси
// своей записи (S7A-02), честное состояние из meta (S7A-07) и выбор готовых
// чисел сгорания из ответа. Ничего не считает: SPEC-LORE-UXR-NEWS-ALGORITHMS
// 1.3.0 — «всё считается один раз на сервере, клиенты только рисуют».
import type { NewsV2Response, NewsV2SourceError, NewsV2TaskPart } from './newsV2';

export type ActivityKind = 'project' | 'milestone' | 'sprint' | 'release';

export interface ActivityTarget {
  kind: ActivityKind;
  /** id записи паспорта: slug проекта, id вехи, id спринта, id/uid релиза. */
  id: string;
  /**
   * Только для релиза: его спринты (ребро IMPLEMENTED_IN_RELEASE). У сервера
   * нет оси release — лента релиза = лента его спринтов.
   */
  sprints?: readonly string[];
}

/** Ось фильтра /lore/news/v2 для записи (оси сервера: NewsV2Engine.AXES). */
export const ACTIVITY_AXIS = { project: 'project', milestone: 'milestone', sprint: 'sprint' } as const;

export interface ActivityOptions {
  /** Окно в местных днях (сервер: days, по умолчанию 7). */
  days?: number;
  /** Пояс местного дня (сервер: tz, по умолчанию Europe/Moscow). */
  tz?: string;
  /** Потолок строк (сервер: limit; обрезку он сам отмечает meta.truncated). */
  limit?: number;
}

export type ActivityParams =
  | { ok: true; query: string }
  | { ok: false; reason: 'release-no-sprints' | 'no-id' };

/**
 * Строка запроса к /lore/news/v2 для записи паспорта. Без фильтра запрос не
 * строится никогда: лента без оси — это лента всего LORE под чужим заголовком.
 */
export function activityParams(t: ActivityTarget, o: ActivityOptions = {}): ActivityParams {
  const id = t.id?.trim() ?? '';
  if (!id) return { ok: false, reason: 'no-id' };
  const q = new URLSearchParams();
  if (t.kind === 'release') {
    const sprints = (t.sprints ?? []).map(s => s.trim()).filter(Boolean);
    if (sprints.length === 0) return { ok: false, reason: 'release-no-sprints' };
    q.set('sprint', sprints.join(','));
  } else {
    q.set(ACTIVITY_AXIS[t.kind], id);
  }
  q.set('group_by', 'day');
  if (o.days) q.set('days', String(o.days));
  if (o.tz) q.set('tz', o.tz);
  if (o.limit) q.set('limit', String(o.limit));
  return { ok: true, query: q.toString() };
}

export type ActivityDataState = 'ok' | 'empty' | 'partial' | 'unverified';

export interface ActivityStatus {
  state: ActivityDataState;
  errors: NewsV2SourceError[];
  truncated: boolean;
  validationFailed: boolean;
}

/**
 * Состояние данных — из meta сервера (S7A-07), не из длины массива:
 *  - ошибки источников → partial (даже при state=ok: часть ленты могла пропасть);
 *  - empty при нуле строк → проверенный ноль;
 *  - ok со строками → ok;
 *  - нет state / неизвестное / ok при нуле строк → unverified.
 */
export function activityState(r: NewsV2Response): ActivityStatus {
  const m = r.meta ?? {};
  const errors = Array.isArray(m.errors) ? m.errors : [];
  const n = Array.isArray(r.events) ? r.events.length : 0;
  let state: ActivityDataState;
  if (m.state === 'partial' || errors.length > 0) state = 'partial';
  else if (m.state === 'empty' && n === 0) state = 'empty';
  else if (m.state === 'ok' && n > 0) state = 'ok';
  else state = 'unverified';
  return { state, errors, truncated: m.truncated === true, validationFailed: m.validation?.ok === false };
}

export type ActivityBurn =
  | { kind: 'group'; total: NewsV2TaskPart; own?: NewsV2TaskPart; shared?: NewsV2TaskPart }
  | { kind: 'all'; total: NewsV2TaskPart }
  | { kind: 'missing' }
  | { kind: 'unavailable'; reason?: string };

/**
 * Сгорание записи: своя группа из metrics.tasks.by_axis[ось] (своё/общее
 * §7.2b — числа сервера), у релиза — итог выборки (all). Только выбор, без
 * арифметики.
 */
export function activityBurn(r: NewsV2Response, t: ActivityTarget): ActivityBurn {
  const tasks = r.metrics?.tasks;
  if (!tasks) return { kind: 'unavailable' };
  if (!tasks.available) return tasks.reason ? { kind: 'unavailable', reason: tasks.reason } : { kind: 'unavailable' };
  if (t.kind === 'release') return tasks.all ? { kind: 'all', total: tasks.all } : { kind: 'missing' };
  const g = tasks.by_axis?.[ACTIVITY_AXIS[t.kind]]?.groups?.find(x => x.key === t.id);
  if (!g) return { kind: 'missing' };
  return { kind: 'group', total: g.total, own: g.own, shared: g.shared };
}

/** Машинное время строки: HH:MM из ISO-момента UTC (форматирование, не пересчёт). */
export function machineTime(atUtc: string | null | undefined): string | null {
  const m = atUtc ? /T(\d{2}:\d{2})/.exec(atUtc) : null;
  return m ? m[1] : null;
}
