// @vitest-environment jsdom
// SPRINT_UXR_S5_RECORD_TASKS/S5-10 · вкладка «Граф»: глубина 1–4, подписи рёбер
// словами, фильтры типов, слой структурных связей; состояние — в URL.
//
// 16.11.2026 владелица сняла «Секторы» и «Список» («оставьте только последние 3»): эти проверки
// не про раскладку, а про состояние вкладки, поэтому они смотрят в движок графа знаний (заглушка
// с теми же узлами и рёбрами, что получает Обсидиан), а не в SVG секторов.
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import gameIcons from '@iconify-json/game-icons/icons.json';
import { registerGameIcons } from '../elements/GameIcon';
import type { KitConfig, KitCtx, KitData, KitRecord } from '../core/contract';
import type { GxEngineProps } from '../graph/engineTypes';
import { RecordView } from './index';
import { axeViolations } from '../test/axe';

const stub = (name: string) => function Stub(p: GxEngineProps) {
  return <div data-testid={`eng-${name}`} data-ids={p.nodes.map(n => n.id).sort().join(',')} data-rels={[...new Set(p.edges.map(e => e.rel))].sort().join(',')} />;
};
vi.mock('../graph/ForceEngine', () => ({ default: stub('force') }));
vi.mock('../graph/ObsidianEngine', () => ({ default: stub('obsidian') }));
vi.mock('../graph/ReactFlowEngine', () => ({ default: stub('structure') }));

beforeAll(() => registerGameIcons(gameIcons));
beforeEach(() => window.history.replaceState(null, '', '/r'));
afterEach(() => { window.history.replaceState(null, '', '/r'); localStorage.clear(); });

const rec = (id: string, kind: string): KitRecord => ({ id, kind, title: `Запись ${id}`, status: 'ok', fields: {} });
const CENTER = rec('ADR-1', 'adr');

function cfg(over: Partial<KitConfig> = {}): KitConfig {
  return {
    modules: [], menu: { groups: [] },
    kinds: { adr: { title: 'ADR', icon: 'scroll-quill' }, task: { title: 'Задачи', icon: 'quill' } },
    edges: {
      DECIDED_IN: { label: 'решено в', color: '--acc' },
      REFERENCES: { label: 'упоминает', color: '--inf' },
      PART_OF: { label: 'входит в', color: '--t3', layer: 'structural' },
    },
    graph: { depth: 1, limit: 60, colorBy: 'type' },
    statuses: { items: [{ code: 'ok', title: 'ок', category: 'done', icon: 'check-mark', color: '--suc' }] },
    ...over,
  };
}

function dat(over: Partial<KitData> = {}): KitData {
  return {
    records: [CENTER, rec('D-1', 'decision'), rec('T-1', 'task'), rec('S-1', 'sprint'), rec('T-2', 'task')],
    edges: [
      { from: 'D-1', to: 'ADR-1', type: 'DECIDED_IN' },
      { from: 'T-1', to: 'ADR-1', type: 'REFERENCES' },
      { from: 'ADR-1', to: 'S-1', type: 'PART_OF' },
      { from: 'T-2', to: 'T-1', type: 'REFERENCES' },
    ],
    journal: [],
    meta: { generated_at: '2026-11-07T12:00:00Z' },
    ...over,
  };
}

const ctxOf = (config = cfg(), data = dat()): KitCtx => ({
  data, config, href: id => `#rec=${encodeURIComponent(id)}`, esc: s => s, md: s => <div>{s}</div>,
});

function show(ctx = ctxOf()) {
  return render(<RecordView record={CENTER} ctx={ctx} tab="graph" onTab={() => {}} />);
}

/** Соседи записи на холсте — то, что получил движок (без самой записи). */
const nodeIds = async () => (await screen.findByTestId('eng-obsidian')).getAttribute('data-ids')!
  .split(',').filter(id => id && id !== 'ADR-1').sort();
const param = (k: string) => new URLSearchParams(window.location.search).get(k);

describe('S5-10 · глубина 1–4', () => {
  it('по умолчанию — глубина из конфига; структурный слой скрыт', async () => {
    show();
    expect(await nodeIds()).toEqual(['D-1', 'T-1']);
    // Владелица 11.11: «связи 2, 3, 4 уровней» — глубина до 4; с 14.11 — выпадающим списком (S9-08).
    const depth = screen.getByRole('combobox', { name: /Шагов от записи/ }) as HTMLSelectElement;
    expect([...depth.options].map(o => o.textContent)).toEqual(['1', '2', '3', '4']);
    expect(depth.value).toBe('1');
  });

  it('глубина 2 — сосед соседа появляется, глубина пишется в URL', async () => {
    show();
    await nodeIds();
    act(() => { fireEvent.change(screen.getByRole('combobox', { name: /Шагов от записи/ }), { target: { value: '2' } }); });
    expect(await nodeIds()).toEqual(['D-1', 'T-1', 'T-2']);
    expect(param('gdepth')).toBe('2');
  });

  it('состояние читается из URL при открытии (ссылкой можно поделиться)', async () => {
    window.history.replaceState(null, '', '/r?gdepth=2&goff=DECIDED_IN');
    show();
    expect(await nodeIds()).toEqual(['T-1', 'T-2']);
  });
});

describe('S5-10 · подписи рёбер словами', () => {
  it('типы рёбер в фильтре подписаны словами из конфига, а не кодом', async () => {
    show();
    await nodeIds();
    const filters = screen.getByRole('group', { name: 'Типы рёбер' });
    expect(within(filters).getByRole('checkbox', { name: /решено в/ })).toBeTruthy();
    expect(within(filters).getByRole('checkbox', { name: /упоминает/ })).toBeTruthy();
  });
});

describe('S5-10 · фильтры типов', () => {
  it('выключенный тип прячет свои узлы, галочка снята, тип — в URL', async () => {
    show();
    await nodeIds();
    const filters = screen.getByRole('group', { name: 'Типы рёбер' });
    const chip = within(filters).getByRole('checkbox', { name: /упоминает/ }) as HTMLInputElement;
    expect(chip.checked).toBe(true);
    act(() => { fireEvent.click(chip); });
    expect(await nodeIds()).toEqual(['D-1']);
    expect((within(screen.getByRole('group', { name: 'Типы рёбер' })).getByRole('checkbox', { name: /упоминает/ }) as HTMLInputElement).checked).toBe(false);
    expect(param('goff')).toBe('REFERENCES');
  });

  it('фильтры скрыли всё — честное «скрыто фильтрами», а не «связей нет»; сброс возвращает', async () => {
    window.history.replaceState(null, '', '/r?goff=DECIDED_IN,REFERENCES');
    show();
    const state = document.querySelector('[data-state="empty"]');
    expect(state?.textContent).toContain('Фильтры скрыли');
    act(() => { fireEvent.click(screen.getByRole('button', { name: 'Сбросить фильтры' })); });
    expect(await nodeIds()).toEqual(['D-1', 'T-1']);
    expect(param('goff')).toBeNull();
  });
});

describe('S5-10 · слой структурных связей', () => {
  it('включение слоя показывает структурные рёбра и их фильтр; слой — в URL', async () => {
    show();
    await nodeIds();
    expect(within(screen.getByRole('group', { name: 'Типы рёбер' })).queryByRole('checkbox', { name: /входит в/ })).toBeNull();
    const toggle = screen.getByRole('button', { name: /Структурные связи/ });
    expect(toggle.getAttribute('aria-pressed')).toBe('false');
    act(() => { fireEvent.click(toggle); });
    expect(await nodeIds()).toEqual(['D-1', 'S-1', 'T-1']);
    expect(param('glayer')).toBe('struct');
    expect(within(screen.getByRole('group', { name: 'Типы рёбер' })).getByRole('checkbox', { name: /входит в/ })).toBeTruthy();
  });

  it('есть только структурные связи — подсказка включить слой, сброс включает его', async () => {
    show(ctxOf(cfg(), dat({ edges: [{ from: 'ADR-1', to: 'S-1', type: 'PART_OF' }] })));
    expect(document.querySelector('[data-state="empty"]')?.textContent).toContain('Фильтры скрыли');
    act(() => { fireEvent.click(screen.getByRole('button', { name: 'Сбросить фильтры' })); });
    expect(await nodeIds()).toEqual(['S-1']);
  });

  it('слоя нет в конфиге (нет структурных типов) — переключателя нет', () => {
    const edges = { DECIDED_IN: { label: 'решено в', color: '--acc' } };
    show(ctxOf(cfg({ edges }), dat({ edges: [{ from: 'D-1', to: 'ADR-1', type: 'DECIDED_IN' }] })));
    expect(screen.queryByRole('button', { name: /Структурные связи/ })).toBeNull();
  });
});

describe('S5-10 · доступность', () => {
  it('axe без нарушений на вкладке с настройками графа', async () => {
    const { container } = show();
    await nodeIds();
    expect(await axeViolations(container)).toEqual([]);
  });
});
