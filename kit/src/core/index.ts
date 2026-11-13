// Ядро Seiðr-kit (SPRINT_UXR_S10_SEIDR_KIT/K-01): контракт конфига и данных,
// JSON-схемы и валидатор. Точка входа `@seidr/kit/core` — без React-рендера,
// её можно звать и из сборщика данных, и из тестов приложения.
import configSchema from './schema/kit-config.schema.json';
import dataSchema from './schema/kit-data.schema.json';

export type * from './contract';
export {
  KIT_COLOR_TOKENS,
  readKitData,
  validateKitConfig,
  validateKitData,
  type KitDataRead,
  type KitIssue,
  type KitValidation,
  type ValidateConfigOptions,
} from './validate';

/** JSON-схема сериализуемой части KitConfig (draft 2020-12). */
export const KIT_CONFIG_SCHEMA = configSchema;
/** JSON-схема данных kit — window.X_DATA / ответ сервера (draft 2020-12). */
export const KIT_DATA_SCHEMA = dataSchema;
// Ядро Seiðr-kit (SPRINT_UXR_S10_SEIDR_KIT): контракт и общие механизмы записей.
export * from './statusModel';
export * from './statusSave';
export * from './useStatusChange';
export * from './StatusIcon';
export * from './StatusPopover';
export * from './StatusChip';
export * from './statusGuard';
// Ядро Seiðr-kit (SPRINT_UXR_S10_SEIDR_KIT): контракт конфига/данных и хуки
// рендера по виду записи (K-10). Отдельная точка входа `@seidr/kit/core`:
// умолчание ctx.md — MartProse, а он тянет mermaid/bpmn-js.
export * from './kindHooks';
export * from './statusAxis';
export * from './textScale';
// Одно правило на числа и даты (ревью владелицы 10.11.2026): форматирование
// жило только внутри kit, и приложению приходилось резать дату на месте —
// ровно то, против чего правило и заведено. Отдаём его наружу.
export * from './fmtValue';
// «Первые N и ещё N» — общая механика (S9-11); публична, т.к. ленты приложений (K-14, S7B-27) живут вне kit.
export * from './stepLimit';
