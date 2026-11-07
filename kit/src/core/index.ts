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
