// Модель «Библиотеки» (SPRINT_UXR_S10_SEIDR_KIT_2/K2-VIEW-LIBRARY).
//
// Прототип утверждён владелицей 11.11.2026: «Библиотека и Календарь — два
// общих вида kit, утверждаю». Владельца (компонент, рубрика, тег…), группы,
// их порядок и что значит «устарел» называет приложение — kit только
// показывает. Чистая функция: поиск и фильтр по загруженному.
//
// Правила, закреплённые тестом:
//   • поиск — по коду и названию, без регистра; группа без совпадений уходит;
//   • фильтр: все / актуальные / устарели; счёт устаревших — по всему загруженному,
//     а не по найденному (чип не должен «мигать» от набора в поиске).

export interface LibraryDoc {
  id: string;
  /** Код документа (ADR-…, SPEC-…) — моноширинно перед названием. */
  code?: string;
  title: string;
  /** Состояние словом приложения: «принят», «1.3», «черновик». */
  state?: string;
  /** Устарел — решает приложение (заменён, отозван, давно не правили…). */
  stale?: boolean;
  /** Строка над заголовком в читалке: «принят 08.11 · автор». */
  meta?: string;
  /** Тело markdown для чтения на месте; нет — читалка покажет только шапку. */
  body?: string;
}

export interface LibraryGroup {
  key: string;
  title: string;
  /** Сколько документов в группе всего; больше загруженных — вид скажет «показаны N из M». */
  total?: number;
  docs: LibraryDoc[];
}

export type LibraryFilter = 'all' | 'fresh' | 'stale';

export interface LibraryModel {
  groups: LibraryGroup[];
  staleCount: number;
}

export function libraryModel(groups: readonly LibraryGroup[], { query, filter }: { query: string; filter: LibraryFilter }): LibraryModel {
  const q = query.trim().toLocaleLowerCase();
  const staleCount = groups.reduce((n, g) => n + g.docs.filter(d => d.stale).length, 0);
  const keep = (d: LibraryDoc) =>
    (filter === 'all' || (filter === 'stale') === Boolean(d.stale))
    && (!q || d.title.toLocaleLowerCase().includes(q) || (d.code ?? '').toLocaleLowerCase().includes(q));
  const narrowed = q || filter !== 'all';
  const out = groups
    .map(g => (narrowed ? { ...g, total: undefined, docs: g.docs.filter(keep) } : g))
    .filter(g => g.docs.length > 0);
  return { groups: out, staleCount };
}
