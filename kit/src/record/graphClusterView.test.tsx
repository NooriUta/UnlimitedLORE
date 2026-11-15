// @vitest-environment jsdom
// Хаб в графе на экране: кластер «N ▸» вместо сотни узлов (SPRINT_UXR_S9_SCALE_OPT/S9-08, PU-11).
//
// Слово «релизов» в подписи — предметное, и kit его не знает: подпись даёт конфиг приложения
// (`config.edges[type].label`), водораздел K-14. Поэтому проверяется, что у кластера ПОДПИСЬ ТИПА
// РЕБРА и число, а не выдуманное слово.
//
// 16.11.2026 владелица сняла «Секторы» и «Список»: правило кластера одно для всех раскладок (PU-11),
// поэтому проверки смотрят в движок графа знаний (заглушка с теми же узлами, что получает
// Обсидиан). Проверки геометрии секторов (коробка foreignObject, «список первым на телефоне»)
// ушли вместе с видом.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { KitConfig, KitCtx, KitData, KitEdge, KitRecord } from '../core/contract';
import type { GxEngineProps } from '../graph/engineTypes';
import { RecordGraph } from './RecordGraph';
import { GRAPH_CLUSTER_MAX } from './graph';

const stub = () => function Stub(p: GxEngineProps) {
  return (
    <div data-testid="eng">
      {p.nodes.map(n => (
        <button key={n.id} type="button" data-node={n.id} data-type={n.type} onClick={() => p.onSelect(n.id)}>{n.title ?? n.id}</button>
      ))}
    </div>
  );
};
vi.mock('../graph/ForceEngine', () => ({ default: stub() }));
vi.mock('../graph/ObsidianEngine', () => ({ default: stub() }));
vi.mock('../graph/ReactFlowEngine', () => ({ default: stub() }));

const rec = (id: string): KitRecord => ({ id, kind: 'item', title: `Запись ${id}`, status: 'todo', fields: {} });

const config = {
  modules: [], menu: { groups: [] },
  kinds: { item: { title: 'Предмет', icon: 'scroll-quill', fields: [] } },
  statuses: { items: [{ code: 'todo', title: 'к работе', category: 'todo', icon: 'calendar', color: 'var(--t3)' }] },
  edges: { MANY: { label: 'Много чего', color: 'var(--acc)' }, FEW: { label: 'Мало чего', color: 'var(--inf)' } },
  graph: { depth: 1 as const, limit: 1000 },
} as unknown as KitConfig;

function hub(n: number, few = 2): KitData {
  const records = [rec('ego'), ...Array.from({ length: n }, (_, i) => rec(`m${i}`)), ...Array.from({ length: few }, (_, i) => rec(`f${i}`))];
  const edges: KitEdge[] = [
    ...Array.from({ length: n }, (_, i) => ({ from: 'ego', to: `m${i}`, type: 'MANY' })),
    ...Array.from({ length: few }, (_, i) => ({ from: 'ego', to: `f${i}`, type: 'FEW' })),
  ];
  return { records, edges, journal: [], meta: { generated_at: '2026-11-10T12:00:00Z', total: records.length } };
}

const ctxOf = (data: KitData): KitCtx => ({
  config, data, href: (id: string) => `/r/${id}`, role: 'reader', lang: 'ru',
} as unknown as KitCtx);

async function draw(data: KitData) {
  const r = render(<RecordGraph record={rec('ego')} ctx={ctxOf(data)} lang="ru" />);
  await screen.findByTestId('eng');
  return r;
}

// Состояние графа живёт в АДРЕСЕ (gopen) — чистится до каждой проверки.
beforeEach(() => { window.history.replaceState(null, '', '/'); localStorage.clear(); });

const clusters = () => [...document.querySelectorAll('[data-type="@kit:cluster"]')];
const nodesOf = (prefix: string) => document.querySelectorAll(`[data-node^="${prefix}"]:not([data-type="@kit:cluster"])`);

describe('S9-08 · кластер вместо сотни узлов', () => {
  it('положительный контроль: соседей в пределах потолка — узлы, кластеров нет', async () => {
    await draw(hub(GRAPH_CLUSTER_MAX));
    expect(clusters()).toHaveLength(0);
    expect(nodesOf('m')).toHaveLength(GRAPH_CLUSTER_MAX);
  });

  it('соседей больше потолка — ОДИН кластер вместо них', async () => {
    await draw(hub(149));
    expect(clusters()).toHaveLength(1);
    expect(nodesOf('m')).toHaveLength(0);
  });

  it('кластер несёт ЧИСЛО и ПОДПИСЬ ТИПА из конфига, а не выдуманное слово', async () => {
    await draw(hub(149));
    const text = clusters()[0].textContent ?? '';
    expect(text).toMatch(/149/);
    expect(text).toMatch(/Много чего/);
  });

  it('связи другого типа не пропали: хаб их больше не вытесняет', async () => {
    await draw(hub(149));
    expect(nodesOf('f')).toHaveLength(2);
  });

  it('кластер раскрывается щелчком по нему — узлы возвращаются на холст', async () => {
    await draw(hub(20));
    fireEvent.click(clusters()[0]);
    expect(nodesOf('m')).toHaveLength(20);
    expect(clusters()).toHaveLength(0);
  });
});

describe('S9-08 · честность числа кластера', () => {
  it('выдача источника обрезана — сказано, что под кластером может быть больше', async () => {
    const full = hub(149);
    await draw({ ...full, meta: { ...full.meta, truncated: true } });
    expect(clusters()[0].textContent ?? '').toMatch(/\+|не меньше|не менее/i);
  });

  it('выдача целая — число точное, без оговорки', async () => {
    await draw(hub(149));
    expect(clusters()[0].textContent ?? '').not.toMatch(/не меньше|не менее/i);
  });
});
