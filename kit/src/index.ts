// Seiðr-kit (@seidr/kit) — общие токены, тема и элементы UI на React
// (SPRINT_UXR_S10_SEIDR_KIT, D-2026-UXR-KIT-REACT). CSS-слой подключается
// отдельно: `import '@seidr/kit/styles/seidr.css'` (или <link> в голом HTML).
// Версия kit: приложение должно уметь сказать, на чём оно работает (K-08 п. 1).
export * from './version';
export * from './tokens/prefs';
export * from './elements';
export * from './i18n';
export * from './states';
// Модель LORE: загрузчик с подключаемым источником и сторож «данные не
// пробивают поведение» (ADR-LORE-048, K-MODEL-LOADER).
export * from './model';
export * from './shell';
// Контракт ядра kit (SPRINT_UXR_S10_SEIDR_KIT) и каркас записи (K-04). Тело
// записи рендерит ctx.md — MD-элементы по-прежнему из `@seidr/kit/content`.
export type * from './core/contract';
export * from './record';
export * from './graph';
// Контракт ядра (типы, без кода) — и отсюда; хуки вида — `@seidr/kit/core`.
export * from './approval';
export * from './tasks';
// MD/HTML-элементы (TipTapField, MartProse, SandboxedHtmlFrame, S4-00d) — НЕ
// отсюда, а отдельной точкой входа `@seidr/kit/content`: они тянут TipTap,
// mermaid и bpmn-js, и экрану без MD-полей платить за них незачем.
// Исключение — схема ссылок (K-14): без зависимостей, а ставится при старте приложения.
export { linkScheme, resetLinkScheme, setLinkScheme, type LinkScheme } from './content/linkScheme';
export { matchHotkey, parseHotkey, type HotkeySpec, type KeyLike } from './resilience/hotkeys';
export { createSafeStorage, type SafeStorage } from './resilience/safeStorage';
export { StorageBanner } from './resilience/StorageBanner';
export { ErrorBoundary } from './resilience/ErrorBoundary';
export { pushUrlState, readUrlState, sectionScopedPatch, urlStateHref, type UrlWindow } from './resilience/urlState';
// S4-13 (B-08): «пользователь набирает текст» — одна проверка на весь kit.
export { isEditableTarget } from './resilience/editable';
// Контракт ядра (SPRINT_UXR_S10_SEIDR_KIT): KitConfig, KitData, KitRecord… — только типы.
// Контракт ядра (K-01…K-11) и listView (SPRINT_UXR_S10_SEIDR_KIT/K-03).
export * from './list';
// Ядро: контракт KitConfig/KitData и смена статуса «2 касания» с хуками
// сохранения (SPRINT_UXR_S10_SEIDR_KIT/K-05).
export * from './core/statusModel';
export * from './core/statusLook';
export * from './core/statusSave';
export * from './core/useStatusChange';
export * from './core/StatusIcon';
export * from './core/StatusPopover';
export * from './core/StatusChip';
// K-06 (SPRINT_UXR_S10_SEIDR_KIT): сквозная устойчивость оболочки.
export {
  blockOutcome, ErrBlock, ErrBlockBoundary, KitBlock, KitSlot, UnverifiedBlock,
  type BlockOutcome, type ErrBlockProps, type KitBlockProps, type KitSlotProps,
} from './resilience/errBlock';
// S4-TECH-NOTES: адресат сообщения (user | tech) и скрытие технического до включения.
export { audienceOf, isTech, type Audience } from './resilience/audience';
export { TechGate, TechVisibilityProvider, useShowTech, type TechGateProps } from './resilience/techGate';
export { installErrorScreen, showErrorScreen, type ErrorScreenOptions } from './resilience/errorScreen';
export { describeError, isBenignError } from './resilience/errorText';
export { useHotkeys, type HotkeyHandler } from './resilience/useHotkeys';
// Клавиатура как слой (SPRINT_UXR_S4_UI_SHELL_LISTS/S4-11): клавиши действий
// (Kbd + aria-keyshortcuts из одной строки) и ловушка фокуса всплывающих окон.
export * from './keyboard';
export { setUrlParams, useUrlParam } from './resilience/useUrlParam';
// Контракт ядра (SPRINT_UXR_S10_SEIDR_KIT) и палитра Ctrl+K / поиск «/» (K-07).
export * from './palette';
// Контракт ядра (SPRINT_UXR_S10_SEIDR_KIT) — только типы.
// Вид «Дерево / книга» — третий в list.views (K-09).
export * from './views/tree';
// Выбор нескольких проектов в шапке: поиск, «все мои», «только этот», лист на
// телефоне (SPRINT_UXR_S4_UI_SHELL_LISTS/S4-03).
export * from './picker';
// Таймлайн с дорожками той же общей группировки (S4-06).
export * from './views/timeline';
export * from './views/calendar';
export * from './views/library';
// Сохранённые виды списка: сохранить / сохранить как / сбросить, командные виды
// по умолчанию; хранилище — контракт S2 (SPRINT_UXR_S4_UI_SHELL_LISTS/S4-08).
export * from './views/saved';
// Burnup/burndown спринта — свёрнут под таблицей задач (SPRINT_UXR_S5_RECORD_TASKS/S5-03).
export * from './charts';
// Режим чтения: колонка ~680 px, широкие блоки с ⤢, Aa, ушко правой колонки,
// меню по настройке (SPRINT_UXR_S5_RECORD_TASKS/S5-05).
export * from './reading';
// Мастера и операции (SPRINT_UXR_S10_SEIDR_KIT_2, фаза ADMIN): шаги с
// условием перехода и «осталось руками» (K2-STEPS).
export * from './flow';
// S4-FIELD-EDITORS: редакторы по видам полей модели.
export * from './fields';
