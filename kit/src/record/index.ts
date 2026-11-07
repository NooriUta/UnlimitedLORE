// Каркас записи Seiðr-kit (SPRINT_UXR_S10_SEIDR_KIT/K-04).
export * from './RecordView';
export * from './RecordHead';
export * from './RecordLinks';
export * from './RecordGraph';
export * from './RecordJournal';
export * from './BlockBoundary';
export * from './useRecordTab';
export { egoGraph, edgeColor, toCssColor, verdictTone, type EgoGraph, type EgoNode, type EgoSector } from './graph';
// Чтение записи целиком: листалка «‹ x из y ›» и свойства в ушке (SPRINT_UXR_S5_RECORD_TASKS/S5-04).
export * from './RecordPager';
export * from './RecordReader';
