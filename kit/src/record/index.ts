// Каркас записи Seiðr-kit (SPRINT_UXR_S10_SEIDR_KIT/K-04).
export * from './RecordView';
export * from './RecordHead';
export * from './RecordLinks';
export * from './RecordGraph';
export * from './RecordJournal';
export * from './BlockBoundary';
export * from './useRecordTab';
// Вкладка «История» (SPRINT_UXR_S5_RECORD_TASKS/S5-11): версии SCD2, автор, сравнение, возврат.
export * from './RecordHistory';
export * from './history';
export { egoGraph, edgeColor, toCssColor, verdictTone, type EgoGraph, type EgoNode, type EgoSector } from './graph';
