// @vitest-environment jsdom
// Настройки графа паспорта дропдаунами (SPRINT_UXR_S9_SCALE_OPT/S9-08, дополнение владелицы
// 14.11.2026): «и сделай выбор, сколько шагов от записи пройти, и выбор типа не полем, а
// дропдауном».
//  1) глубина — выпадающий список «Шагов от записи» 1/2/3/4, а не ряд кнопок;
//  2) типы рёбер (вкладка) и типы узлов (панель графа) — выпадающий список с галочками,
//     а не чипы и не поле «type:тип».
// Состояние — в адресе, как раньше (gdepth, goff).
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import gameIcons from '@iconify-json/game-icons/icons.json';
import { registerGameIcons } from '../elements/GameIcon';
import type { KitConfig, KitCtx, KitData, KitRecord } from '../core/contract';
import type { GxEngineProps } from '../graph/engineTypes';
import { GraphExplorer } from '../graph/GraphExplorer';
import { RecordView } from './index';

const stub = (name: string) => function Stub(p: GxEngineProps) {
  return <div data-testid={`eng-${name}`} data-ids={p.nodes.map(n => n.id).join(',')} />;
};
vi.mock('../graph/ForceEngine', () => ({ default: stub('force') }));
vi.mock('../graph/ObsidianEngine', () => ({ default: stub('obsidian') }));
vi.mock('../graph/ReactFlowEngine', () => ({ default: stub('structure') }));

beforeAll(() => registerGameIcons(gameIcons));
beforeEach(() => window.history.replaceState(null, '', '/r'));
afterEach(() => { window.history.replaceState(null, '', '/r'); localStorage.clear(); });

const rec = (id: string, kind: string): KitRecord => ({ id, kind, title: `Запись ${id}`, status: 'ok', fields: {} });
const CENTER = rec('ADR-1', 'adr');
const cfg: KitConfig = {
  modules: [], menu: { groups: [] },
  kinds: { adr: { title: 'ADR', icon: 'scroll-quill' } },
  edges: { DECIDED_IN: { label: 'решено в', color: '--acc' }, REFERENCES: { label: 'упоминает', color: '--inf' } },
  graph: { depth: 1, limit: 60, colorBy: 'type' },
  statuses: { items: [{ code: 'ok', title: 'ок', category: 'done', icon: 'check-mark', color: '--suc' }] },
} as KitConfig;
const data: KitData = {
  records: [CENTER, rec('D-1', 'decision'), rec('T-1', 'task'), rec('T-2', 'task')],
  edges: [
    { from: 'D-1', to: 'ADR-1', type: 'DECIDED_IN' },
    { from: 'T-1', to: 'ADR-1', type: 'REFERENCES' },
    { from: 'T-2', to: 'T-1', type: 'REFERENCES' },
  ],
  journal: [], meta: { generated_at: '2026-11-14T12:00:00Z' },
};
const show = () => {
  const ctx: KitCtx = { data, config: cfg, href: id => `#rec=${encodeURIComponent(id)}`, esc: s => s, md: s => <div>{s}</div> };
  return render(<RecordView record={CENTER} ctx={ctx} tab="graph" onTab={() => {}} />);
};
const param = (k: string) => new URLSearchParams(window.location.search).get(k);

describe('S9-08 доп. · «Шагов от записи» — выпадающий список', () => {
  it('глубина выбирается списком 1–4, а не рядом кнопок; выбор пишется в адрес', () => {
    show();
    const sel = screen.getByRole('combobox', { name: /Шагов от записи/ }) as HTMLSelectElement;
    expect([...sel.options].map(o => o.value)).toEqual(['1', '2', '3', '4']);
    expect(sel.value).toBe('1');
    expect(screen.queryByRole('group', { name: 'Глубина' }), 'ряд кнопок глубины снят').toBeNull();
    act(() => { fireEvent.change(sel, { target: { value: '2' } }); });
    expect(param('gdepth')).toBe('2');
    expect((screen.getByRole('combobox', { name: /Шагов от записи/ }) as HTMLSelectElement).value).toBe('2');
  });
});

describe('S9-08 доп. · типы рёбер — выпадающий список с галочками', () => {
  it('в легенде нет чипов-кнопок; галочка снимает тип и пишет goff', () => {
    show();
    const legend = screen.getByTestId('kit-graph-legend');
    expect(legend.querySelectorAll('button[aria-pressed]'), 'чипы типов сняты').toHaveLength(0);
    const summary = legend.querySelector('summary');
    expect(summary?.textContent).toMatch(/Типы рёбер/);
    expect(summary?.textContent).toMatch(/2 из 2/);
    const box = within(legend).getByRole('checkbox', { name: /упоминает/ }) as HTMLInputElement;
    expect(box.checked).toBe(true);
    act(() => { fireEvent.click(box); });
    expect(param('goff')).toBe('REFERENCES');
    const after = within(screen.getByTestId('kit-graph-legend')).getByRole('checkbox', { name: /упоминает/ }) as HTMLInputElement;
    expect(after.checked).toBe(false);
    expect(screen.getByTestId('kit-graph-legend').querySelector('summary')?.textContent).toMatch(/1 из 2/);
  });

  it('щелчок вне открытого списка закрывает его', () => {
    show();
    const menu = screen.getByTestId('kit-graph-legend').querySelector('details')!;
    menu.open = true;
    act(() => { fireEvent.mouseDown(document.body); });
    expect(menu.open).toBe(false);
  });
});

describe('S9-08 доп. · типы узлов в панели графа — выпадающий список, а не поле «type:тип»', () => {
  it('типы узлов — галочками в выпадающем списке; поле поиска больше не учит «type:»', () => {
    render(<GraphExplorer lang="ru" nodes={[{ id: 'A', type: 'adr' }, { id: 'T', type: 'task' }]} edges={[{ from: 'T', to: 'A', rel: 'R' }]}
      types={{ adr: { label: 'ADR', color: '--suc' }, task: { label: 'Задача', color: '--t2' } }} />);
    const menu = screen.getByTestId('gx-types');
    expect(menu.tagName).toBe('DETAILS');
    expect(menu.querySelector('summary')?.textContent).toMatch(/Типы узлов.*2 из 2/);
    const box = within(menu).getByRole('checkbox', { name: /Задача/ }) as HTMLInputElement;
    expect(box.checked).toBe(true);
    act(() => { fireEvent.click(box); });
    expect((within(screen.getByTestId('gx-types')).getByRole('checkbox', { name: /Задача/ }) as HTMLInputElement).checked).toBe(false);
    const search = screen.getByRole('searchbox') as HTMLInputElement;
    expect(search.placeholder).not.toMatch(/type:/);
  });
});
