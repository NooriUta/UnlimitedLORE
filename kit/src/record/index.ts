// Каркас записи Seiðr-kit (SPRINT_UXR_S10_SEIDR_KIT/K-04).
export * from './RecordView';
export * from './RecordHead';
export * from './RecordLinks';
export * from './RecordGraph';
export * from './RecordJournal';
export * from './BlockBoundary';
export * from './useRecordTab';
// S5-01: строка-вердикт шапки (статус · задачи x/y · просрочено · свежесть).
export * from './RecordFacts';
export {
  recordFacts, utcDay, tasksTone, dueTone,
  type RecordFactsSpec, type RecordFactsResult, type TasksFact, type DueFact, type FreshFact, type FactTone,
} from './facts';
export * from './RecordPeek';
// Вкладка «История» (SPRINT_UXR_S5_RECORD_TASKS/S5-11): версии SCD2, автор, сравнение, возврат.
export * from './RecordHistory';
export * from './history';
// Чтение записи целиком: листалка «‹ x из y ›» и свойства в ушке (SPRINT_UXR_S5_RECORD_TASKS/S5-04).
export * from './RecordPager';
// Крошки записи — слева в строке над записью (S4-28).
export * from './RecordCrumbs';
export * from './RecordReader';
export { egoGraph, edgeColor, toCssColor, typesAround, verdictTone, type EgoGraph, type EgoNode, type EgoOptions, type EgoSector } from './graph';
export * from './graphState';
// Место паспорта: справа / снизу / на весь экран (S4-33).
export * from './RecordDock';
export * from './RecordRelations';
export * from './dataState';
export * from './DataStateBlock';
