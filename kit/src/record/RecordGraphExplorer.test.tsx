// @vitest-environment jsdom
// SPRINT_SEIDRKIT_GRAPH_CANVAS/GC-03 + SPRINT_UXR_S12_KIT3_VOLVA_GRAPH/S5-10 ·
// вкладка «Граф»: рядом с «Секторами» и «Списком» — виды Force и «Обсидиан»
// (общий GraphExplorer). Владелица 11.11.2026: «1 ок» — секторы остаются; вид по
// умолчанию — личная настройка человека (config.graph.view), выбор в адресе главнее.
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import gameIcons from '@iconify-json/game-icons/icons.json';
import { registerGameIcons } from '../elements/GameIcon';
import type { KitConfig, KitCtx, KitData, KitRecord } from '../core/contract';
import type { GxEngineProps } from '../graph/engineTypes';
import { RecordView } from './index';

const stub = (name: string) => function Stub(p: GxEngineProps) {
  return (
    <div data-testid={`eng-${name}`} data-ids={p.nodes.map(n => `${n.id}:${n.type}`).sort().join(',')}
      data-rels={[...new Set(p.edges.map(e => e.rel))].sort().join(',')}>
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
const CENTER = rec('ADR-1', 'adr');

const cfg = (view?: 'graph' | 'links' | 'force' | 'obsidian'): KitConfig => ({
  modules: [], menu: { groups: [] },
  kinds: { adr: { title: 'ADR', icon: 'scroll-quill' }, task: { title: 'Задачи', icon: 'quill' } },
  edges: { DECIDED_IN: { label: 'решено в', color: '--acc' }, REFERENCES: { label: 'упоминает', color: '--inf' } },
  graph: { depth: 1, limit: 60, colorBy: 'type', ...(view ? { view } : {}) },
  statuses: { items: [{ code: 'ok', title: 'ок', category: 'done', icon: 'check-mark', color: '--suc' }] },
});
const data: KitData = {
  records: [CENTER, rec('D-1', 'decision'), rec('T-1', 'task')],
  edges: [{ from: 'D-1', to: 'ADR-1', type: 'DECIDED_IN' }, { from: 'T-1', to: 'ADR-1', type: 'REFERENCES' }],
  journal: [], meta: { generated_at: '2026-11-11T12:00:00Z' },
};
const ctxOf = (config: KitConfig): KitCtx => ({ data, config, href: id => `#rec=${encodeURIComponent(id)}`, esc: s => s, md: s => <div>{s}</div> });
const show = (config = cfg()) => render(<RecordView record={CENTER} ctx={ctxOf(config)} tab="graph" onTab={() => {}} />);

describe('GC-03 · вкладка «Граф»: Секторы / Список / Force / Обсидиан', () => {
  it('четыре вида в переключателе; по умолчанию — секторы, как было', () => {
    show();
    const views = screen.getByTestId('kit-graph-view');
    expect([...views.querySelectorAll('button')].map(b => b.textContent)).toEqual(['Секторы', 'Список', 'Force', 'Обсидиан']);
    expect(screen.queryByTestId('gx')).toBeNull();
  });

  it('Force: тот же круг записей и связей — в GraphExplorer; выбор пишется в адрес', async () => {
    show();
    fireEvent.click(screen.getByRole('button', { name: 'Force' }));
    const eng = await screen.findByTestId('eng-force');
    expect(eng.getAttribute('data-ids')).toBe('ADR-1:adr,D-1:decision,T-1:task');
    expect(eng.getAttribute('data-rels')).toBe('DECIDED_IN,REFERENCES');
    expect(new URLSearchParams(window.location.search).get('gview')).toBe('force');
  });

  it('вид по умолчанию задаёт приложение (личная настройка) — Обсидиан', async () => {
    show(cfg('obsidian'));
    expect(await screen.findByTestId('eng-obsidian')).toBeTruthy();
  });

  it('выбор в адресе главнее настройки: ссылка открывает тот вид, каким ею поделились', async () => {
    window.history.replaceState(null, '', '/r?gview=force');
    show(cfg('obsidian'));
    expect(await screen.findByTestId('eng-force')).toBeTruthy();
    expect(screen.queryByTestId('eng-obsidian')).toBeNull();
  });

  it('Peek из приложения (config.graph.peek) — карточка выбранного узла во вкладке', async () => {
    const config = cfg('force');
    config.graph = { ...config.graph!, peek: id => <article data-testid="peek-card">{`Peek ${id}`}</article> };
    render(<RecordView record={CENTER} ctx={ctxOf(config)} tab="graph" onTab={() => {}} />);
    await screen.findByTestId('eng-force');
    expect(screen.queryByTestId('peek-card')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'узел D-1' }));
    expect(screen.getByTestId('peek-card').textContent).toBe('Peek D-1');
  });

  it('без Peek у приложения — строка с названием и ссылкой «Открыть» в паспорт узла', async () => {
    show(cfg('force'));
    fireEvent.click(await screen.findByRole('button', { name: 'узел T-1' }));
    const sel = screen.getByTestId('gx-selected');
    expect(sel.querySelector('a')!.getAttribute('href')).toBe('#rec=T-1');
  });

  it('свой переключатель GraphExplorer во вкладке спрятан — переключатель один', async () => {
    show(cfg('force'));
    await screen.findByTestId('eng-force');
    expect(screen.queryByTestId('gx-engines')).toBeNull();
  });
});
