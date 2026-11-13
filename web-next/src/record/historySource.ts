// Вкладка «История» на боевом сервере (SPRINT_UXR_S5_RECORD_TASKS/S5-11 ×
// SPRINT_UXR_S9_SCALE_OPT/S9-09).
//
// kit умеет вкладку с S5-11 (RecordHistory + KitHistory), но в v2 её никто не
// подключал: `RecordView.history` нигде не передавался, и история записи была
// недоступна, хотя сервер её отдаёт. Здесь перевод ответа сервера в KitHistory.
//
// Форма сервера (LoreHistoryResource, LoreEntityHistory):
//   {type, id, rows: [{state_uid, valid_from, valid_to, status_raw,
//    content_hash, source_commit, changed_by, changed_by_kind, author:{kind,
//    caller, source}, projects?}], attribution: {ok, source, reason?},
//    scope?, outside_scope?, page?}
// `page` появился в S9-09 (PR #948): его нет — сервер старее, и это РАЗНОЕ с
// «страница одна», поэтому page остаётся null, а не подделывается.
//
// Чего здесь нет и почему: снимка полей версии сервер не даёт (в строке —
// метаданные версии: статус, хэш содержимого, коммит). Поэтому `fields` — то,
// что пришло, а `changed` считается сравнением соседних версий тем же
// правилом, что в контракте (changedFields). Выдумывать значения полей, чтобы
// «был дифф», нельзя: сравнение показывало бы несуществующие правки.
import { HISTORY_TYPES, changedFields } from '../api/contracts/s2';
import type { KitHistory, KitHistoryAuthor, KitHistoryRun, KitHistoryVersion } from '@seidr/kit';
import { loreAuthor } from '../history/loreAuthor';
import { loreFetch } from '../auth/session';

/** Служебные поля строки: в снимок полей версии не идут. */
const SERVICE = new Set([
  'entity_type', 'hist_type', 'ref_id', 'state_uid', 'valid_from', 'valid_to',
  'changed_by', 'changed_by_kind', 'author', 'projects', 'projects_via',
  // Пометка свёрнутой серии (S9-09) — метаданные выдачи, а не поле версии:
  // попади она в снимок, сравнение версий показывало бы правку поля
  // «collapsed», которой не было.
  'collapsed',
]);

export interface HistoryQueryOpts {
  /** Постранично (S9-09); сервер старее — вернёт всё и без page. */
  offset?: number;
  limit?: number;
  order?: 'asc' | 'desc';
  /** Только правки человека или агента. */
  author_kind?: 'human' | 'agent';
  /** Только смены статуса или только правки содержимого. */
  field?: 'status' | 'content';
  /**
   * Только правки этого автора — его идентификатор вызывающего (S9-09, PR
   * #1083). Можно вместе с `author_kind`: на сервере это условие «И».
   */
  author?: string;
  /**
   * Свернуть подряд идущие правки одного агента в одну строку (последняя
   * версия серии, с `collapsed`). Свёртка идёт ДО страницы, поэтому
   * `page.total` и `has_more` честны по свёрнутым строкам.
   */
  collapse?: 'agent';
}

export class HistoryForbidden extends Error {}

// Автор — общим адаптером LORE → kit (K-14): здесь сервер отдаёт caller.
function authorOf(raw: unknown): KitHistoryAuthor {
  return loreAuthor(raw);
}

/** Пометка свёрнутой серии, как её отдаёт сервер. Нет — строка не свёрнута. */
function runOf(raw: unknown): KitHistoryRun | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.count !== 'number') return null;
  return {
    count: r.count,
    first_state_uid: typeof r.first_state_uid === 'string' ? r.first_state_uid : null,
    first_valid_from: typeof r.first_valid_from === 'string' ? r.first_valid_from : null,
  };
}

function versionOf(raw: Record<string, unknown>): KitHistoryVersion {
  const fields: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(raw)) if (!SERVICE.has(k)) fields[k] = v;
  const validTo = typeof raw.valid_to === 'string' ? raw.valid_to : null;
  return {
    state_uid: typeof raw.state_uid === 'string' ? raw.state_uid : null,
    valid_from: typeof raw.valid_from === 'string' ? raw.valid_from : null,
    valid_to: validTo,
    is_open: validTo == null,
    status: typeof raw.status_raw === 'string' ? raw.status_raw : null,
    fields,
    changed: [],
    author: authorOf(raw.author),
    collapsed: runOf(raw.collapsed),
  };
}

/** Аномалии цепочки — те же, что в контракте S2 (historyAnomalies). */
function anomaliesOf(versions: readonly KitHistoryVersion[]): string[] {
  if (versions.length === 0) return [];
  const open = versions.filter(v => v.is_open);
  const out: string[] = [];
  if (open.length > 1) out.push('multiple_open_versions');
  if (open.some(v => v.valid_from == null)) out.push('open_state_without_valid_from');
  if (open.length === 0) out.push('no_open_version');
  return out;
}

/**
 * Перевод ответа сервера в KitHistory. Версии — новейшая первой; `changed`
 * считается по соседям, потому что снимка полей сервер не даёт.
 */
export function historyFromServer(body: Record<string, unknown>): KitHistory {
  const rows = Array.isArray(body.rows) ? body.rows : [];
  const newestFirst = rows.map(r => versionOf(r as Record<string, unknown>));
  // Сервер отдаёт от старых к новым или наоборот (order в S9-09). Приводим к
  // «новейшая первой» по valid_from, а не по порядку в ответе: порядок — его
  // настройка, а наш вид фиксирован.
  const sorted = [...newestFirst].sort((a, b) => String(b.valid_from ?? '').localeCompare(String(a.valid_from ?? '')));
  const withChanged = sorted.map((v, i) => ({
    ...v,
    // Сравниваем с БОЛЕЕ СТАРОЙ (следующей в списке); у самой старой — все поля.
    changed: changedFields(i + 1 < sorted.length ? sorted[i + 1].fields : null, v.fields),
  }));

  const warnings: string[] = [];
  const attribution = body.attribution && typeof body.attribution === 'object'
    ? (body.attribution as Record<string, unknown>) : null;
  if (attribution && attribution.ok === false) {
    // «Автор не установлен» ≠ «автора нет»: причина уходит словами наружу.
    warnings.push(String(attribution.reason ?? 'журнал действий не прочитался — автор правок не установлен'));
  }
  if (body.outside_scope && typeof body.outside_scope === 'object') {
    const os = body.outside_scope as Record<string, unknown>;
    warnings.push(String(os.reason ?? 'запись существует, но вне разрешённых проектов — пустая история не значит «правок не было»'));
  }

  const page = body.page && typeof body.page === 'object' ? (body.page as Record<string, unknown>) : null;
  return {
    tracking: 'scd2',
    versions: withChanged,
    anomalies: anomaliesOf(withChanged),
    // Сервер без S9-09 постраничности не считает: page=null значит «сервер не
    // сказал», а не «страница одна».
    page: page
      ? {
        limit: typeof page.limit === 'number' ? page.limit : null,
        offset: typeof page.offset === 'number' ? page.offset : 0,
        total: typeof page.total === 'number' ? page.total : withChanged.length,
        has_more: page.has_more === true,
        // Эхо сервера: что он ДЕЙСТВИТЕЛЬНО применил. Эха нет (сервер старее
        // PR #1083) — null, то есть «не сказал», а не «не применил».
        author: typeof page.author === 'string' ? page.author : null,
        collapse: page.collapse === 'agent' ? 'agent' : null,
      }
      : null,
    warnings,
  };
}

/** Прочитать историю записи с сервера. 403 по скоупу — отдельная ошибка. */
export async function fetchHistory(
  type: string,
  id: string,
  opts: HistoryQueryOpts = {},
  fetchImpl: typeof fetch = loreFetch,
): Promise<KitHistory> {
  const p = new URLSearchParams({ type, id });
  // Порядок по умолчанию — desc. Сервер без order отдаёт хронологию и режет
  // страницу С НАЧАЛА, то есть самыми СТАРЫМИ версиями; наш вид фиксирован
  // «новейшая первой», и такая первая страница показывала бы начало цепочки,
  // выдавая его за свежее (а текущей версии в ней могло не быть вовсе).
  if (opts.order === undefined) p.set('order', 'desc');
  for (const [k, v] of Object.entries(opts)) if (v !== undefined) p.set(k, String(v));
  const res = await fetchImpl(`/lore/history?${p.toString()}`);
  let body: Record<string, unknown> = {};
  try {
    const v = (await res.json()) as unknown;
    if (v && typeof v === 'object') body = v as Record<string, unknown>;
  } catch {
    // не-JSON — ниже станет ошибкой с кодом, а не пустой историей
  }
  if (!res.ok) {
    const code = typeof body.error === 'string' ? body.error : `HTTP ${res.status}`;
    const detail = typeof body.detail === 'string' ? body.detail : '';
    const text = detail ? `${code}: ${detail}` : code;
    // «Нет ни одного разрешённого проекта» — это запрет, а не пустая история.
    if (res.status === 403) throw new HistoryForbidden(text);
    throw new Error(text);
  }
  return historyFromServer(body);
}

// ── источник для вкладки (React) ─────────────────────────────────────────────

/**
 * Типы, у которых история ведётся (цепочка SCD2). Таблица — из контракта S2
 * (HISTORY_TYPES), она же LoreSlices.HIST_PARENT на сервере. Тип вне таблицы —
 * это «история не ведётся», а не «правок не было»: такой ответ kit умеет
 * показать словами (tracking: 'not_tracked'), поэтому сервер мы не спрашиваем
 * и 400 BAD_PARAMS не выдаём за пустую историю.
 */
export const HISTORY_TRACKED: ReadonlySet<string> = new Set(HISTORY_TYPES);

export const NOT_TRACKED: KitHistory = {
  tracking: 'not_tracked', versions: [], anomalies: [], page: null, warnings: [],
};

/**
 * Сколько версий просить за раз. Не «все»: у долгой записи история длинная, и
 * страница паспорта не должна её тянуть целиком ради трёх верхних строк.
 */
export const HISTORY_PAGE = 20;
