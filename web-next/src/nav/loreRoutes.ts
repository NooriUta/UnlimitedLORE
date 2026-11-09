// Маршруты LORE v2: «тип записи → раздел» и разбор адреса — ОДИН модуль
// (SPRINT_UXR_S4_UI_SHELL_LISTS/S4-13, баги B-01, B-02, B-06, B-07 из Q-UXR-4).
//
// ПЕРЕОТКРЫТО 09.11.2026 (владелица: «у вас была задача унификация ссылок,
// почему такой бардак»). Модуль был объявлен единственным, но вне своего теста
// его не вызывал никто, и он описывал уже не ту схему (sec=decisions/tasks,
// kind/rec), а адреса собирали сами: список, палитра, лента (адресами v1). На
// проде ссылки из ленты открывали запись без меню или не открывали вовсе.
// Теперь здесь — схема оболочки v2, и сторож loreRoutes.test.ts требует, чтобы
// карту «тип → раздел» и адрес записи нигде больше не собирали руками.
//
// Правила v2:
//   • запись живёт в разделе своего типа и открывается ?open=<id> (его читает
//     ListScreen); адрес всегда от корня «/» — ссылка с отдельной страницы
//     тоже приводит в оболочку, меню не пропадает;
//   • неизвестный тип или тип без раздела в v2 — null, а не тихий дефолтный
//     раздел (честное «не умеем открыть»);
//   • параметры принадлежат разделу; переход снимает их (sectionScopedPatch kit),
//     кроме глобальных (GLOBAL_PARAMS).
import { sectionScopedPatch } from '@seidr/kit';
import { V2_SECTIONS, type V2Section } from '../shell/v2Config';

/** Типы выдачи /lore/search (by_type) и старые ссылки (feature). */
export const SEARCH_HIT_TYPES = [
  'adr', 'decision', 'question', 'spec', 'doc', 'runbook', 'sprint', 'task',
  'release', 'quality_gate', 'feature', 'use_case', 'actor', 'agent_actor',
  'pain', 'gain', 'job',
] as const;
export type SearchHitType = (typeof SEARCH_HIT_TYPES)[number];

/**
 * Тип записи → раздел v2. Единственная такая карта в приложении.
 * Технологии — это спеки SPEC-TECH-*: поиск отдаёт их типом spec, своей строки нет.
 * Типов без раздела в v2 (doc, runbook, quality_gate, use_case, actor…) здесь нет:
 * открыть их в v2 пока негде, и ссылка честно null.
 */
export const TYPE_SECTION: Readonly<Record<string, V2Section>> = {
  sprint: 'sprint',
  task: 'task',
  milestone: 'milestone',
  release: 'release',
  adr: 'adr',
  decision: 'decision',
  spec: 'spec',
  question: 'question',
  component: 'component',
  feature: 'feature',
};

/** Модуль оболочки по умолчанию: адрес записи без модуля открывал бы «Новости». */
export const DEFAULT_MOD = 'forseti';
export const SEARCH_SECTION = 'search';
/** Параметры, которые переживают смену раздела (навигация оболочки, кроме sec). */
export const GLOBAL_PARAMS: readonly string[] = ['mod'];

export interface LoreRoute {
  sec: string | null;
  /** Запрос раздела поиска; '' — пустой запрос; null — не раздел поиска. */
  q: string | null;
  /** Открытая запись; null — нет записи или раздел не раздел записей. */
  record: { kind: string; id: string } | null;
}

export function sectionOfType(type: string | null | undefined): V2Section | null {
  return (type && Object.prototype.hasOwnProperty.call(TYPE_SECTION, type)) ? TYPE_SECTION[type] : null;
}

/** Обратная карта: раздел → тип записи (у каждого раздела записей тип один). */
function typeOfSection(sec: string): string | null {
  for (const [t, s] of Object.entries(TYPE_SECTION)) if (s === sec) return t;
  return null;
}

function href(params: Record<string, string | null | undefined>, from?: URLSearchParams): string {
  const base = from ?? new URLSearchParams();
  const patch = sectionScopedPatch(base, params, GLOBAL_PARAMS);
  const out = new URLSearchParams(base);
  for (const [k, v] of Object.entries(patch)) {
    if (v == null) out.delete(k);
    else out.set(k, v);
  }
  if (!out.get('mod')) out.set('mod', DEFAULT_MOD);
  // mod первым — как пишет оболочка; порядок не влияет на разбор, но адрес читается.
  const ordered = new URLSearchParams();
  ordered.set('mod', out.get('mod')!);
  for (const [k, v] of out) if (k !== 'mod') ordered.append(k, v);
  return `/?${ordered.toString()}`;
}

/** Ссылка на раздел; параметры прежнего раздела (q, фильтры, запись) снимаются. */
export function sectionHref(sec: string, from?: URLSearchParams): string {
  return href({ sec }, from);
}

/**
 * Код записи в списке раздела. У релиза — пара «проект#версия» (release_uid):
 * один номер версии живёт в нескольких репозиториях. Код уже с «#» не дополняется
 * (на проде проект удваивался: NooriUta/X#NooriUta/X#v1.17.5).
 */
export function recordIdOf(type: string, id: string, project?: string | null): string {
  if (type !== 'release' || id.includes('#') || !project) return id;
  return `${project}#${id}`;
}

/** Ссылка на запись: раздел её типа + ?open=<id>; null — тип в v2 открыть негде. */
export function recordHref(type: string, id: string, from?: URLSearchParams): string | null {
  const sec = sectionOfType(type);
  if (!sec || !id) return null;
  return href({ sec, open: id }, from);
}

/** Раздел поиска с набранным запросом (Enter в палитре, закладка). */
export function searchHref(q: string, from?: URLSearchParams): string {
  return href({ sec: SEARCH_SECTION, q: q.trim() }, from);
}

/** Разбор адреса — один для экранов и для теста туда-обратно. */
export function readRoute(params: URLSearchParams): LoreRoute {
  const sec = params.get('sec');
  const q = sec === SEARCH_SECTION ? (params.get('q') ?? '').trim() : null;
  const id = params.get('open');
  const kind = sec && (V2_SECTIONS as readonly string[]).includes(sec) ? typeOfSection(sec) : null;
  return { sec, q, record: id && kind ? { kind, id } : null };
}
