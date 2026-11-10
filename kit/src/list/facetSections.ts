// Фасет на объёме: блоки вместо простыни (SPRINT_UXR_S9_SCALE_OPT/S9-03).
//
// У оси бывает несколько сотен значений (замер третьего круга критики — 428 на
// одной оси). Плоский список такой длины не читается: нужное значение ищут
// глазами, а отмеченное уезжает вниз, туда, куда его увёл счёт. Поэтому панель
// фасета складывается сверху вниз: ВЫБРАННЫЕ → ЗАКРЕПЛЁННЫЕ → ЧАСТЫЕ, а
// остальное достаётся поиском.
//
// Здесь только форма (K-14): «ось», «значение», «закреплено приложением». Что
// это за ось и почему какие-то значения закреплены — знает приложение; оно же
// передаёт список закреплённых данными. Предметных имён в kit нет.
//
// Про честность чисел. Порядок значений НЕ задаётся здесь: на вход приходит
// тот порядок, в котором значения показаны человеку, и блок «частых» — это
// просто его начало. Поэтому «частые» всегда совпадают с теми числами, что
// видны рядом; если числа посчитаны по загруженным строкам, это «частые среди
// загруженного», и так это и подписано (`ranked` + подпись в панели). Когда
// чисел нет вовсе, блок частым не называется — утверждать нечем.

/** Значение оси со счётчиком. */
export interface FacetValue { value: string; count: number }

/**
 * Порог и размеры блоков фасета — ОДНИМ местом.
 *
 * `findFrom` — с какого числа значений ось перестаёт быть обозримой: до него
 * панель рисует плоский список (разделы на девяти значениях только мешают), с
 * него появляются поиск и блоки. То же число у поиска по группам списка
 * (S9-02): «их стало много» — один смысл, одно число.
 *
 * `block` — сколько значений показывать в блоке первого экрана. Остаток не
 * прячется молча: его называют числом (см. `FacetBlock.hidden`).
 */
export const FACET_SCALE = {
  findFrom: 10,
  block: 8,
} as const;

/**
 * Блоки фасета сверху вниз:
 * • `all` — плоский список: значений мало, разделять нечего (подписи нет);
 * • `picked` — отмеченные: всегда первыми, целиком и без обрезки, иначе не
 *   видно, по чему отфильтровано, и снять фильтр нечем;
 * • `pinned` — закреплённые приложением (его знание, наши данные);
 * • `frequent` — с наибольшим счётом (есть числа, по которым это утверждение
 *   верно);
 * • `first` — начало списка, когда чисел нет: «частыми» их называть нельзя;
 * • `found` — найденные поиском.
 */
export type FacetBlockKind = 'all' | 'picked' | 'pinned' | 'frequent' | 'first' | 'found';

export interface FacetBlock {
  kind: FacetBlockKind;
  values: FacetValue[];
  /** Сколько значений блока НЕ показано. Называется числом, а не многоточием. */
  hidden: number;
}

export interface FacetSectionsInput {
  /** Все значения оси ПОРЯДКОМ ПОКАЗА: их числа — те, что видит человек. */
  values: readonly FacetValue[];
  /** Отмеченные значения фильтра. Значений, которых нет в оси, блок не выдумывает. */
  picked: readonly string[];
  /** Что приложение держит под рукой: его порядок сохраняется (он осмысленный). */
  pinned?: readonly string[];
  /** Запрос поиска. Ниже порога поиска нет, и запрос не учитывается. */
  query?: string;
  /** Текст значения для поиска: по умолчанию само значение, у подписей — подпись. */
  haystack?: (value: string) => string;
  /** Годятся ли числа на утверждение «частые». Нет — блок называется `first`. */
  ranked?: boolean;
}

export interface FacetSectionsResult {
  blocks: FacetBlock[];
  /** Всего значений в оси — чтобы «показано 8» не читалось как «их восемь». */
  total: number;
  /** Нужно поле поиска: значений больше порога. */
  search: boolean;
  /**
   * Запрос задан и не совпал НИ С ОДНИМ значением оси. Это «по запросу ничего»,
   * а не «значений нет»: пустая ось — другое состояние (`total === 0`).
   */
  noMatch: boolean;
}

function cut(values: FacetValue[], limit: number): FacetBlock['values'] {
  return values.length > limit ? values.slice(0, limit) : values;
}

/** Разложить значения оси по блокам. Чистая функция: вход не мутируется. */
export function facetSections(input: FacetSectionsInput): FacetSectionsResult {
  const { values, picked, pinned, query = '', haystack, ranked = true } = input;
  const total = values.length;
  const search = total > FACET_SCALE.findFrom;
  if (!search) {
    // Ниже порога — как было: один плоский список целиком, без поиска.
    return { blocks: total ? [{ kind: 'all', values: [...values], hidden: 0 }] : [], total, search, noMatch: false };
  }

  const blocks: FacetBlock[] = [];
  const shown = new Set<string>();
  const add = (kind: FacetBlockKind, vals: FacetValue[], limit?: number) => {
    if (!vals.length) return;
    const head = limit === undefined ? vals : cut(vals, limit);
    for (const v of head) shown.add(v.value);
    blocks.push({ kind, values: [...head], hidden: vals.length - head.length });
  };

  const pickedSet = new Set(picked);
  add('picked', values.filter(v => pickedSet.has(v.value)));

  const needle = query.trim().toLocaleLowerCase();
  if (needle) {
    const hay = (v: FacetValue) => `${v.value} ${haystack ? haystack(v.value) : ''}`.toLocaleLowerCase();
    // Совпадения ищутся по ВСЕЙ оси, а показываются без уже показанных: иначе
    // «по запросу ничего» прозвучало бы над блоком, где это значение стоит.
    const hits = values.filter(v => hay(v).includes(needle));
    add('found', hits.filter(v => !shown.has(v.value)), FACET_SCALE.block);
    return { blocks, total, search, noMatch: hits.length === 0 };
  }

  const byValue = new Map(values.map(v => [v.value, v]));
  const near: FacetValue[] = [];
  for (const p of pinned ?? []) {
    const v = byValue.get(p);
    if (v && !shown.has(p)) near.push(v);
  }
  add('pinned', near);

  add(ranked ? 'frequent' : 'first', values.filter(v => !shown.has(v.value)), FACET_SCALE.block);
  return { blocks, total, search, noMatch: false };
}
