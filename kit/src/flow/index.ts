// Операции и мастера (SPRINT_UXR_S10_SEIDR_KIT_2, фаза ADMIN): шаги мастера,
// предпросмотр изменений, применение пачкой с окном отмены, матрица, секрет,
// который показывают один раз. Элементы предметных имён не знают (K-14) —
// что за изменения и чьи роли, знает приложение.
export { Steps, type StepDef, type StepsManualItem, type StepsProps } from './Steps';
export { SecretOnce, type SecretClipboard, type SecretOnceProps } from './SecretOnce';
export { DiffPreview, type DiffCheck, type DiffConfirm, type DiffKind, type DiffPreviewProps, type DiffRow } from './DiffPreview';
export { BatchUndo, type BatchItemFail, type BatchResult, type BatchUndoProps } from './BatchUndo';
export { Matrix, type MatrixAxis, type MatrixCellState, type MatrixChange, type MatrixOption, type MatrixProps } from './Matrix';
export { wordDiff, type WordChunk, type WordChunkKind, type WordDiffOptions, type WordDiffResult } from './wordDiff';
export { ContentRelease, type ActivationEntry, type ContentChangedItem, type ContentDiff, type ContentFieldChange, type ContentItem, type ContentReleaseProps } from './ContentRelease';
