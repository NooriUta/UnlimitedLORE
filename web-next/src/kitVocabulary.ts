// Словарь LORE поверх нейтральных строк kit (K-14, SPRINT_UXR_S7B_ADMIN/S7B-23_2).
// kit не знает, что у LORE «спринт», «агент» и вход через Keycloak: эти слова —
// предметность приложения и живут здесь. Ставится один раз при старте (main.tsx)
// и в настройке тестов, чтобы экран говорил теми же словами, что и раньше.
import { registerStatuses, setKitStrings, setTaskStatuses, type KitKey, type KitLang, type StatusRow } from '@seidr/kit';

export const LORE_KIT_STRINGS: Record<KitLang, Partial<Record<KitKey, string>>> = {
  ru: {
    "kit.record.around": "Вокруг записи · вычисляет LORE",
    "kit.record.journal.agent": "агент",
    "kit.appr.journal.agent": "агент",
    "kit.record.history.agent": "агент",
    "kit.palette.trigger.search": "Поиск по LORE…",
    "kit.record.graph.structuralHint": "Принадлежность и иерархия: проект, спринт, фаза, родитель",
    "kit.burn.emptyHint": "У спринта нет задач в истории — это проверенный ноль, а не сбой.",
    "kit.auth.redirecting": "Вы не вошли — переходим ко входу через Keycloak…",
    "kit.auth.loggedOut": "Вы вышли из LORE.",
    "kit.auth.error.hint": "Keycloak не подтвердил вход — это не «пусто». Войдите снова.",
    "kit.record.history.fCollapse": "Свернуть правки агента в серии",
    "kit.record.history.partialRows": "Показано {shown} из {total} строк — правки агента свёрнуты",
  },
  en: {
    "kit.record.around": "Around the record · computed by LORE",
    "kit.record.journal.agent": "agent",
    "kit.appr.journal.agent": "agent",
    "kit.record.history.agent": "agent",
    "kit.palette.trigger.search": "Search LORE…",
    "kit.record.graph.structuralHint": "Ownership and hierarchy: project, sprint, phase, parent",
    "kit.burn.emptyHint": "The sprint has no tasks in history — a checked zero, not a failure.",
    "kit.auth.redirecting": "You are not signed in — redirecting to Keycloak…",
    "kit.auth.loggedOut": "You have signed out of LORE.",
    "kit.auth.error.hint": "Keycloak did not confirm the sign-in — this is not “empty”. Sign in again.",
    "kit.record.history.fCollapse": "Collapse agent edits into runs",
    "kit.record.history.partialRows": "Showing {shown} of {total} rows — agent edits are collapsed",
  },
};

/**
 * Статусы процесса LORE, которых нет в общем словаре kit. Встают после «частично»:
 * 🚀 к выкатке → 🧪 UAT (агент проверил на стенде, принимает человек; выбор
 * владелицы 13.11.2026 — индиго + stamper) → готово.
 */
export const LORE_STATUSES: Record<string, StatusRow> = {
  ready_for_deploy: { icon: 'wave-crest', color: 'st-ready_for_deploy', category: 'review', label: { ru: 'Готово к выкатке', en: 'Ready for deploy' } },
  uat: { icon: 'stamper', color: 'st-uat', category: 'review', label: { ru: 'UAT — приёмка', en: 'UAT Testing' } },
};

/** Статусы, которые таблица задач даёт сменить (что принимает POST /lore/status). */
export const LORE_TASK_STATUSES = [
  'todo', 'planned', 'active', 'partial', 'ready_for_deploy', 'uat', 'done', 'blocked', 'cancelled',
] as const;

export function installKitVocabulary(): void {
  setKitStrings('ru', LORE_KIT_STRINGS.ru);
  setKitStrings('en', LORE_KIT_STRINGS.en);
  registerStatuses(LORE_STATUSES, { after: 'partial' });
  setTaskStatuses(LORE_TASK_STATUSES);
}
