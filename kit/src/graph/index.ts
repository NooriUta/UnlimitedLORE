// Граф знаний kit (SPRINT_SEIDRKIT_GRAPH_CANVAS/GC-03): общий компонент с двумя
// видами (Force / как Обсидиан) и панелью настроек как у Обсидиана.
export { GraphExplorer, type GraphExplorerProps } from './GraphExplorer';
export { GraphSettingsPanel } from './GraphSettingsPanel';
export {
  GX_DEFAULTS, GX_ENGINES, GX_GROUP_COLORS, GX_RANGES, gxFilter, gxForces, gxGroupColor, gxMatches,
  gxTypeCounts, loadGx, normalizeGx, saveGx,
  type GxEdge, type GxEngine, type GxForces, type GxGroup, type GxNode, type GxSettings, type GxStyle,
} from './settings';
