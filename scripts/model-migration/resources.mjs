// SPRINT_LORE_MODEL_DOCS_TIDY/MIG-02 · Файлы конфигурации переноса, вшитые в код.
// Слово владелицы 16.11.2026: установщик «должен быть независимым и не зависеть от операционки», сборки —
// под Windows и под Linux. Поэтому карта, правила, схема и словарь статусов не читаются с диска по пути
// репозитория, а импортируются: сборщик вшивает их в один файл, и репозиторий рядом установщику не нужен.
import map from './map/sprint-phase-task.json' with { type: 'json' };
import allObjects from './map/all-objects.json' with { type: 'json' };
import edges from './map/all.edges.json' with { type: 'json' };
import schemaAll from './schema/all-objects.json' with { type: 'json' };
import schema from './schema/sprint-phase-task.json' with { type: 'json' };
import rules from './rules/status-unification.json' with { type: 'json' };
import statuses from '../../shared/lore-statuses.json' with { type: 'json' };
import installBundle from './rules/install-bundle.json' with { type: 'json' };

// Первый объект — своей картой; все остальные — картой, выведенной правилами (propose-map-all.mjs, 17.11.2026).
export const MAP = { ...map.types, ...allObjects.types };
/** Типы, которые карта решила не переносить: тип → почему (план-доска снята, журнал шагов V …). */
export const NOT_MOVED = allObjects.skipped || {};
// Общая карта связей всех объектов (map/all.edges.json, MIG-01 18.11.2026).
export const EDGES = edges.edges;
// 18.11.2026: схема первого объекта + предложение схемы всех остальных (владелица: «а так ок» на пять правил переноса).
export const SCHEMA = { ...schema.types, ...schemaAll.types };
export const RULES = rules;
export const VOCAB = statuses.statusMatch;
export const CODE_CASE = rules.code_case.status;
export const INSTALL_BUNDLE = installBundle;
