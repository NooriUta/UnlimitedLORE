// @vitest-environment jsdom
// Хаб графа — находка на препроде efe20f03, 14.11.2026 (SPRINT_UXR_S9_SCALE_OPT/S9-08).
//
// ADR-LORE-045: 163 задачи по JUSTIFIES, 21 решение по DECIDED_IN, ADR-LORE-046 по DEPENDS_ON.
// Сервер отдал все 185 соседей (его потолок 500), а на холсте было 4 узла:
//  1) кластеры «не меньше 38 задач» и «не меньше 21 решение» — kit резал выдачу СВОИМ лимитом
//     рисования (60) ДО свёртки: 21 + 1 + 38 = 60, хвост JUSTIFIES терялся, а число кластера
//     считалось по обрезку;
//  2) нажатие на кластер не раскрывало его: одиночный щелчок только выделял узел, а кнопка
//     «раскрыть» стояла в карточке нулевой высоты (absolute внутри absolute);
//  3) Force всегда писал «не уложилась в 8 с»: у force-graph d3AlphaMin = 0, движок
//     останавливается только по cooldownTime = 15 с — дольше срока плашки при любом числе узлов.
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import gameIcons from '@iconify-json/game-icons/icons.json';
import { registerGameIcons } from '../elements/GameIcon';
import type { KitConfig, KitCtx, KitData, KitEdge, KitRecord } from '../core/contract';
import type { GxEngineProps } from '../graph/engineTypes';
import { RecordView } from './index';
import { egoGraph } from './graph';

const stub = (name: string) => function Stub(p: GxEngineProps) {
  return (
    <div data-testid={`eng-${name}`} data-ids={p.nodes.map(n => n.id).join(',')} data-titles={p.nodes.map(n => n.title ?? '').join('|')}>
      {p.nodes.map(n => <button key={n.id} type="button" onClick={() => p.onSelect(n.id)}>{`узел ${n.id}`}</button>)}
    </div>
  );
};
vi.mock('../graph/ForceEngine', () => ({ default: stub('force') }));
vi.mock('../graph/ObsidianEngine', () => ({ default: stub('obsidian') }));
vi.mock('../graph/ReactFlowEngine', () => ({ default: stub('structure') }));

beforeAll(() => registerGameIcons(gameIcons));
beforeEach(() => window.history.replaceState(null, '', '/r'));
afterEach(() => { window.history.replaceState(null, '', '/r'); localStorage.clear(); });

const rec = (id: string, kind: string): KitRecord => ({ id, kind, title: `Запись ${id}`, status: 'ok', fields: {} });
const CENTER = rec('ADR-LORE-045', 'adr');
const TASKS = Array.from({ length: 163 }, (_, i) => rec(`T-${String(i).padStart(3, '0')}`, 'task'));
const DECS = Array.from({ length: 21 }, (_, i) => rec(`D-${String(i).padStart(2, '0')}`, 'decision'));
const ADR46 = rec('ADR-LORE-046', 'adr');

const adr045 = (meta: Partial<KitData['meta']> = {}): KitData => ({
  records: [CENTER, ...TASKS, ...DECS, ADR46],
  edges: [
    ...TASKS.map(t => ({ from: 'ADR-LORE-045', to: t.id, type: 'JUSTIFIES' }) as KitEdge),
    ...DECS.map(d => ({ from: 'ADR-LORE-045', to: d.id, type: 'DECIDED_IN' }) as KitEdge),
    { from: 'ADR-LORE-045', to: 'ADR-LORE-046', type: 'DEPENDS_ON' },
  ],
  journal: [], meta: { generated_at: '2026-11-14T12:00:00Z', ...meta },
});

const cfg = (): KitConfig => ({
  modules: [], menu: { groups: [] },
  kinds: { adr: { title: 'ADR', icon: 'scroll-quill' } },
  edges: { JUSTIFIES: { label: 'обосновано', color: '--inf' }, DECIDED_IN: { label: 'решено в', color: '--inf' }, DEPENDS_ON: { label: 'зависит от', color: '--wrn' } },
  graph: {
    depth: 1, limit: 60, colorBy: 'type',
    types: {
      task: { label: 'Задача', color: '--t2', count: { one: '{n} задача', few: '{n} задачи', many: '{n} задач' } },
      decision: { label: 'Решение', color: '--acc', count: { one: '{n} решение', few: '{n} решения', many: '{n} решений' } },
    },
  },
  statuses: { items: [{ code: 'ok', title: 'ок', category: 'done', icon: 'check-mark', color: '--suc' }] },
} as KitConfig);

const show = (data = adr045()) => {
  const ctx: KitCtx = { data, config: cfg(), href: id => `#rec=${encodeURIComponent(id)}`, esc: s => s, md: s => <div>{s}</div> };
  return render(<RecordView record={CENTER} ctx={ctx} tab="graph" onTab={() => {}} />);
};

describe('S9-08 препрод · модель: свёртка по ПОЛНОЙ выдаче, лимит рисования — после', () => {
  it('ADR-LORE-045 при лимите 60: кластеры 163 и 21, ADR-LORE-046 узлом, числа точные', () => {
    const g = egoGraph('ADR-LORE-045', adr045(), { depth: 1, limit: 60 });
    const by = Object.fromEntries(g.clusters.map(c => [c.key, c]));
    expect(by.JUSTIFIES.count).toBe(163);
    expect(by.DECIDED_IN.count).toBe(21);
    expect(by.JUSTIFIES.atLeast).toBe(false);
    expect(by.DECIDED_IN.atLeast).toBe(false);
    expect(g.nodes.map(n => n.id)).toEqual(['ADR-LORE-046']);
    // Ничего не отрезано: всё, что не узлом, — в кластерах со счётом.
    expect(g.truncated).toBe(false);
  });

  it('раскрытый кластер отдаёт ВСЕ свои узлы, а не остаток после лимита', () => {
    const g = egoGraph('ADR-LORE-045', adr045(), { depth: 1, limit: 60, expanded: new Set(['JUSTIFIES']) });
    expect(g.nodes.filter(n => n.sector === 'JUSTIFIES')).toHaveLength(163);
    expect(g.clusters.map(c => c.key)).toEqual(['DECIDED_IN']);
  });

  it('выдача сервера обрезана — «не меньше»; точный счёт рёбер от сервера — число точное', () => {
    const cut = egoGraph('ADR-LORE-045', adr045(), { depth: 1, limit: 60, incomplete: true });
    expect(cut.clusters.every(c => c.atLeast)).toBe(true);
    const exact = egoGraph('ADR-LORE-045', adr045(), { depth: 1, limit: 60, incomplete: true, exact: new Map([['JUSTIFIES', 200]]) });
    const j = exact.clusters.find(c => c.key === 'JUSTIFIES')!;
    expect(j.count).toBe(200);
    expect(j.atLeast).toBe(false);
    expect(exact.clusters.find(c => c.key === 'DECIDED_IN')!.atLeast).toBe(true);
  });
});

describe('S9-08 препрод · экран', () => {
  it('сектора: подписи «163 задачи ▸» и «21 решение ▸», без «не меньше» и без «Показано 1 из 185»', () => {
    const { container } = show();
    const labels = [...container.querySelectorAll('[data-cluster] .sk-rec-graph__cbtn')].map(b => b.textContent);
    expect(labels).toEqual(expect.arrayContaining(['163 задачи ▸', '21 решение ▸']));
    expect(container.textContent).not.toMatch(/не меньше|Показано/);
  });

  it('точный счёт из счётчика рёбер сервера главнее обрезанной выдачи', () => {
    const { container } = show(adr045({ truncated: true, graphRels: [{ rel: 'JUSTIFIES', count: 163 }, { rel: 'DECIDED_IN', count: 21 }, { rel: 'DEPENDS_ON', count: 1 }] }));
    const labels = [...container.querySelectorAll('[data-cluster] .sk-rec-graph__cbtn')].map(b => b.textContent);
    expect(labels).toEqual(expect.arrayContaining(['163 задачи ▸', '21 решение ▸']));
  });

  for (const view of ['structure', 'force'] as const) {
    it(`${view}: одиночное нажатие на узел-кластер раскрывает его`, async () => {
      window.history.replaceState(null, '', `/r?gview=${view}`);
      show();
      await screen.findByTestId(`eng-${view}`);
      fireEvent.click(screen.getByRole('button', { name: /узел cluster:JUSTIFIES/ }));
      const after = (await screen.findByTestId(`eng-${view}`)).getAttribute('data-ids')!.split(',');
      expect(after.filter(i => i.startsWith('T-'))).toHaveLength(163);
      expect(after).not.toContain('cluster:JUSTIFIES');
    });
  }
});

describe('S9-08 препрод · карточка кластера не схлопывается', () => {
  it('панель «раскрыть» не прижата absolute-позицией (в карточке-peek она давала нулевую высоту)', () => {
    const src = readFileSync(join(process.cwd(), 'src/record/RecordGraph.tsx'), 'utf8');
    const m = /data-testid="gx-cluster"/.exec(src);
    expect(m).toBeTruthy();
    const line = src.slice(src.lastIndexOf('<div', m!.index), m!.index);
    expect(line, 'класс sk-gx__sel — position:absolute, внутри peek карточка схлопывается').not.toMatch(/sk-gx__sel"/);
    const css = readFileSync(join(process.cwd(), 'src/styles/seidr.css'), 'utf8');
    const rule = /\.sk-gx__csel\s*\{([^}]*)\}/.exec(css);
    expect(rule, 'у панели кластера свой класс').toBeTruthy();
    expect(rule![1]).not.toMatch(/position:\s*absolute/);
  });
});
