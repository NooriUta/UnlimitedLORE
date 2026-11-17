// SPRINT_LORE_MODEL_DOCS_TIDY/MIG-02 · Файлы конфигурации переноса, вшитые в код.
// Слово владелицы 16.11.2026: установщик «должен быть независимым и не зависеть от операционки», сборки —
// под Windows и под Linux. Поэтому карта, правила, схема и словарь статусов не читаются с диска по пути
// репозитория, а импортируются: сборщик вшивает их в один файл, и репозиторий рядом установщику не нужен.
import map from './map/sprint-phase-task.json' with { type: 'json' };
import edges from './map/sprint-phase-task.edges.json' with { type: 'json' };
import schema from './schema/sprint-phase-task.json' with { type: 'json' };
import rules from './rules/status-unification.json' with { type: 'json' };
import statuses from '../../shared/lore-statuses.json' with { type: 'json' };
import installBundle from './rules/install-bundle.json' with { type: 'json' };

export const MAP = map.types;
export const EDGES = edges.edges;
export const SCHEMA = schema.types;
export const RULES = rules;
export const VOCAB = statuses.statusMatch;
export const CODE_CASE = rules.code_case.status;
export const INSTALL_BUNDLE = installBundle;
