// Маршруты LORE v2: «тип записи → раздел» и разбор адреса — ОДИН модуль
// (SPRINT_UXR_S4_UI_SHELL_LISTS/S4-13, баги B-01, B-02, B-06, B-07 из Q-UXR-4).
//
// В v1 пишущая сторона (src/api/searchRoutes.ts) и читающая (LorePage)
// расходились молча: релиза в карте не было — найденный релиз открывался в
// «Спринтах» (B-02); spec/doc/runbook делят раздел «Знания», и id без вида не
// открывал ничего (B-06); ?section=search&q= терял запрос (B-01); q и фильтры
// уезжали в соседний раздел (B-07). Правила v2:
//   • ссылка на запись ВСЕГДА несёт вид (kind) — id без вида неоднозначен;
//   • неизвестный тип — null, а не тихий дефолтный раздел;
//   • параметры принадлежат разделу; переход снимает их (sectionScopedPatch kit),
//     кроме глобальных (GLOBAL_PARAMS).
// Имена параметров — те же, что у KitShell (mod/sec/view): оболочка и ссылки
// читают один адрес. Чтение — из readUrlState kit (query + «#»-фолбэк).
import { sectionScopedPatch } from '@seidr/kit';

/** Типы выдачи /lore/search (by_type) и старые ссылки (feature). */
export const SEARCH_HIT_TYPES = [
  'adr', 'decision', 'question', 'spec', 'doc', 'runbook', 'sprint', 'task',
  'release', 'quality_gate', 'feature', 'use_case', 'actor', 'agent_actor',
  'pain', 'gain', 'job',
] as const;
export type SearchHitType = (typeof SEARCH_HIT_TYPES)[number];

export interface TypeRoute { sec: string }

/** Куда ведёт запись каждого типа. Добавил тип в поиск — добавь сюда (тест упадёт). */
export const TYPE_ROUTE: Record<SearchHitType, TypeRoute> = {
  adr: { sec: 'adr' },
  decision: { sec: 'decisions' },
  question: { sec: 'questions' },
  spec: { sec: 'knowledge' },
  doc: { sec: 'knowledge' },
  runbook: { sec: 'knowledge' },
  sprint: { sec: 'sprints' },
  task: { sec: 'tasks' },
  release: { sec: 'releases' },
  quality_gate: { sec: 'qg' },
  feature: { sec: 'features' },
  use_case: { sec: 'userStories' },
  actor: { sec: 'actors' },
  agent_actor: { sec: 'actors' },
  pain: { sec: 'vpProfile' },
  gain: { sec: 'vpProfile' },
  job: { sec: 'vpProfile' },
};

export const SEARCH_SECTION = 'search';
/** Параметры, которые переживают смену раздела (навигация оболочки, кроме sec). */
export const GLOBAL_PARAMS: readonly string[] = ['mod'];

export interface LoreRoute {
  sec: string | null;
  /** Запрос раздела поиска; '' — пустой запрос; null — не раздел поиска. */
  q: string | null;
  /** Открытая запись; null — нет или ссылка неполная (нет вида). */
  record: { kind: SearchHitType; id: string } | null;
}

function isHitType(t: string): t is SearchHitType {
  return (SEARCH_HIT_TYPES as readonly string[]).includes(t);
}

function href(params: Record<string, string | null | undefined>, from?: URLSearchParams): string {
  const patch = sectionScopedPatch(from ?? new URLSearchParams(), params, GLOBAL_PARAMS);
  const out = new URLSearchParams(from);
  for (const [k, v] of Object.entries(patch)) {
    if (v == null) out.delete(k);
    else out.set(k, v);
  }
  return `?${out.toString()}`;
}

/** Ссылка на раздел; параметры прежнего раздела (q, фильтры, запись) снимаются. */
export function sectionHref(sec: string, from?: URLSearchParams): string {
  return href({ sec }, from);
}

/** Ссылка на запись из поиска/палитры; null — тип не знаем, открыть честно нечем. */
export function recordHref(type: string, id: string, from?: URLSearchParams): string | null {
  if (!isHitType(type)) return null;
  return href({ sec: TYPE_ROUTE[type].sec, kind: type, rec: id }, from);
}

/** Раздел поиска с набранным запросом (Enter в палитре, закладка). */
export function searchHref(q: string, from?: URLSearchParams): string {
  return href({ sec: SEARCH_SECTION, q: q.trim() }, from);
}

/** Разбор адреса — один для экранов и для теста туда-обратно. */
export function readRoute(params: URLSearchParams): LoreRoute {
  const sec = params.get('sec');
  const q = sec === SEARCH_SECTION ? (params.get('q') ?? '').trim() : null;
  const kind = params.get('kind') ?? '';
  const id = params.get('rec');
  const record = id && isHitType(kind) && (!sec || TYPE_ROUTE[kind].sec === sec) ? { kind, id } : null;
  return { sec, q, record };
}
