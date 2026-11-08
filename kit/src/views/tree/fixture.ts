// Фикстура вида «Дерево / книга» (SPRINT_UXR_S10_SEIDR_KIT/K-09): ~500 узлов,
// четыре уровня — часть → глава → раздел → статья (4 × 5 × 4 × 5 = 504).
// Детерминирована: без Math.random и дат «сейчас» — два прогона дают одно и то же.
// Порядок записей в выдаче нарочно перемешан (перестановка i → (11·i + 7) mod N),
// чтобы книга собиралась только по полю order, а не по порядку данных.
import type { KitConfig, KitData, KitRecord, KitVerdict } from '../../core/contract';

const PARTS = 4;
const CHAPTERS = 5;
const SECTIONS = 4;
const ITEMS = 5;

const STATUS_CYCLE = ['done', 'done', 'active', 'todo', 'done', 'cancelled', 'todo'] as const;

function build(): KitRecord[] {
  const out: KitRecord[] = [];
  let k = 0;
  const push = (r: Omit<KitRecord, 'status'> & { status?: string }) => {
    out.push({ status: STATUS_CYCLE[k % STATUS_CYCLE.length], ...r });
    k += 1;
  };
  for (let p = 1; p <= PARTS; p++) {
    const pid = `P${p}`;
    push({ id: pid, kind: 'part', title: `Часть ${p}`, fields: { parent: null, order: p, tag: 'part' } });
    for (let c = 1; c <= CHAPTERS; c++) {
      const cid = `${pid}.C${c}`;
      push({ id: cid, kind: 'chapter', title: `Глава ${p}.${c}`, fields: { parent: pid, order: c, tag: 'chapter' } });
      for (let s = 1; s <= SECTIONS; s++) {
        const sid = `${cid}.S${s}`;
        push({ id: sid, kind: 'section', title: `Раздел ${p}.${c}.${s}`, fields: { parent: cid, order: s, tag: 'section' } });
        for (let i = 1; i <= ITEMS; i++) {
          const n = ((p * 31 + c * 17 + s * 7 + i) % 9);
          push({
            id: `${sid}.I${i}`,
            kind: 'item',
            title: `Статья ${p}.${c}.${s}.${i}`,
            body_md: n === 0 ? undefined : `Текст статьи ${p}.${c}.${s}.${i}.`,
            fields: { parent: sid, order: i, tag: n % 3 === 0 ? 'draft' : 'final' },
          });
        }
      }
    }
  }
  const N = out.length;
  return out.map((_, i) => out[(11 * i + 7) % N]);
}

export const TREE_FIXTURE: KitData = {
  records: build(),
  edges: [],
  journal: [],
  meta: { generated_at: '2026-11-07T00:00:00Z', scope: 'fixture:tree-book', total: PARTS * (1 + CHAPTERS * (1 + SECTIONS * (1 + ITEMS))), truncated: false },
};

/** Вердикт статьи: есть текст и статус не «отменено»; у контейнеров — полный балл. */
export function fixtureVerdict(r: KitRecord): KitVerdict {
  if (r.kind !== 'item') return { score: 2, max: 2, failed: [], hints: [] };
  const failed: string[] = [];
  if (!r.body_md) failed.push('no-body');
  if (r.fields.tag === 'draft') failed.push('draft');
  return { score: 2 - failed.length, max: 2, failed, hints: failed.map(f => `fix:${f}`) };
}

export const TREE_FIXTURE_CONFIG: KitConfig = {
  modules: [{ id: 'book', title: 'Книга', icon: 'book-cover', status: 'active' }],
  menu: { groups: [] },
  kinds: {
    part: { title: 'Часть', icon: 'bookshelf' },
    chapter: { title: 'Глава', icon: 'book-cover' },
    section: { title: 'Раздел', icon: 'bookmarklet' },
    item: { title: 'Статья', icon: 'scroll-unfurled' },
  },
  statuses: {
    items: [
      { code: 'todo', title: 'К работе', category: 'todo', icon: 'checkbox-tree', color: 'var(--st-todo)' },
      { code: 'active', title: 'В работе', category: 'active', icon: 'progression', color: 'var(--st-active)' },
      { code: 'done', title: 'Готово', category: 'done', icon: 'divided-spiral', color: 'var(--st-done)' },
      { code: 'cancelled', title: 'Отменено', category: 'cancelled', icon: 'cross-mark', color: 'var(--st-cancelled)' },
    ],
  },
  verdict: r => fixtureVerdict(r),
  list: {
    views: ['list', 'board', 'tree'],
    tree: { parent: 'parent', order: 'order', rollup: 'verdict' },
  },
};
