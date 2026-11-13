// История записи для паспортов v2 (SPRINT_UXR_S5_RECORD_TASKS/S5-11).
//
// Чтение — GET /lore/history (контракт S2-03, SPEC-LORE-UXR-S2-CONTRACTS):
// версии новейшей первой, у каждой автор (человек / агент / unknown). Пока
// эндпоинт S2 не выкачен (404 без кода ошибки = маршрута нет), читаем
// существующие SCD2-слайсы (history_task / history_sprint / adr_history) — это
// ЯВНЫЙ переход: результат помечен source:'legacy', экран говорит об этом
// словами, авторов у слайсов нет (unknown). 404 с кодом NOT_FOUND — записи нет,
// это ошибка, а не повод идти в слайс.
//
// Возврат версии — НЕ «откат» SCD2, а новая версия через существующий
// write-API: задача — POST /lore/task/edit, спринт — /lore/sprint/plan (SCD2)
// + /lore/sprint/update (тела), ADR — POST /lore/adr (upsert). Чего write-API
// не умеет (очистить число/дату: null там = «не менять»), — громкий отказ ДО
// записи, а не частичный возврат.
//
// v1-клиент (src/api/lore.ts) v2 не импортирует (v1 заморожен,
// D-2026-UXR-V2-FOLDER-V1-FROZEN); общего клиента v2 пока нет.
import { diffVersions, type KitHistory, type KitHistoryVersion, type KitRestoreRequest } from '@seidr/kit';
import { loreFetch } from '../auth/session';
import { loreAuthor } from './loreAuthor';

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

/** Виды записей с паспортом v2 (MVP D-2026-UXR-MVP): задача, спринт, ADR. */
export type HistoryKind = 'task' | 'sprint' | 'adr';

/** SCD2-слайс вида — запасной путь, пока /lore/history (S2-03) не выкачен. */
export const LEGACY_HISTORY_SLICE: Readonly<Record<HistoryKind, string>> = {
  task: 'history_task',
  sprint: 'history_sprint',
  adr: 'adr_history',
};

const SPRINT_PLAN_FIELDS = ['priority', 'planned_start_date', 'planned_end_date', 'track_id'] as const;
const SPRINT_BODY_FIELDS = ['context_md', 'outcome_md'] as const;

/** Поля, которые существующий write-API умеет вернуть, — по виду. Статус меняется отдельно (2 касания). */
export const RESTORABLE: Readonly<Record<HistoryKind, readonly string[]>> = {
  task: ['note_md', 'effort_days'],
  sprint: [...SPRINT_BODY_FIELDS, ...SPRINT_PLAN_FIELDS],
  adr: ['context_md', 'decision_md', 'consequences_md'],
};

export class HistoryHttpError extends Error {
  constructor(readonly status: number, readonly code: string, readonly where: string, detail?: string) {
    super(`${where}: HTTP ${status}${code ? ` ${code}` : ''}${detail ? ` — ${detail}` : ''}`);
    this.name = 'HistoryHttpError';
  }
}

export interface HistoryOptions {
  signal?: AbortSignal;
  fetchImpl?: FetchLike;
  /** Заголовки авторизации (Bearer) — от оболочки v2. */
  headers?: () => Record<string, string>;
}

export interface HistoryResult {
  history: KitHistory;
  /** s2 — GET /lore/history; legacy — SCD2-слайс (эндпоинт S2 ещё не выкачен). */
  source: 's2' | 'legacy';
  slice?: string;
}

const fetchOf = (o: HistoryOptions): FetchLike => o.fetchImpl ?? loreFetch;

async function errorBody(res: Response): Promise<{ error?: string; detail?: string }> {
  try {
    const b: unknown = await res.json();
    return b && typeof b === 'object' ? (b as { error?: string; detail?: string }) : {};
  } catch {
    return {};
  }
}

async function getJson(url: string, o: HistoryOptions): Promise<{ res: Response; body: unknown }> {
  const res = await fetchOf(o)(url, { signal: o.signal, headers: { Accept: 'application/json', ...(o.headers?.() ?? {}) } });
  if (!res.ok) return { res, body: undefined };
  return { res, body: await res.json() };
}

/** Ответ S2-03 → история kit (формы совпадают; лишнее отбрасываем, недостающее — честные пустоты). */
function fromS2(body: Record<string, unknown>): KitHistory {
  const versions = Array.isArray(body.versions) ? (body.versions as KitHistoryVersion[]) : [];
  return {
    tracking: body.tracking === 'not_tracked' ? 'not_tracked' : 'scd2',
    versions: versions.map(v => ({
      state_uid: v.state_uid ?? null, valid_from: v.valid_from ?? null, valid_to: v.valid_to ?? null,
      // S9-09: служебные поля (хэш содержимого, коммит источника) — не правка; legacy их уже отсекал.
      is_open: Boolean(v.is_open), status: v.status ?? null,
      fields: Object.fromEntries(Object.entries(v.fields ?? {}).filter(([k]) => !SERVICE.has(k))),
      changed: Array.isArray(v.changed) ? v.changed.filter(k => !SERVICE.has(k)) : [], author: loreAuthor(v.author),
    })),
    anomalies: Array.isArray(body.anomalies) ? (body.anomalies as string[]) : [],
    page: (body.page as KitHistory['page']) ?? null,
    warnings: Array.isArray(body.warnings) ? (body.warnings as string[]) : [],
  };
}

const SERVICE = new Set(['valid_from', 'valid_to', 'content_hash', 'source_commit', 'state_uid', '@rid', '@type']);

/** Строки SCD2-слайса (старейшая первой) → история kit (новейшая первой), автор unknown. */
export function fromLegacyRows(rows: readonly Record<string, unknown>[]): KitHistory {
  const asc = rows.map((r, i) => {
    const fields = Object.fromEntries(Object.entries(r).filter(([k]) => !SERVICE.has(k)));
    const prev = i > 0 ? Object.fromEntries(Object.entries(rows[i - 1]).filter(([k]) => !SERVICE.has(k))) : null;
    const v: KitHistoryVersion = {
      state_uid: null,
      valid_from: (r.valid_from as string | null) ?? null,
      valid_to: (r.valid_to as string | null) ?? null,
      is_open: r.valid_to === null || r.valid_to === undefined,
      status: (r.status_raw as string | null) ?? null,
      fields,
      changed: diffVersions(prev, fields).map(d => d.field),
      author: { kind: 'unknown' },
    };
    return v;
  });
  return { tracking: 'scd2', versions: asc.reverse(), anomalies: [], page: null, warnings: [] };
}

export async function fetchRecordHistory(kind: HistoryKind, id: string, o: HistoryOptions = {}): Promise<HistoryResult> {
  const q = new URLSearchParams({ type: kind, id }).toString();
  const s2 = await getJson(`/lore/history?${q}`, o);
  if (s2.res.ok) return { history: fromS2((s2.body ?? {}) as Record<string, unknown>), source: 's2' };
  const err = await errorBody(s2.res);
  // 404 без кода ошибки LORE — маршрута нет (S2-03 не выкачен); с кодом — записи нет.
  if (!(s2.res.status === 404 && !err.error)) throw new HistoryHttpError(s2.res.status, err.error ?? '', 'history', err.detail);

  const slice = LEGACY_HISTORY_SLICE[kind];
  const legacy = await getJson(`/lore/slice/${slice}?${new URLSearchParams({ id }).toString()}`, o);
  if (!legacy.res.ok) {
    const e = await errorBody(legacy.res);
    throw new HistoryHttpError(legacy.res.status, e.error ?? '', slice, e.detail);
  }
  const rows = (legacy.body as { rows?: unknown })?.rows;
  if (!Array.isArray(rows)) throw new HistoryHttpError(legacy.res.status, 'NO_ROWS', slice);
  return { history: fromLegacyRows(rows as Record<string, unknown>[]), source: 'legacy', slice };
}

export interface RestoreOptions extends HistoryOptions {
  /** Текущий заголовок записи: task/edit и POST /lore/adr требуют его в каждом запросе. */
  title: string;
}

const isText = (field: string) => field.endsWith('_md');

/** Значения для записи: очищенный текст = '', очистить число/дату write-API не умеет (null = «не менять»). */
function values(kind: HistoryKind, changes: KitRestoreRequest['changes']): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const c of changes) {
    if (!RESTORABLE[kind].includes(c.field)) throw new Error(`${c.field}: поле не возвращается через write-API (${kind})`);
    if (c.to === null || c.to === undefined) {
      if (!isText(c.field)) throw new Error(`${c.field}: write-API не умеет очищать это поле — возврат не выполнен`);
      out[c.field] = '';
    } else {
      out[c.field] = c.to;
    }
  }
  return out;
}

async function post(url: string, body: Record<string, unknown>, o: HistoryOptions): Promise<void> {
  const res = await fetchOf(o)(url, {
    method: 'POST',
    signal: o.signal,
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...(o.headers?.() ?? {}) },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const e = await errorBody(res);
    throw new HistoryHttpError(res.status, e.error ?? '', url, e.detail);
  }
}

/** Вернуть поля старой версии как новую версию через существующий write-API. */
export async function restoreRecordVersion(kind: HistoryKind, id: string, req: KitRestoreRequest, o: RestoreOptions): Promise<void> {
  const v = values(kind, req.changes);
  if (Object.keys(v).length === 0) return;
  if (kind === 'task') {
    await post('/lore/task/edit', { task_uid: id, title: o.title, ...v }, o);
    return;
  }
  if (kind === 'adr') {
    await post('/lore/adr', { adr_id: id, name: o.title, ...v }, o);
    return;
  }
  const pick = (keys: readonly string[]) => Object.fromEntries(Object.entries(v).filter(([k]) => keys.includes(k)));
  const plan = pick(SPRINT_PLAN_FIELDS);
  const bodies = pick(SPRINT_BODY_FIELDS);
  if (Object.keys(plan).length > 0) await post('/lore/sprint/plan', { sprint_id: id, ...plan }, o);
  if (Object.keys(bodies).length > 0) await post('/lore/sprint/update', { sprint_id: id, ...bodies }, o);
}
