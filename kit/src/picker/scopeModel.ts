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
  /**
   * PS-PRODUCT-FILTER: код родителя (подпродукт под продуктом). Родитель есть в списке — запись показывается в дереве
   * под ним (раскрывашкой); родителя в списке нет — запись остаётся корнем.
   */
  parent?: string;
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

/**
 * PS-PRODUCT-FILTER: дерево по `parent` — корни (без родителя или с родителем вне списка) и потомки каждого родителя,
 * в порядке списка.
 */
export function scopeTree(options: readonly ScopeOption[]): { roots: ScopeOption[]; children: Map<string, ScopeOption[]> } {
  const ids = new Set(options.map(o => o.id));
  const roots: ScopeOption[] = [];
  const children = new Map<string, ScopeOption[]>();
  for (const o of options) {
    if (o.parent && o.parent !== o.id && ids.has(o.parent)) children.set(o.parent, [...(children.get(o.parent) ?? []), o]);
    else roots.push(o);
  }
  return { roots, children };
}

/** Родители (по цепочке) выбранных записей — их раскрыть, чтобы выбранный потомок был виден. */
export function scopeAncestors(value: readonly string[], options: readonly ScopeOption[]): Set<string> {
  const byId = new Map(options.map(o => [o.id, o]));
  const out = new Set<string>();
  for (const id of value) {
    let p = byId.get(id)?.parent;
    while (p && byId.has(p) && !out.has(p)) { out.add(p); p = byId.get(p)?.parent; }
  }
  return out;
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

/**
 * S9-04 (второй шаг): выбор с режимом «все, кроме…». `except: false` — показаны `ids`
 * (пусто — все); `except: true` — показаны все, КРОМЕ `ids`.
 */
export interface ScopeSelection { except: boolean; ids: string[] }

/** `a,b` — выбор; `!a,!b` — все, кроме a и b; `!` — режим исключения без исключённых. */
export function parseScopeSelection(raw: string | null | undefined): ScopeSelection {
  if (!raw) return { except: false, ids: [] };
  const parts = raw.split(',').map(p => p.trim()).filter(Boolean);
  if (!parts.some(p => p.startsWith('!'))) return { except: false, ids: parseScopeParam(raw) };
  const ids: string[] = [];
  for (const p of parts) {
    const id = p.replace(/^!+/, '').trim();
    if (id && !ids.includes(id)) ids.push(id);
  }
  return { except: true, ids };
}

/** Обратное к parseScopeSelection; обычный пустой выбор — параметра нет. */
export function formatScopeSelection(s: ScopeSelection): string | null {
  if (!s.except) return formatScopeParam(s.ids);
  return s.ids.length ? s.ids.map(id => `!${id}`).join(',') : '!';
}

/**
 * Выбор → список показываемых проектов для экранов. «Кроме» раскрывается по ПОЛНОМУ
 * списку `all`; никого не исключили — пусто (фильтра нет = все).
 */
export function resolveScopeSelection(s: ScopeSelection, all: readonly string[]): string[] {
  if (!s.except) return [...s.ids];
  if (s.ids.length === 0) return [];
  const out = new Set(s.ids);
  return all.filter(id => !out.has(id));
}
