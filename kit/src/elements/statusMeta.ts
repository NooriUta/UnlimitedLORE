// Статус → категория, иконка, цвет (S4-00b, D-2026-UXR-STATUS-AXIS).
// Иконки и цвета — копия таблицы v1 (src/components/lore/lore-status.ts; v1
// заморожен, D-2026-UXR-V2-FOLDER-V1-FROZEN, поэтому копия, а не импорт).
// Цвет — постоянная палитра --st-* из seidr.css: у каждого статуса свой оттенок,
// не зависящий от темы. Категория — новая ось v2: по ней звезда группирует
// статусы в порядке жизненного цикла (палитра «2 касания» — S4-07).
//
// Неизвестный статус НЕ сворачивается молча в todo (так делал FALLBACK v1):
// у него своя категория unknown и нейтральный цвет — сбой данных виден.

/** Категории в порядке жизненного цикла; unknown — последней. */
export const STATUS_CATEGORIES = [
  'backlog', 'planned', 'active', 'review', 'done', 'blocked', 'closed', 'unknown',
] as const;
export type StatusCategory = (typeof STATUS_CATEGORIES)[number];

export interface StatusMeta {
  /** Нормализованный код статуса (нижний регистр). */
  code: string;
  category: StatusCategory;
  /** Слаг game-icons. */
  icon: string;
  /** Цвет — всегда токен var(--…). */
  color: string;
}

type Row = [icon: string, colorToken: string, category: StatusCategory];

// S4-07: порядок строк — порядок жизненного цикла внутри категории (по нему
// звезда сортирует пункты палитры); сами категории — в STATUS_CATEGORIES.
const DEFAULT_TABLE: Readonly<Record<string, Row>> = {
  todo:             ['checkbox-tree',  'st-todo', 'backlog'],
  backlog:          ['tied-scroll',    'st-backlog', 'backlog'],
  deferred:         ['pause-button',   'st-deferred', 'backlog'],
  proposed:         ['calendar',       'st-planned', 'planned'],
  design:           ['magic-swirl',    'st-design', 'planned'],
  planned:          ['calendar',       'st-planned', 'planned'],
  upcoming:         ['progression',    'st-active', 'active'],
  active:           ['progression',    'st-active', 'active'],
  in_progress:      ['progression',    'st-active', 'active'],
  partial:          ['battery-50',     'st-partial', 'active'],
  done:             ['divided-spiral', 'st-done', 'done'],
  fixed:            ['divided-spiral', 'st-done', 'done'],
  reached:          ['divided-spiral', 'st-done', 'done'],
  accepted:         ['laurel-crown',   'st-done', 'done'],
  blocked:          ['handcuffed',     'st-blocked', 'blocked'],
  superseded:       ['pause-button',   'st-deferred', 'closed'],
  rejected:         ['crossed-sabres', 'st-blocked', 'closed'],
  missed:           ['crossed-sabres', 'st-blocked', 'closed'],
  cancelled:        ['cross-mark',     'st-cancelled', 'closed'],
};

// K-14 (S7B-23_2): статусы рабочего процесса приложения (у LORE — «к выкатке», UAT)
// регистрирует приложение; kit держит общий словарь и механизм.
let TABLE: Record<string, Row> = { ...DEFAULT_TABLE };
let LABELS: Record<string, Partial<Record<'ru' | 'en', string>>> = {};

/** Известные коды статусов в порядке жизненного цикла (для палитры и тестов). Живой список: регистрация дописывает. */
export const KNOWN_STATUSES: string[] = Object.keys(TABLE);

/** Статус приложения: иконка (слаг), токен цвета (имя без var), категория, подпись. */
export interface StatusRow {
  icon: string;
  color: string;
  category: StatusCategory;
  label?: Partial<Record<'ru' | 'en', string>>;
}

/**
 * Зарегистрировать статусы приложения. `after` — код, за которым они встают в
 * жизненном цикле; нет — в конец. Неизвестный якорь — отказ словами.
 */
export function registerStatuses(rows: Record<string, StatusRow>, opts: { after?: string } = {}): void {
  let at = KNOWN_STATUSES.length;
  if (opts.after !== undefined) {
    const i = KNOWN_STATUSES.indexOf(opts.after);
    if (i < 0) throw new Error(`registerStatuses: нет статуса «${opts.after}», за которым встать`);
    at = i + 1;
  }
  for (const [raw, r] of Object.entries(rows)) {
    const code = raw.trim().toLowerCase();
    TABLE[code] = [r.icon, r.color, r.category];
    if (r.label) LABELS[code] = r.label;
    if (!KNOWN_STATUSES.includes(code)) KNOWN_STATUSES.splice(at++, 0, code);
  }
}

/** Вернуть словарь kit (тесты, смена приложения). */
export function resetStatuses(): void {
  TABLE = { ...DEFAULT_TABLE };
  LABELS = {};
  KNOWN_STATUSES.splice(0, KNOWN_STATUSES.length, ...Object.keys(DEFAULT_TABLE));
}

/** Подпись статуса, зарегистрированная приложением; нет — undefined. */
export function statusLabel(status: string | null | undefined, lang: 'ru' | 'en'): string | undefined {
  return LABELS[(status ?? '').trim().toLowerCase()]?.[lang];
}

export function statusMeta(status: string | null | undefined): StatusMeta {
  const code = (status ?? '').trim().toLowerCase();
  const row = TABLE[code];
  if (!row) return { code, category: 'unknown', icon: 'help', color: 'var(--t3)' };
  const [icon, token, category] = row;
  return { code, category, icon, color: `var(--${token})` };
}

/**
 * Завершающие категории (S4-07): после них работа над записью закончена, и
 * случайное касание дорого — палитра просит третий шаг. Обе оси: категории
 * звезды (done/closed) и контракта ядра K-05 (done/cancelled). blocked —
 * не завершение (работа вернётся), unknown — не утверждаем.
 */
export const FINAL_CATEGORIES: readonly string[] = ['done', 'closed', 'cancelled'];

export function isFinalCategory(category: string | null | undefined): boolean {
  return FINAL_CATEGORIES.includes(category ?? '');
}

/** Завершающий ли статус (по таблице звезды). */
export function isFinalStatus(status: string | null | undefined): boolean {
  return isFinalCategory(statusMeta(status).category);
}

function rank(code: string): [number, number] {
  const m = statusMeta(code);
  return [STATUS_CATEGORIES.indexOf(m.category), KNOWN_STATUSES.includes(m.code) ? KNOWN_STATUSES.indexOf(m.code) : Number.MAX_SAFE_INTEGER];
}

/**
 * Коды в порядке жизненного цикла: по категориям, внутри — по таблице;
 * неизвестные — в конце по алфавиту. Дубли (без учёта регистра) — по первому.
 */
export function sortStatusesByLifecycle(codes: readonly string[]): string[] {
  const seen = new Set<string>();
  const uniq = codes.filter((c) => {
    const k = statusMeta(c).code;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  return uniq.sort((a, b) => {
    const [ca, ia] = rank(a);
    const [cb, ib] = rank(b);
    if (ca !== cb) return ca - cb;
    if (ia !== ib) return ia - ib;
    return statusMeta(a).code.localeCompare(statusMeta(b).code);
  });
}

export interface StatusGroup {
  category: StatusCategory;
  codes: string[];
}

/** Коды, сгруппированные по категориям в порядке цикла; пустые группы пропущены. */
export function groupStatusesByLifecycle(codes: readonly string[]): StatusGroup[] {
  const groups: StatusGroup[] = [];
  for (const code of sortStatusesByLifecycle(codes)) {
    const category = statusMeta(code).category;
    const last = groups[groups.length - 1];
    if (last && last.category === category) last.codes.push(code);
    else groups.push({ category, codes: [code] });
  }
  return groups;
}
