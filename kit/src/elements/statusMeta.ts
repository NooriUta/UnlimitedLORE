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

const TABLE: Record<string, Row> = {
  done:             ['divided-spiral', 'st-done', 'done'],
  fixed:            ['divided-spiral', 'st-done', 'done'],
  reached:          ['divided-spiral', 'st-done', 'done'],
  accepted:         ['laurel-crown',   'st-done', 'done'],
  active:           ['progression',    'st-active', 'active'],
  in_progress:      ['progression',    'st-active', 'active'],
  upcoming:         ['progression',    'st-active', 'active'],
  partial:          ['battery-50',     'st-partial', 'active'],
  ready_for_deploy: ['wave-crest',     'st-ready_for_deploy', 'review'],
  planned:          ['calendar',       'st-planned', 'planned'],
  proposed:         ['calendar',       'st-planned', 'planned'],
  design:           ['magic-swirl',    'st-design', 'planned'],
  backlog:          ['tied-scroll',    'st-backlog', 'backlog'],
  todo:             ['checkbox-tree',  'st-todo', 'backlog'],
  deferred:         ['pause-button',   'st-deferred', 'backlog'],
  blocked:          ['handcuffed',     'st-blocked', 'blocked'],
  rejected:         ['crossed-sabres', 'st-blocked', 'closed'],
  missed:           ['crossed-sabres', 'st-blocked', 'closed'],
  superseded:       ['pause-button',   'st-deferred', 'closed'],
  cancelled:        ['cross-mark',     'st-cancelled', 'closed'],
};

/** Известные коды статусов (для палитры и тестов). */
export const KNOWN_STATUSES = Object.keys(TABLE);

export function statusMeta(status: string | null | undefined): StatusMeta {
  const code = (status ?? '').trim().toLowerCase();
  const row = TABLE[code];
  if (!row) return { code, category: 'unknown', icon: 'help', color: 'var(--t3)' };
  const [icon, token, category] = row;
  return { code, category, icon, color: `var(--${token})` };
}
