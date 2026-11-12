// @vitest-environment jsdom
// SPRINT_UXR_S5_RECORD_TASKS/S5-10 · вкладка «Граф»: глубина 1–3, подписи рёбер
// словами, фильтры типов, слой структурных связей; состояние — в URL.
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import gameIcons from '@iconify-json/game-icons/icons.json';
import { registerGameIcons } from '../elements/GameIcon';
import type { KitConfig, KitCtx, KitData, KitRecord } from '../core/contract';
import { RecordView } from './index';
import { axeViolations } from '../test/axe';

beforeAll(() => registerGameIcons(gameIcons));
beforeEach(() => window.history.replaceState(null, '', '/r'));
afterEach(() => window.history.replaceState(null, '', '/r'));

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

const nodeIds = () => [...document.querySelectorAll('[data-testid="kit-graph"] [data-node]')]
  .map(n => n.getAttribute('data-node')).filter(id => id !== 'ADR-1').sort();
const param = (k: string) => new URLSearchParams(window.location.search).get(k);

describe('S5-10 · глубина 1–3', () => {
  it('по умолчанию — глубина из конфига; структурный слой скрыт', () => {
    show();
    expect(nodeIds()).toEqual(['D-1', 'T-1']);
    const depth = screen.getByRole('group', { name: 'Глубина' });
    const buttons = within(depth).getAllByRole('button');
    // Владелица 11.11: «связи 2, 3, 4 уровней» — глубина до 4 (было до 3).
    expect(buttons.map(b => b.textContent)).toEqual(['1', '2', '3', '4']);
    expect(buttons[0].getAttribute('aria-pressed')).toBe('true');
  });

  it('глубина 2 — сосед соседа появляется, глубина пишется в URL', () => {
    show();
    act(() => { fireEvent.click(within(screen.getByRole('group', { name: 'Глубина' })).getByRole('button', { name: '2' })); });
    expect(nodeIds()).toEqual(['D-1', 'T-1', 'T-2']);
    expect(param('gdepth')).toBe('2');
  });

  it('состояние читается из URL при открытии (ссылкой можно поделиться)', () => {
    window.history.replaceState(null, '', '/r?gdepth=2&goff=DECIDED_IN');
    show();
    expect(nodeIds()).toEqual(['T-1', 'T-2']);
  });
});

describe('S5-10 · подписи рёбер словами', () => {
  it('у ребра — подпись из конфига (title для наведения и текст у центра)', () => {
    show();
    const edge = document.querySelector('[data-testid="kit-graph"] [data-edge="DECIDED_IN:D-1:ADR-1"]');
    expect(edge?.querySelector('title')?.textContent).toContain('решено в');
    const labels = [...document.querySelectorAll('.sk-rec-graph__edge-label')].map(t => t.textContent);
    expect(labels).toContain('решено в');
    expect(labels).toContain('упоминает');
  });
});

describe('S5-10 · фильтры типов', () => {
  it('выключенный тип прячет свои узлы, кнопка отжата, тип — в URL', () => {
    show();
    const filters = screen.getByRole('group', { name: 'Типы рёбер' });
    const chip = within(filters).getByRole('button', { name: /упоминает/ });
    expect(chip.getAttribute('aria-pressed')).toBe('true');
    act(() => { fireEvent.click(chip); });
    expect(nodeIds()).toEqual(['D-1']);
    expect(within(screen.getByRole('group', { name: 'Типы рёбер' })).getByRole('button', { name: /упоминает/ }).getAttribute('aria-pressed')).toBe('false');
    expect(param('goff')).toBe('REFERENCES');
  });

  it('фильтры скрыли всё — честное «скрыто фильтрами», а не «связей нет»; сброс возвращает', () => {
    window.history.replaceState(null, '', '/r?goff=DECIDED_IN,REFERENCES');
    show();
    const state = document.querySelector('[data-state="empty"]');
    expect(state?.textContent).toContain('Фильтры скрыли');
    act(() => { fireEvent.click(screen.getByRole('button', { name: 'Сбросить фильтры' })); });
    expect(nodeIds()).toEqual(['D-1', 'T-1']);
    expect(param('goff')).toBeNull();
  });
});

describe('S5-10 · слой структурных связей', () => {
  it('включение слоя показывает структурные рёбра и их фильтр; слой — в URL', () => {
    show();
    expect(within(screen.getByRole('group', { name: 'Типы рёбер' })).queryByRole('button', { name: /входит в/ })).toBeNull();
    const toggle = screen.getByRole('button', { name: /Структурные связи/ });
    expect(toggle.getAttribute('aria-pressed')).toBe('false');
    act(() => { fireEvent.click(toggle); });
    expect(nodeIds()).toEqual(['D-1', 'S-1', 'T-1']);
    expect(param('glayer')).toBe('struct');
    expect(within(screen.getByRole('group', { name: 'Типы рёбер' })).getByRole('button', { name: /входит в/ })).toBeTruthy();
  });

  it('есть только структурные связи — подсказка включить слой, сброс включает его', () => {
    show(ctxOf(cfg(), dat({ edges: [{ from: 'ADR-1', to: 'S-1', type: 'PART_OF' }] })));
    expect(document.querySelector('[data-state="empty"]')?.textContent).toContain('Фильтры скрыли');
    act(() => { fireEvent.click(screen.getByRole('button', { name: 'Сбросить фильтры' })); });
    expect(nodeIds()).toEqual(['S-1']);
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
    expect(await axeViolations(container)).toEqual([]);
  });
});
