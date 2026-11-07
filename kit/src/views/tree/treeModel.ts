// Модель вида «Дерево / книга» (SPRINT_UXR_S10_SEIDR_KIT/K-09).
// Чистые функции без React: построение дерева из плоских записей по полям
// list.tree.parent/order, раскрытие уровней, строки для отрисовки с «N из M»,
// фильтр с предками и свёртки status/verdict снизу вверх.
//
// Честность данных: запись с несуществующим родителем не пропадает — уходит в
// корень с пометкой orphan; цикл родителей не вешает построение — разрывается
// и помечается cycle. Сбой вердикта узла — свой счёт errors, не «0 баллов».
import type { KitRecord, KitVerdict } from '../../core/contract';

export interface TreeSpec { parent: string; order: string }

export interface TreeNode {
  id: string;
  record: KitRecord;
  parentId: string | null;
  depth: number;
  children: TreeNode[];
  /** id родителя, которого нет в данных. */
  orphan?: string;
  /** Узел разорвал цикл родителей и поднят в корень. */
  cycle?: boolean;
}

export interface TreeModel {
  roots: TreeNode[];
  byId: Map<string, TreeNode>;
  /** Наибольшая глубина (корень = 0). */
  maxDepth: number;
}

type OrderKey = { kind: 0; n: number } | { kind: 1; s: string } | { kind: 2 };

function orderKey(v: unknown): OrderKey {
  if (typeof v === 'number' && Number.isFinite(v)) return { kind: 0, n: v };
  if (typeof v === 'string' && v.trim() !== '') {
    const t = v.trim();
    return /^-?\d+$/.test(t) ? { kind: 0, n: Number(t) } : { kind: 1, s: t };
  }
  return { kind: 2 };
}

const collator = new Intl.Collator('ru', { numeric: true, sensitivity: 'base' });

function compareOrder(a: OrderKey, b: OrderKey): number {
  if (a.kind !== b.kind) {
    // число и строка — сравниваем как строки «по-человечески»; без order — в конец
    if (a.kind === 2 || b.kind === 2) return a.kind === 2 ? 1 : -1;
    const as = a.kind === 0 ? String(a.n) : a.s;
    const bs = b.kind === 0 ? String(b.n) : (b as { s: string }).s;
    return collator.compare(as, bs);
  }
  if (a.kind === 0) return a.n - (b as { n: number }).n;
  if (a.kind === 1) return collator.compare(a.s, (b as { s: string }).s);
  return 0;
}

function parentOf(r: KitRecord, spec: TreeSpec): string | null {
  const v = r.fields?.[spec.parent];
  if (v === null || v === undefined || v === '') return null;
  return String(v);
}

export function buildTree(records: readonly KitRecord[], spec: TreeSpec): TreeModel {
  const byId = new Map<string, TreeNode>();
  const pos = new Map<string, number>();
  const keys = new Map<string, OrderKey>();
  records.forEach((r, i) => {
    if (byId.has(r.id)) return; // дубль id — первая запись побеждает
    byId.set(r.id, { id: r.id, record: r, parentId: parentOf(r, spec), depth: 0, children: [] });
    pos.set(r.id, i);
    keys.set(r.id, orderKey(r.fields?.[spec.order]));
  });

  // Разрыв циклов: идём вверх от каждого узла; повтор в пути = цикл.
  const state = new Map<string, 1 | 2>(); // 1 — в пути, 2 — проверен
  for (const start of byId.values()) {
    const path: TreeNode[] = [];
    let cur: TreeNode | undefined = start;
    while (cur && !state.has(cur.id)) {
      state.set(cur.id, 1);
      path.push(cur);
      const pid: string | null = cur.parentId;
      if (pid === null) break;
      const p = byId.get(pid);
      if (!p) { cur.orphan = pid; cur.parentId = null; break; }
      if (state.get(p.id) === 1) { cur.cycle = true; cur.parentId = null; break; }
      cur = p;
    }
    for (const n of path) state.set(n.id, 2);
  }

  const roots: TreeNode[] = [];
  for (const n of byId.values()) {
    if (n.parentId === null) roots.push(n);
    else byId.get(n.parentId)!.children.push(n);
  }
  const sortKids = (list: TreeNode[]) =>
    list.sort((a, b) => compareOrder(keys.get(a.id)!, keys.get(b.id)!) || pos.get(a.id)! - pos.get(b.id)!);
  sortKids(roots);

  let maxDepth = 0;
  const stack: TreeNode[] = [...roots];
  while (stack.length) {
    const n = stack.pop()!;
    if (n.depth > maxDepth) maxDepth = n.depth;
    sortKids(n.children);
    for (const c of n.children) { c.depth = n.depth + 1; stack.push(c); }
  }
  return { roots, byId, maxDepth };
}

/** Раскрыть узлы глубже которых `level` уровней не видно: level=1 — раскрыты корни. */
export function expandToLevel(model: TreeModel, level: number): Set<string> {
  const out = new Set<string>();
  for (const n of model.byId.values()) if (n.depth < level && n.children.length) out.add(n.id);
  return out;
}

export interface TreeFilterResult {
  /** Совпавшие узлы. */
  matched: Set<string>;
  /** Совпавшие и все их предки. */
  visible: Set<string>;
}

export function filterWithAncestors(model: TreeModel, pred: (r: KitRecord) => boolean): TreeFilterResult {
  const matched = new Set<string>();
  const visible = new Set<string>();
  for (const n of model.byId.values()) {
    if (!pred(n.record)) continue;
    matched.add(n.id);
    let cur: TreeNode | undefined = n;
    while (cur && !visible.has(cur.id)) {
      visible.add(cur.id);
      cur = cur.parentId === null ? undefined : model.byId.get(cur.parentId);
    }
  }
  return { matched, visible };
}

export interface TreeRow {
  node: TreeNode;
  /** Позиция среди показанных соседей (с 1) — для aria-posinset. */
  posinset: number;
  /** Сколько соседей показано — aria-setsize. */
  setsize: number;
  /** N из M на уровне: показано соседей / всего соседей. */
  shown: number;
  total: number;
  /** Сколько детей показано под этим узлом и сколько их всего. */
  childShown: number;
  childTotal: number;
  expanded: boolean;
  /** Узел совпал с фильтром (без фильтра — true у всех). */
  matched: boolean;
}

/**
 * Плоский список видимых строк в порядке книги. С фильтром предки совпавших
 * раскрываются сами (иначе совпадение спряталось бы в свёрнутом узле).
 */
export function visibleRows(model: TreeModel, expanded: ReadonlySet<string>, filter?: TreeFilterResult): TreeRow[] {
  const rows: TreeRow[] = [];
  const keep = (n: TreeNode) => !filter || filter.visible.has(n.id);
  const walk = (list: TreeNode[]) => {
    const shownList = list.filter(keep);
    shownList.forEach((node, i) => {
      const kids = node.children.filter(keep);
      const isOpen = kids.length > 0 && (filter ? true : expanded.has(node.id));
      rows.push({
        node,
        posinset: i + 1,
        setsize: shownList.length,
        shown: shownList.length,
        total: list.length,
        childShown: kids.length,
        childTotal: node.children.length,
        expanded: isOpen,
        matched: filter ? filter.matched.has(node.id) : true,
      });
      if (isOpen) walk(node.children);
    });
  };
  walk(model.roots);
  return rows;
}

/** Порядок обхода «дети раньше родителя» — для свёрток снизу вверх. */
function postOrder(model: TreeModel): TreeNode[] {
  const out: TreeNode[] = [];
  const stack: [TreeNode, boolean][] = model.roots.map(r => [r, false] as [TreeNode, boolean]).reverse();
  while (stack.length) {
    const [n, seen] = stack.pop()!;
    if (seen) { out.push(n); continue; }
    stack.push([n, true]);
    for (let i = n.children.length - 1; i >= 0; i--) stack.push([n.children[i], false]);
  }
  return out;
}

export type StatusCategoryOf = (status: string) => 'todo' | 'active' | 'done' | 'cancelled' | string;

/** Свёртка статуса: готово N из M среди всех потомков; отменённые не считаются. */
export function rollupStatus(model: TreeModel, categoryOf: StatusCategoryOf): Map<string, { done: number; total: number }> {
  const out = new Map<string, { done: number; total: number }>();
  for (const n of postOrder(model)) {
    let done = 0;
    let total = 0;
    for (const c of n.children) {
      const sub = out.get(c.id)!;
      done += sub.done;
      total += sub.total;
      const cat = categoryOf(c.record.status);
      if (cat === 'cancelled') continue;
      total += 1;
      if (cat === 'done') done += 1;
    }
    out.set(n.id, { done, total });
  }
  return out;
}

export interface VerdictRollup {
  /** Худший результат в поддереве (по доле score/max). */
  score: number;
  max: number;
  /** Сколько узлов поддерева (включая сам) имеют провалы. */
  failedNodes: number;
  /** Сколько узлов поддерева не смогли посчитать вердикт. */
  errors: number;
  own?: KitVerdict;
  ownError?: string;
}

const ratio = (v: { score: number; max: number }) => (v.max > 0 ? v.score / v.max : 1);

/** Свёртка вердикта: худший процент поднимается к предкам; сбой — отдельный счёт. */
export function rollupVerdict(model: TreeModel, verdictOf: (r: KitRecord) => KitVerdict): Map<string, VerdictRollup> {
  const out = new Map<string, VerdictRollup>();
  for (const n of postOrder(model)) {
    let own: KitVerdict | undefined;
    let ownError: string | undefined;
    try {
      own = verdictOf(n.record);
    } catch (e) {
      ownError = e instanceof Error ? e.message || e.name : String(e);
    }
    let worst: { score: number; max: number } | undefined = own ? { score: own.score, max: own.max } : undefined;
    let failedNodes = own && own.failed.length > 0 ? 1 : 0;
    let errors = ownError ? 1 : 0;
    for (const c of n.children) {
      const sub = out.get(c.id)!;
      failedNodes += sub.failedNodes;
      errors += sub.errors;
      if (sub.max > 0 && (!worst || ratio(sub) < ratio(worst))) worst = { score: sub.score, max: sub.max };
    }
    out.set(n.id, { score: worst?.score ?? 0, max: worst?.max ?? 0, failedNodes, errors, own, ownError });
  }
  return out;
}
