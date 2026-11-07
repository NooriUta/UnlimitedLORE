// Модель выбора «области» — нескольких проектов в шапке
// (SPRINT_UXR_S4_UI_SHELL_LISTS/S4-03). Чистые функции без React: поиск,
// «все мои», «только этот», подпись кнопки, параметр URL.
//
// Пустой выбор = фильтра нет = «все проекты». Отдельного «ничего не выбрано»
// нет: экран без единого проекта — это не выбор, а пустота, которой незачем
// быть состоянием.

export interface ScopeOption {
  /** Код (slug) — он же значение в URL. */
  id: string;
  /** Название для людей; нет — показываем код. */
  title?: string;
  /** Вторая строка (например, ветка по умолчанию). */
  hint?: string;
  /** У пользователя есть роль в проекте. */
  mine?: boolean;
}

export type ScopeSummary =
  | { kind: 'all' }
  | { kind: 'mine'; count: number }
  | { kind: 'one'; id: string; title: string }
  | { kind: 'many'; count: number };

/** Сравнение без регистра и с ё=е: кириллица ищется так же, как латиница. */
function fold(s: string): string {
  return s.toLocaleLowerCase('ru').replace(/ё/g, 'е');
}

export function scopeTitle(o: ScopeOption): string {
  return o.title?.trim() || o.id;
}

/** Поиск по коду, названию и подсказке; пустой запрос — все. */
export function filterScopeOptions(options: readonly ScopeOption[], query: string): ScopeOption[] {
  const q = fold(query.trim());
  if (!q) return [...options];
  return options.filter(o => [o.id, o.title ?? '', o.hint ?? ''].some(s => fold(s).includes(q)));
}

/** Мои — первыми (если роли проверены), внутри групп — по названию. */
export function orderScopeOptions(options: readonly ScopeOption[], mineKnown: boolean): ScopeOption[] {
  const byTitle = (a: ScopeOption, b: ScopeOption) => scopeTitle(a).localeCompare(scopeTitle(b), 'ru', { sensitivity: 'base' });
  if (!mineKnown) return [...options].sort(byTitle);
  return [...options].sort((a, b) => Number(!!b.mine) - Number(!!a.mine) || byTitle(a, b));
}

export function toggleScope(value: readonly string[], id: string): string[] {
  return value.includes(id) ? value.filter(x => x !== id) : [...value, id];
}

export function onlyScope(id: string): string[] {
  return [id];
}

/** Проекты с ролью — в порядке списка. */
export function mineScope(options: readonly ScopeOption[]): string[] {
  return options.filter(o => o.mine).map(o => o.id);
}

/** Выбранные коды, которых нет в списке: показать с пометкой, а не выбросить. */
export function unknownScopeIds(value: readonly string[], options: readonly ScopeOption[]): string[] {
  const known = new Set(options.map(o => o.id));
  return value.filter(id => !known.has(id));
}

export function summarizeScope(value: readonly string[], options: readonly ScopeOption[], mineKnown: boolean): ScopeSummary {
  if (value.length === 0) return { kind: 'all' };
  if (mineKnown) {
    const mine = new Set(mineScope(options));
    if (mine.size > 0 && mine.size === value.length && value.every(id => mine.has(id))) {
      return { kind: 'mine', count: mine.size };
    }
  }
  if (value.length === 1) {
    const id = value[0];
    const o = options.find(x => x.id === id);
    return { kind: 'one', id, title: o ? scopeTitle(o) : id };
  }
  return { kind: 'many', count: value.length };
}

/** `a,b` → ['a','b']: пробелы, пустые и дубли из адреса отбрасываются. */
export function parseScopeParam(raw: string | null | undefined): string[] {
  if (!raw) return [];
  const out: string[] = [];
  for (const part of raw.split(',')) {
    const id = part.trim();
    if (id && !out.includes(id)) out.push(id);
  }
  return out;
}

/** Пустой выбор — параметра в URL нет. */
export function formatScopeParam(value: readonly string[]): string | null {
  return value.length ? value.join(',') : null;
}
