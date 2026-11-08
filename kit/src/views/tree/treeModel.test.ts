// SPRINT_UXR_S10_SEIDR_KIT/K-09 — модель вида «Дерево / книга».
// Порядок из данных, уровни, N из M на уровне, свёртка вверх, фильтр с предками.
import { describe, expect, it } from 'vitest';
import type { KitRecord, KitVerdict } from '../../core/contract';
import {
  buildTree, expandToLevel, filterWithAncestors, rollupStatus, rollupVerdict, visibleRows,
} from './treeModel';
import { TREE_FIXTURE, TREE_FIXTURE_CONFIG } from './fixture';

const rec = (id: string, parent: string | null, order: unknown, status = 'todo', extra: Record<string, unknown> = {}): KitRecord => ({
  id, kind: 'node', title: `T ${id}`, status, fields: { parent, order, ...extra },
});
const SPEC = { parent: 'parent', order: 'order' };

describe('K-09 · buildTree — порядок из данных', () => {
  it('дети упорядочены по полю order, а не по порядку записей в выдаче', () => {
    const m = buildTree([rec('c', 'r', 3), rec('a', 'r', 1), rec('r', null, 1), rec('b', 'r', 2)], SPEC);
    expect(m.roots.map(n => n.id)).toEqual(['r']);
    expect(m.roots[0].children.map(n => n.id)).toEqual(['a', 'b', 'c']);
    expect(m.byId.get('b')?.depth).toBe(1);
  });

  it('order-строки сравниваются «по-человечески» (1.2 < 1.10), записи без order — после, в порядке данных', () => {
    const m = buildTree([rec('x', null, undefined), rec('p10', null, '1.10'), rec('y', null, null), rec('p2', null, '1.2')], SPEC);
    expect(m.roots.map(n => n.id)).toEqual(['p2', 'p10', 'x', 'y']);
  });

  it('родитель не найден — узел в корне с честной пометкой orphan, а не пропадает', () => {
    const m = buildTree([rec('a', 'ghost', 1)], SPEC);
    expect(m.roots.map(n => n.id)).toEqual(['a']);
    expect(m.roots[0].orphan).toBe('ghost');
  });

  it('цикл не вешает построение: узел цикла уходит в корень с пометкой cycle', () => {
    const m = buildTree([rec('a', 'b', 1), rec('b', 'a', 2)], SPEC);
    expect(m.byId.size).toBe(2);
    const flagged = [...m.byId.values()].filter(n => n.cycle);
    expect(flagged.length).toBeGreaterThan(0);
    expect(m.roots.length).toBeGreaterThan(0);
  });
});

describe('K-09 · уровни и N из M', () => {
  const m = buildTree([
    rec('r', null, 1), rec('a', 'r', 1), rec('b', 'r', 2), rec('a1', 'a', 1), rec('a2', 'a', 2),
  ], SPEC);

  it('expandToLevel(1) раскрывает только корни; строк — корни + их дети', () => {
    const rows = visibleRows(m, expandToLevel(m, 1));
    expect(rows.map(r => r.node.id)).toEqual(['r', 'a', 'b']);
    expect(rows[1]).toMatchObject({ posinset: 1, setsize: 2, shown: 2, total: 2 });
  });

  it('expandToLevel(Infinity) раскрывает всё дерево в порядке книги', () => {
    expect(visibleRows(m, expandToLevel(m, Infinity)).map(r => r.node.id)).toEqual(['r', 'a', 'a1', 'a2', 'b']);
    expect(m.maxDepth).toBe(2);
  });

  it('свёрнутый узел скрывает потомков', () => {
    expect(visibleRows(m, new Set()).map(r => r.node.id)).toEqual(['r']);
  });
});

describe('K-09 · фильтр с предками', () => {
  const m = buildTree([
    rec('r', null, 1), rec('a', 'r', 1), rec('b', 'r', 2), rec('a1', 'a', 1, 'todo', { tag: 'x' }), rec('b1', 'b', 1),
  ], SPEC);

  it('совпавший узел виден вместе со всей цепочкой предков, остальное скрыто', () => {
    const f = filterWithAncestors(m, r => r.fields.tag === 'x');
    expect([...f.matched]).toEqual(['a1']);
    expect([...f.visible].sort()).toEqual(['a', 'a1', 'r']);
    // фильтр раскрывает предков сам, даже если всё свёрнуто
    const rows = visibleRows(m, new Set(), f);
    expect(rows.map(r => r.node.id)).toEqual(['r', 'a', 'a1']);
    // N из M на уровне: у r показан 1 ребёнок из 2
    expect(rows.find(r => r.node.id === 'r')?.childShown).toBe(1);
    expect(rows.find(r => r.node.id === 'r')?.childTotal).toBe(2);
    expect(rows.find(r => r.node.id === 'a1')?.matched).toBe(true);
    expect(rows.find(r => r.node.id === 'a')?.matched).toBe(false);
  });

  it('ничего не совпало — пустые множества (проверенный ноль)', () => {
    const f = filterWithAncestors(m, () => false);
    expect(f.visible.size).toBe(0);
    expect(visibleRows(m, expandToLevel(m, Infinity), f)).toEqual([]);
  });
});

describe('K-09 · свёртка вверх', () => {
  const m = buildTree([
    rec('r', null, 1, 'active'), rec('a', 'r', 1, 'done'), rec('b', 'r', 2, 'todo'), rec('c', 'r', 3, 'cancelled'), rec('a1', 'a', 1, 'done'),
  ], SPEC);
  const cat = (s: string) => (s === 'done' ? 'done' : s === 'cancelled' ? 'cancelled' : s === 'active' ? 'active' : 'todo');

  it('status: готово N из M по всем потомкам, отменённые не считаются', () => {
    const roll = rollupStatus(m, cat);
    expect(roll.get('r')).toEqual({ done: 2, total: 3 });
    expect(roll.get('a')).toEqual({ done: 1, total: 1 });
    expect(roll.get('b')).toEqual({ done: 0, total: 0 });
  });

  it('verdict: худший процент поднимается к предку, число узлов с провалами суммируется; сбой вердикта — отдельный счёт', () => {
    const v = (r: KitRecord): KitVerdict => {
      if (r.id === 'b') throw new Error('boom');
      return r.id === 'a1' ? { score: 1, max: 4, failed: ['no-body'], hints: [] } : { score: 4, max: 4, failed: [], hints: [] };
    };
    const roll = rollupVerdict(m, v);
    expect(roll.get('a1')).toMatchObject({ score: 1, max: 4, failedNodes: 1, errors: 0, own: { score: 1 } });
    expect(roll.get('a')).toMatchObject({ score: 1, max: 4, failedNodes: 1 });
    expect(roll.get('r')).toMatchObject({ score: 1, max: 4, failedNodes: 1, errors: 1 });
    expect(roll.get('b')?.ownError).toBe('boom');
  });
});

describe('K-09 · фикстура ~500 узлов', () => {
  it('около 500 записей, четыре уровня, конфиг включает третий вид tree', () => {
    expect(TREE_FIXTURE.records.length).toBeGreaterThanOrEqual(450);
    expect(TREE_FIXTURE.records.length).toBeLessThanOrEqual(650);
    const m = buildTree(TREE_FIXTURE.records, TREE_FIXTURE_CONFIG.list!.tree!);
    expect(m.maxDepth).toBe(3);
    expect(TREE_FIXTURE_CONFIG.list?.views).toEqual(['list', 'board', 'tree']);
    // порядок в выдаче перемешан — книга собирается только по order
    const first = TREE_FIXTURE.records[0];
    expect(first.fields.parent).not.toBeNull();
    expect(m.roots[0].record.fields.order).toBe(1);
  });

  it('фикстура детерминирована: два построения дают одинаковый порядок', () => {
    const a = visibleRows(buildTree(TREE_FIXTURE.records, SPEC), expandToLevel(buildTree(TREE_FIXTURE.records, SPEC), Infinity)).map(r => r.node.id);
    const m2 = buildTree([...TREE_FIXTURE.records], SPEC);
    const b = visibleRows(m2, expandToLevel(m2, Infinity)).map(r => r.node.id);
    expect(a).toEqual(b);
    expect(a.length).toBe(TREE_FIXTURE.records.length);
  });
});
