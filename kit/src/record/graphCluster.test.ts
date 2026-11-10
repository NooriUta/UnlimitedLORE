// Хабы в графе: однотипных соседей много — кластер вместо каши
// (SPRINT_UXR_S9_SCALE_OPT/S9-08).
//
// Повод из задачи: у узлов-хабов однотипных соседей столько (пример — 149
// релизов), что граф превращается в кашу. Беда не только в числе кружков:
// сектор такого типа съедает почти всю окружность, и ОСТАЛЬНЫЕ связи —
// те, за которыми человек и пришёл, — ужимаются в щель.
//
// Поэтому кластеризация решается ДО раскладки секторов, и это проверяется
// отдельно: кластер, посчитанный после, оставил бы хабу его сектор.
//
// Что кластер обязан говорить честно: сколько узлов он спрятал, и — если
// выдача обрезана лимитом — что это число «не меньше», а не точное. Кластер
// «149», под которым на самом деле 400, хуже каши: каша видна, а неверное
// число выглядит знанием.
import { describe, expect, it } from 'vitest';
import type { KitData, KitEdge, KitRecord } from '../core/contract';
import { GRAPH_CLUSTER_MAX, egoGraph } from './graph';

const rec = (id: string): KitRecord => ({ id, kind: 'item', title: `Запись ${id}`, status: 'todo', fields: {} });

/** Хаб: `n` соседей типа `type` и по одному соседу каждого из `others`. */
function hub(n: number, type = 'MANY', others: string[] = []): KitData {
  const records = [rec('ego'), ...Array.from({ length: n }, (_, i) => rec(`m${i}`)), ...others.map((_t, i) => rec(`o${i}`))];
  const edges: KitEdge[] = [
    ...Array.from({ length: n }, (_, i) => ({ from: 'ego', to: `m${i}`, type })),
    ...others.map((t, i) => ({ from: 'ego', to: `o${i}`, type: t })),
  ];
  return { records, edges, journal: [], meta: { generated_at: '2026-11-10T12:00:00Z', total: records.length } };
}

const opts = (over: Partial<Parameters<typeof egoGraph>[2]> = {}) => ({ depth: 1, limit: 1000, ...over });

describe('S9-08 · потолок однотипных соседей', () => {
  it('потолок назван одним местом и равен 12', () => {
    expect(GRAPH_CLUSTER_MAX).toBe(12);
  });

  it('положительный контроль: соседей в пределах потолка — все узлами, кластеров нет', () => {
    const g = egoGraph('ego', hub(GRAPH_CLUSTER_MAX), opts());
    expect(g.nodes).toHaveLength(GRAPH_CLUSTER_MAX);
    expect(g.clusters).toEqual([]);
  });

  it('соседей больше потолка — вместо узлов ОДИН кластер с их числом', () => {
    const g = egoGraph('ego', hub(149), opts());
    expect(g.nodes.filter(n => n.sector === 'MANY')).toHaveLength(0);
    expect(g.clusters).toHaveLength(1);
    expect(g.clusters[0].count).toBe(149);
    expect(g.clusters[0].sector).toBe('MANY');
  });

  it('кластер несёт коды спрятанных узлов: по нему строится список', () => {
    const g = egoGraph('ego', hub(149), opts());
    expect(g.clusters[0].ids).toHaveLength(149);
    expect(g.clusters[0].ids).toContain('m0');
  });
});

describe('S9-08 · кластер решается ДО раскладки секторов', () => {
  it('хаб больше не съедает окружность: его сектор сжался до одного места', () => {
    // 149 однотипных + три разных. Если кластеризовать ПОСЛЕ раскладки,
    // сектор хаба останется ~97 % круга, и три нужные связи окажутся в щели.
    const g = egoGraph('ego', hub(149, 'MANY', ['A', 'B', 'C']), opts());
    const span = (t: string) => {
      const s = g.sectors.find(x => x.type === t)!;
      return s.end - s.start;
    };
    expect(span('MANY')).toBeLessThan(span('A') * 1.5);
  });

  it('у сектора-кластера видно, что он кластер, и его СЧЁТ остаётся правдой', () => {
    const g = egoGraph('ego', hub(149, 'MANY', ['A']), opts());
    const s = g.sectors.find(x => x.type === 'MANY')!;
    expect(s.clustered).toBe(true);
    expect(s.count, 'счёт сектора — настоящее число соседей, а не единица кластера').toBe(149);
  });

  it('у обычного сектора признака кластера нет', () => {
    const g = egoGraph('ego', hub(3, 'MANY', ['A']), opts());
    expect(g.sectors.find(x => x.type === 'MANY')!.clustered).toBeUndefined();
  });
});

describe('S9-08 · раскрытие кластера', () => {
  it('раскрытый кластер отдаёт свои узлы обратно', () => {
    const g = egoGraph('ego', hub(149), opts({ expanded: new Set(['MANY']) }));
    expect(g.nodes.filter(n => n.sector === 'MANY')).toHaveLength(149);
    expect(g.clusters).toEqual([]);
  });

  it('раскрыт один тип — второй остаётся кластером', () => {
    const data = hub(20, 'A');
    for (let i = 0; i < 20; i++) {
      data.records.push(rec(`b${i}`));
      data.edges.push({ from: 'ego', to: `b${i}`, type: 'B' });
    }
    const g = egoGraph('ego', data, opts({ expanded: new Set(['A']) }));
    expect(g.clusters.map(c => c.sector)).toEqual(['B']);
    expect(g.nodes.filter(n => n.sector === 'A')).toHaveLength(20);
  });

  it('потолок можно задать иным: правило одно, число не вшито', () => {
    const g = egoGraph('ego', hub(5), opts({ clusterMax: 3 }));
    expect(g.clusters).toHaveLength(1);
    expect(g.clusters[0].count).toBe(5);
  });
});

describe('S9-08 · честность числа', () => {
  it('выдача не обрезана — число кластера точное', () => {
    const g = egoGraph('ego', hub(149), opts());
    expect(g.truncated).toBe(false);
    expect(g.clusters[0].atLeast).toBe(false);
  });

  it('выдача обрезана лимитом — число кластера «не меньше», а не точное', () => {
    const g = egoGraph('ego', hub(149), opts({ limit: 40 }));
    expect(g.truncated).toBe(true);
    expect(g.clusters[0].atLeast, 'под кластером может быть больше, чем он показал').toBe(true);
    expect(g.clusters[0].count).toBe(40);
  });

  it('кластер стоит НА холсте: у него есть место, а не только число', () => {
    const g = egoGraph('ego', hub(149), opts());
    const c = g.clusters[0];
    expect(Number.isFinite(c.x) && Number.isFinite(c.y)).toBe(true);
    expect(c.x === 0 && c.y === 0, 'кластер в центре наложился бы на саму запись').toBe(false);
  });

  it('связи внутрь кластера на холст не уходят: их концов там нет', () => {
    const g = egoGraph('ego', hub(149, 'MANY', ['A']), opts());
    const ids = new Set([g.center.id, ...g.nodes.map(n => n.id)]);
    for (const l of g.links) {
      expect(ids.has(l.from) && ids.has(l.to), `ребро ${l.from}→${l.to} ведёт в спрятанный узел`).toBe(true);
    }
  });

  it('детерминирован: тот же вход — тот же кластер', () => {
    const a = egoGraph('ego', hub(30), opts());
    const b = egoGraph('ego', hub(30), opts());
    expect(JSON.stringify(a.clusters)).toBe(JSON.stringify(b.clusters));
  });
});
