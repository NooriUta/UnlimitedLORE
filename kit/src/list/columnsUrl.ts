// Набор колонок списка в адресе (SPRINT_UXR_S4_UI_SHELL_LISTS/S4-35).
//
// По прототипу владелицы (docs/prototypes/s4-35-columns.html) набор колонок
// уходит в адрес (`?cols=`), а ширины — нет: ширин много и строка выходит
// нечитаемой. Решение владелицы 08.11.2026: «ширина личная, набор командный».
//
// Адрес правит человек и пересылает ссылку, поэтому содержимое считается
// недоверенным: неизвестная колонка отбрасывается, а не ломает список, и не
// превращается в пустой столбец без заголовка.

/**
 * Набор колонок из строки запроса.
 *
 * `undefined` — в адресе ничего нет (или не осталось после отсева). Это не то
 * же самое, что «колонок нет»: пустой набор сделал бы список без единого
 * столбца, а отсутствие параметра значит «бери умолчание».
 *
 * @param search строка запроса (с «?» или без)
 * @param known  колонки, которые существуют у этого типа
 * @param locked колонка, которую нельзя убрать (обычно название записи)
 * @param param  имя параметра; по умолчанию «cols». Своё имя нужно, когда на
 *   одной странице два набора колонок — например док показывает список и
 *   паспорт сразу, и «cols» списка не должен значить колонки задач паспорта.
 */
export function columnsFromUrl(
  search: string,
  known: readonly string[],
  locked?: string,
  param = 'cols',
): string[] | undefined {
  const raw = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search).get(param);
  if (!raw) return undefined;

  const seen = new Set<string>();
  const cols: string[] = [];
  for (const part of raw.split(',')) {
    const key = part.trim();
    if (!key || seen.has(key) || !known.includes(key)) continue;
    seen.add(key);
    cols.push(key);
  }
  if (cols.length === 0) return undefined;

  // Запертую колонку возвращаем на первое место: её могли убрать правкой
  // адреса руками, а список без названия записи нечитаем.
  if (locked && !seen.has(locked)) cols.unshift(locked);
  return cols;
}

/** Набор колонок в строку запроса — для ссылки, которой делятся. */
export function columnsToUrlValue(cols: readonly string[]): string {
  return cols.join(',');
}
