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
// Вложенный блок вида: строка раздела / карточка / тело паспорта одним
// компонентом, без третьего рендера (S4-TREE-NESTED).
export { KindBlock, KindCell, kindColumns, kindColumnTitle, type KindBlockAs, type KindBlockProps } from './KindBlock';
// Вклеенный блок с числом в заголовке: хвост тела паспорта (S4-29) и запись с
// телом в ленте (K2-FEED-BODY-MORE) — один код, а не похожая вёрстка.
export * from './GluedBlock';
export * from './RecordSection';
// Ряд значений-чипов: первые три и «ещё N», подпись источника у унаследованных
// (S4-29). Нужен не только паспорту — отсюда отдельный файл и экспорт.
export * from './ValueChips';
export * from './RecordCardHead';
