// Статус задачи/спринта LORE для v2 (SPRINT_UXR_S4_UI_SHELL_LISTS/S4-09).
//
// Слайсы отдают status_raw — свободный текст после маркера («✅ MERGED — влито»).
// Читается он словарём statusMatch из shared/lore-statuses.json (QG-13): маркер
// или слово В НАЧАЛЕ строки, никогда подстрокой («NOT DONE» ≠ done). Образ v2
// shared/ не видит (web-next/Dockerfile копирует поимённо), поэтому здесь копия,
// а расхождение с shared ловит sprints.test.tsx.
//
// Нераспознанное — 'unknown', а не todo: сбой данных должен быть виден.
import type { KitConfig } from '@seidr/kit';
import { statusMeta } from '@seidr/kit';

export const STATUS_MATCH: Record<string, { marker: string; words: string[] }> = {
  done: { marker: '✅', words: ['DONE', 'CLOSED', 'MERGED', 'ЗАВЕРШ', 'ЗАКРЫТ'] },
  in_progress: { marker: '🔄', words: ['IN PROGRESS', 'IN-PROGRESS', 'PROGRESS', 'WIP', 'ACTIVE'] },
  partial: { marker: '🟡', words: ['PARTIAL', 'ЧАСТИЧ'] },
  ready_for_deploy: { marker: '🚀', words: ['READY', 'RFD', 'К ДЕПЛОЮ', 'ДЕПЛО'] },
  uat: { marker: '🧪', words: ['UAT', 'ПРИЁМК', 'ПРИЕМК'] },
  blocked: { marker: '🔴', words: ['BLOCK', 'ЗАБЛОК'] },
  cancelled: { marker: '🚫', words: ['CANCEL', 'ОТМЕН'] },
  design: { marker: '🔬', words: ['DESIGN', 'ДИЗАЙН', 'ПРОЕКТ'] },
  backlog: { marker: '🟣', words: ['BACKLOG', 'БЭКЛОГ', 'БЭКЛ'] },
  planned: { marker: '📋', words: ['PLANNED', 'ЗАПЛАН', 'ПЛАН'] },
  deferred: { marker: '⏸', words: ['DEFER', 'ОТЛОЖ', 'HOLD', 'PAUSE', 'CONDITION', 'УСЛОВН', 'ПАУ'] },
  todo: { marker: '⬜', words: ['TODO', 'TO DO', 'НЕ НАЧАТ'] },
};

/** Статусы, которые принимает POST /lore/status (planStatuses в shared). */
export const PLAN_STATUSES = [
  'todo', 'active', 'partial', 'done', 'blocked', 'cancelled', 'planned', 'backlog', 'design', 'ready_for_deploy', 'uat',
] as const;
export type PlanStatus = (typeof PLAN_STATUSES)[number];
/** Прочитанный статус: пишемый, отложенный (читается, но не пишется) или нераспознанный. */
export type ReadStatus = PlanStatus | 'deferred' | 'unknown';

/** Канон словаря → код статуса плана (in_progress пишется как active). */
const CANON_TO_CODE: Record<string, ReadStatus> = { in_progress: 'active' };

export function planStatusOf(raw: string | null | undefined): ReadStatus {
  const s = (raw ?? '').trim();
  if (!s) return 'unknown';
  const lower = s.toLowerCase();
  if ((PLAN_STATUSES as readonly string[]).includes(lower)) return lower as PlanStatus;
  // Голый канонический код словаря («in_progress», «deferred») — тоже статус, не «вне словаря».
  if (Object.prototype.hasOwnProperty.call(STATUS_MATCH, lower)) return CANON_TO_CODE[lower] ?? (lower as ReadStatus);
  for (const [canon, m] of Object.entries(STATUS_MATCH)) {
    if (s.startsWith(m.marker)) return CANON_TO_CODE[canon] ?? (canon as ReadStatus);
  }
  const upper = s.toUpperCase();
  for (const [canon, m] of Object.entries(STATUS_MATCH)) {
    if (m.words.some(w => upper.startsWith(w))) return CANON_TO_CODE[canon] ?? (canon as ReadStatus);
  }
  return 'unknown';
}

export const isDone = (s: ReadStatus) => s === 'done';
export const isWithdrawn = (s: ReadStatus) => s === 'cancelled';

/** Порядок жизненного цикла для палитры статусов. */
const LIFECYCLE: ReadStatus[] = [
  'backlog', 'todo', 'planned', 'design', 'active', 'partial', 'blocked', 'ready_for_deploy', 'uat', 'done', 'cancelled', 'deferred',
];
const CATEGORY: Record<string, 'todo' | 'active' | 'done' | 'cancelled'> = {
  backlog: 'todo', todo: 'todo', planned: 'todo', design: 'todo', deferred: 'todo',
  active: 'active', partial: 'active', blocked: 'active', ready_for_deploy: 'active', uat: 'active',
  done: 'done', cancelled: 'cancelled',
};

/**
 * Статусы плана LORE для kit. Переходы (allow) — только в пишемые статусы:
 * «отложено» видно, но поставить его через /lore/status нельзя — пункт не
 * предлагается, вместо того чтобы падать 400 после касания.
 */
export function planStatuses(title: (code: ReadStatus) => string): KitConfig['statuses'] {
  return {
    items: LIFECYCLE.map(code => {
      const m = statusMeta(code);
      return {
        code,
        title: title(code),
        category: CATEGORY[code],
        icon: m.icon,
        color: m.color,
        allow: PLAN_STATUSES.filter(p => p !== code),
      };
    }),
    // →done у задачи идёт через reviewer-гейт бэкенда (ADR-LORE-014 §4).
    selfApprove: false,
    undo: true,
  };
}
