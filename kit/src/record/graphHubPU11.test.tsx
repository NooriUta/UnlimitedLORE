// @vitest-environment jsdom
// Хаб графа — приёмка 13.11 (SPRINT_UXR_POLISH_UAT_1113/PU-11, к S9-08). FORSETI → Граф: 27 спек.
//  1) подпись кластера — числом и ВИДОМ узлов («27 спек ▸»), если приложение дало формы слова
//     (graph.types[вид].count); иначе — как раньше, подписью типа связи;
//  2) кластер целиком внутри холста (был «DOCUMENTED_IN: 32» за правым краем);
//  3) правило кластера одно для всех раскладок: в Force/Обсидиане хаб — один узел-кластер,
//     щелчок раскрывает; раньше там все узлы шли поштучно;
//  4) у записи, где ВСЕ соседи свёрнуты, граф не объявляется пустым.
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import gameIcons from '@iconify-json/game-icons/icons.json';
import { registerGameIcons } from '../elements/GameIcon';
import type { KitConfig, KitCtx, KitData, KitEdge, KitRecord } from '../core/contract';
import type { GxEngineProps } from '../graph/engineTypes';
import { RecordView } from './index';

const stub = (name: string) => function Stub(p: GxEngineProps) {
  return (
    <div data-testid={`eng-${name}`} data-ids={p.nodes.map(n => n.id).join(',')}>
      {p.nodes.map(n => <button key={n.id} type="button" onClick={() => p.onSelect(n.id)}>{`узел ${n.id}`}</button>)}
    </div>
  );
};
vi.mock('../graph/ForceEngine', () => ({ default: stub('force') }));
vi.mock('../graph/ObsidianEngine', () => ({ default: stub('obsidian') }));

beforeAll(() => registerGameIcons(gameIcons));
beforeEach(() => window.history.replaceState(null, '', '/r'));
afterEach(() => { window.history.replaceState(null, '', '/r'); localStorage.clear(); });

const rec = (id: string, kind: string): KitRecord => ({ id, kind, title: `Запись ${id}`, status: 'ok', fields: {} });
const CENTER = rec('FORSETI', 'component');
const SPECS = Array.from({ length: 27 }, (_, i) => rec(`SPEC-${i}`, 'spec'));

const cfg = (withCount = true): KitConfig => ({
  modules: [], menu: { groups: [] },
  kinds: { component: { title: 'Компонент', icon: 'scroll-quill' } },
  edges: { DOCUMENTED_IN: { label: 'DOCUMENTED_IN', color: '--wrn' }, OWNS: { label: 'владеет', color: '--acc' } },
  graph: {
    depth: 1, limit: 60, colorBy: 'type',
    types: { spec: { label: 'Спека', color: '--wrn', ...(withCount ? { count: { one: '{n} спека', few: '{n} спеки', many: '{n} спек' } } : {}) } },
  },
  statuses: { items: [{ code: 'ok', title: 'ок', category: 'done', icon: 'check-mark', color: '--suc' }] },
} as KitConfig);
const dataOf = (extra = true): KitData => ({
  records: [CENTER, ...SPECS, rec('T-1', 'task')],
  edges: [
    ...SPECS.map(s => ({ from: s.id, to: 'FORSETI', type: 'DOCUMENTED_IN' }) as KitEdge),
    ...(extra ? [{ from: 'FORSETI', to: 'T-1', type: 'OWNS' } as KitEdge] : []),
  ],
  journal: [], meta: { generated_at: '2026-11-13T12:00:00Z' },
});
const show = (config = cfg(), data = dataOf()) => {
  const ctx: KitCtx = { data, config, href: id => `#rec=${encodeURIComponent(id)}`, esc: s => s, md: s => <div>{s}</div> };
  return render(<RecordView record={CENTER} ctx={ctx} tab="graph" onTab={() => {}} />);
};

describe('PU-11 · хаб графа', () => {
  it('подпись кластера — «27 спек ▸» по формам слова от приложения', () => {
    const { container } = show();
    const c = container.querySelector('[data-cluster] .sk-rec-graph__cbtn')!;
    expect(c.textContent).toBe('27 спек ▸');
  });
  it('форм слова нет — прежняя подпись типом связи (положительный контроль совместимости)', () => {
    const { container } = show(cfg(false));
    expect(container.querySelector('[data-cluster] .sk-rec-graph__cbtn')!.textContent).toContain('DOCUMENTED_IN');
  });
  it('кластер целиком внутри холста', () => {
    const { container } = show();
    const svg = container.querySelector('svg.sk-rec-graph__svg')!;
    const [vx, vy, vw, vh] = svg.getAttribute('viewBox')!.split(' ').map(Number);
    const fo = container.querySelector('[data-cluster] foreignObject')!;
    const x = Number(fo.getAttribute('x')), y = Number(fo.getAttribute('y'));
    const w = Number(fo.getAttribute('width')), h = Number(fo.getAttribute('height'));
    expect(x).toBeGreaterThanOrEqual(vx);
    expect(y).toBeGreaterThanOrEqual(vy);
    expect(x + w).toBeLessThanOrEqual(vx + vw);
    expect(y + h).toBeLessThanOrEqual(vy + vh);
  });
  it('все соседи свёрнуты — граф не «пустой», кластер на месте', () => {
    const { container } = show(cfg(), dataOf(false));
    expect(container.querySelector('[data-cluster]')).toBeTruthy();
  });
  it('Force: хаб — один узел-кластер, а не 27 узлов; выбор кластера раскрывает его', async () => {
    window.history.replaceState(null, '', '/r?gview=force');
    show();
    const eng = await screen.findByTestId('eng-force');
    const ids = eng.getAttribute('data-ids')!.split(',');
    expect(ids.filter(i => i.startsWith('SPEC-'))).toHaveLength(0);
    expect(ids.some(i => i.includes('DOCUMENTED_IN'))).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: /узел .*DOCUMENTED_IN/ }));
    fireEvent.click(await screen.findByRole('button', { name: /раскрыть/i }));
    const after = (await screen.findByTestId('eng-force')).getAttribute('data-ids')!.split(',');
    expect(after.filter(i => i.startsWith('SPEC-'))).toHaveLength(27);
  });
});
