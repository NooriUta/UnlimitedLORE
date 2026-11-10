// Вид «Дерево / книга» (SPRINT_UXR_S10_SEIDR_KIT/K-09).
export { TreeView, treeViewEnabled, type TreeViewProps } from './TreeView';
export {
  buildTree, expandToLevel, filterWithAncestors, rollupStatus, rollupVerdict, visibleRows,
  type TreeFilterResult, type TreeModel, type TreeNode, type TreeRow, type TreeSpec, type VerdictRollup,
} from './treeModel';
export { TREE_FIXTURE, TREE_FIXTURE_CONFIG, fixtureVerdict } from './fixture';
// Иерархия таблицей: одинаковые столбцы на всех уровнях, пропущенный уровень
// не меняет разметку (S4-TREE-NESTED).
export {
  TreeTable, treeTableLines,
  type TreeFlatRow, type TreeLevel, type TreeLevelState, type TreeTableLine, type TreeTableProps,
} from './TreeTable';
