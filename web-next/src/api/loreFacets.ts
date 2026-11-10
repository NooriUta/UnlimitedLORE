// Счётчики фасетов с сервера (SPRINT_UXR_S9_SCALE_OPT/S9-01, клиентская половина).
//
// `GET /lore/slice/{id}/facets?axes=…` считает оси по ВСЕЙ выдаче, а не по
// загруженной странице. До этого счётчики фасетов и чипов «Быстро» считались в
// браузере по `data.records`, то есть по первой тысяче строк — и стояли рядом с
// «Показано 1000 из 4000». Два числа об одном и том же, посчитанные по разным
// множествам, выглядели одинаково достоверно.
//
// Здесь только ЧТЕНИЕ и перевод на язык формы (kit `ListCounts`): числа дальше
// идут в список данными, сам список в сеть не ходит (K-14).
//
// Честность важнее удобства: у эндпоинта пять разных ответов, и сводить их к
// «пусто» нельзя.
//   • ось в `facets` — посчитана по всей выдаче;
//   • ось в `unavailable` — НЕ посчитана; это «не знаем», а не ноль;
//   • 400 NOT_FACETABLE (`docs`, `runbooks` под скоупом) — счётчиков у раздела
//     не бывает; список тогда честно показывает числа по странице и говорит это;
//   • 403 SCOPE_EMPTY — нет разрешённых проектов, а не «ничего не нашлось»;
//   • 400 BAD_PARAMS / 5xx / не-JSON — сбой с причиной.
import type { AxisCounts, ListCounts } from '@seidr/kit';
import { loreFetch } from '../auth/session';

const LORE_BASE = '/lore';

/**
 * Ось среза → ключ фасета записи в списке.
 *
 * Два имени у одного поля — потому что их действительно два: срез отдаёт
 * столбец (`release_ids`), а запись kit несёт поле (`fields.release`,
 * `lists/records.ts`). Карта держит их рядом, чтобы они не разошлись молча.
 *
 * **Статусной оси здесь нет, и это не пробел.** Сервер считает
 * `status_category` (шесть категорий оси), а список фильтрует по КОДУ статуса
 * из словаря модели (`planStatusOf`: «📋 PLANNED» → `planned`). Категория и код
 * — разные значения, и счётчик категории, положенный на код, молча показал бы
 * числа не от того поля. Пока сервер не умеет считать ось по кодам, статусный
 * фасет остаётся со счётчиками по загруженным строкам — и список говорит об
 * этом словами.
 *
 * Имена столбцов, кроме `sprint_id` и `components`, на живом сервере ещё не
 * проверены (эндпоинт появится на стенде после промоушна develop → preprod):
 * неизвестная ось — это 400 BAD_PARAMS на ВЕСЬ запрос, поэтому экран берёт из
 * карты только то, что ему нужно, а сбой читается словами, а не нулями.
 */
export const LORE_FACET_AXES: Readonly<Record<string, string>> = {
  sprint_id: 'fields.sprint',
  components: 'fields.components',
  git_projects: 'fields.project',
  release_ids: 'fields.release',
  milestone_ids: 'fields.milestone',
  priority: 'fields.priority',
};

/**
 * Оси под фасеты КОНКРЕТНОГО списка: ключи фасетов (`config.list.filters`) →
 * карта «ось сервера → ключ фасета».
 *
 * Зачем сужать, а не просить всё: неизвестная ось — это 400 BAD_PARAMS на ВЕСЬ
 * запрос, то есть одна лишняя ось лишает счётчиков все остальные. Поэтому
 * спрашиваем только то, по чему этот список и правда фильтрует; чего в карте
 * нет (статус) — остаётся со счётом по загруженным строкам, и список говорит
 * это словами.
 */
export function axesForKeys(keys: readonly string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [axis, key] of Object.entries(LORE_FACET_AXES)) {
    if (keys.includes(key)) out[axis] = key;
  }
  return out;
}

export interface FacetsOptions {
  /** Ось сервера → ключ фасета kit; по умолчанию — вся карта LORE. */
  axes?: Readonly<Record<string, string>>;
  /** Выбранные в шапке проекты (S4-03). */
  scopeProjects?: readonly string[];
  /** Прочие параметры среза (как у `/lore/slice/{id}`): `q`, фильтры полей. */
  params?: Record<string, string>;
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
}

type Row = Record<string, unknown>;

const obj = (v: unknown): Row => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Row) : {});
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const str = (v: unknown): string => (typeof v === 'string' ? v : '');

function isJson(res: Response): boolean {
  return (res.headers.get('content-type') ?? '').includes('json');
}

/** Значения оси: только пары «значение + число», порядок сервера сохраняется. */
function valuesOf(raw: unknown): { value: string; count: number }[] {
  if (!Array.isArray(raw)) return [];
  const out: { value: string; count: number }[] = [];
  for (const v of raw) {
    const row = obj(v);
    const count = num(row.count);
    if (count === null) continue;
    out.push({ value: str(row.value), count });
  }
  return out;
}

/**
 * Одна ось. Итога нет — ось считается НЕ посчитанной: без него не отличить
 * «четыреста записей в двух компонентах» от «четыреста записей»; выдуманный
 * итог превратил бы честную оговорку в тихую неправду.
 */
function axisOf(raw: unknown): AxisCounts | { unavailable: string } {
  const row = obj(raw);
  const total = num(row.total);
  if (total === null) return { unavailable: 'сервер не прислал итог оси' };
  const values = valuesOf(row.values);
  const sum = values.reduce((n, v) => n + v.count, 0);
  const axis: AxisCounts = {
    values,
    empty: num(row.empty) ?? 0,
    nonempty: num(row.nonempty) ?? 0,
    total,
  };
  // Σcount > total — у записи несколько значений (один спринт в двух
  // компонентах). Норма, но её надо назвать, иначе подпись читается как сбой.
  return sum > total ? { ...axis, multi: true } : axis;
}

function completenessOf(raw: unknown): 'complete' | 'partial' | 'unknown' {
  const v = str(raw);
  // Неизвестное слово — «неизвестно», а не «полностью»: полнота по умолчанию
  // была бы тем самым молчаливым обещанием, от которого задача и затеяна.
  return v === 'complete' || v === 'partial' ? v : 'unknown';
}

function capOf(raw: unknown): { parts: string[]; limit: number } | undefined {
  const row = obj(raw);
  const limit = num(row.limit);
  if (limit === null) return undefined;
  const parts = Array.isArray(row.parts) ? row.parts.map(p => str(p)).filter(Boolean) : [];
  return { parts, limit };
}

function urlOf(slice: string, opts: FacetsOptions, axes: Readonly<Record<string, string>>): string {
  const p = new URLSearchParams(opts.params ?? {});
  p.set('axes', Object.keys(axes).join(','));
  if (opts.scopeProjects?.length) p.set('scope_projects', opts.scopeProjects.join(','));
  return `${LORE_BASE}/slice/${encodeURIComponent(slice)}/facets?${p.toString()}`;
}

/**
 * Счётчики по всей выдаче. Отказы возвращаются ЗНАЧЕНИЕМ (`ListCounts`), а не
 * исключением: «не посчитали» — это состояние, которое список обязан показать,
 * а не аварийная ветка. Отмена запроса пробрасывается: она не состояние счёта.
 */
export async function fetchFacets(slice: string, opts: FacetsOptions = {}): Promise<ListCounts> {
  const axes = opts.axes ?? LORE_FACET_AXES;
  const doFetch = opts.fetchImpl ?? loreFetch;
  let res: Response;
  try {
    res = await doFetch(urlOf(slice, opts, axes), {
      ...(opts.signal ? { signal: opts.signal } : {}),
      headers: { Accept: 'application/json' },
    });
  } catch (e) {
    if (opts.signal?.aborted) throw e;
    return { kind: 'failed', reason: e instanceof Error ? e.message : String(e) };
  }
  if (!isJson(res)) {
    // Страница прокси вместо JSON — сбой, в том числе при 200.
    return { kind: 'failed', reason: `ответ не JSON (HTTP ${res.status})` };
  }
  let body: Row = {};
  try {
    body = obj(await res.json());
  } catch {
    return { kind: 'failed', reason: `тело ответа не разобрали (HTTP ${res.status})` };
  }
  if (!res.ok) {
    const code = str(body.error);
    const detail = str(body.detail);
    if (code === 'NOT_FACETABLE') return { kind: 'unsupported' };
    if (res.status === 403) return detail ? { kind: 'forbidden', reason: detail } : { kind: 'forbidden' };
    const reason = [code || `HTTP ${res.status}`, detail].filter(Boolean).join(': ');
    return { kind: 'failed', reason };
  }

  const facets = obj(body.facets);
  const serverUnavailable = obj(body.unavailable);
  const out: Record<string, AxisCounts> = {};
  const unavailable: Record<string, string> = {};
  for (const [axis, key] of Object.entries(axes)) {
    const why = str(serverUnavailable[axis]);
    if (why) { unavailable[key] = why; continue; }
    if (!(axis in facets)) continue;
    const read = axisOf(facets[axis]);
    if ('unavailable' in read) unavailable[key] = read.unavailable;
    else out[key] = read;
  }
  const cap = capOf(body.cap);
  return {
    kind: 'counted',
    axes: out,
    ...(Object.keys(unavailable).length ? { unavailable } : {}),
    completeness: completenessOf(body.completeness),
    ...(cap ? { cap } : {}),
  };
}
