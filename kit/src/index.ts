// Seiðr-kit (@seidr/kit) — общие токены, тема и элементы UI на React
// (SPRINT_UXR_S10_SEIDR_KIT, D-2026-UXR-KIT-REACT). CSS-слой подключается
// отдельно: `import '@seidr/kit/styles/seidr.css'` (или <link> в голом HTML).
export * from './tokens/prefs';
export * from './elements';
export * from './i18n';
export * from './states';
export * from './shell';
// Контракт ядра kit (SPRINT_UXR_S10_SEIDR_KIT) и каркас записи (K-04). Тело
// записи рендерит ctx.md — MD-элементы по-прежнему из `@seidr/kit/content`.
export type * from './core/contract';
export * from './record';
// Контракт ядра (типы, без кода) — и отсюда; хуки вида — `@seidr/kit/core`.
export * from './approval';
export * from './tasks';
// MD/HTML-элементы (TipTapField, MartProse, SandboxedHtmlFrame, S4-00d) — НЕ
// отсюда, а отдельной точкой входа `@seidr/kit/content`: они тянут TipTap,
// mermaid и bpmn-js, и экрану без MD-полей платить за них незачем.
export { matchHotkey, parseHotkey, type HotkeySpec, type KeyLike } from './resilience/hotkeys';
export { createSafeStorage, type SafeStorage } from './resilience/safeStorage';
export { StorageBanner } from './resilience/StorageBanner';
export { ErrorBoundary } from './resilience/ErrorBoundary';
export { pushUrlState, readUrlState, type UrlWindow } from './resilience/urlState';
// Контракт ядра (SPRINT_UXR_S10_SEIDR_KIT): KitConfig, KitData, KitRecord… — только типы.
// Контракт ядра (K-01…K-11) и listView (SPRINT_UXR_S10_SEIDR_KIT/K-03).
export * from './list';
// Ядро: контракт KitConfig/KitData и смена статуса «2 касания» с хуками
// сохранения (SPRINT_UXR_S10_SEIDR_KIT/K-05).
export * from './core/statusModel';
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
export { installErrorScreen, showErrorScreen, type ErrorScreenOptions } from './resilience/errorScreen';
export { describeError, isBenignError } from './resilience/errorText';
export { useHotkeys, type HotkeyHandler } from './resilience/useHotkeys';
export { setUrlParams, useUrlParam } from './resilience/useUrlParam';
// Контракт ядра (SPRINT_UXR_S10_SEIDR_KIT) и палитра Ctrl+K / поиск «/» (K-07).
export * from './palette';
// Контракт ядра (SPRINT_UXR_S10_SEIDR_KIT) — только типы.
// Вид «Дерево / книга» — третий в list.views (K-09).
export * from './views/tree';
// Burnup/burndown спринта — свёрнут под таблицей задач (SPRINT_UXR_S5_RECORD_TASKS/S5-03).
export * from './charts';
