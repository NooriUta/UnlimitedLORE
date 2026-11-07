// @vitest-environment jsdom
// SPRINT_UXR_S5_RECORD_TASKS/S5-05 · режим чтения kit: колонка ~680 px, где
// таблицы, код и диаграммы выходят шире; ⤢ — блок на весь экран; Aa — размер
// текста; ушко правой колонки (по умолчанию выключена, D-2026-UXR-RAIL-OFF);
// меню оболочки при чтении сворачивается по настройке (D-2026-UXR-READ-COLLAPSE).
// Раскладку jsdom не считает — ширины проверяет readingCss.test.ts по правилам.
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { useState } from 'react';
import gameIcons from '@iconify-json/game-icons/icons.json';

vi.mock('mermaid', () => ({
  default: { registerLayoutLoaders: vi.fn(), initialize: vi.fn(), render: vi.fn(async () => ({ svg: '<svg><text>A</text></svg>' })) },
}));
vi.mock('bpmn-js/lib/NavigatedViewer', () => ({
  default: class { importXML() { return Promise.resolve(); } get() { return { zoom: () => {} }; } destroy() {} },
}));

import { axeViolations } from '../test/axe';
import { KitShell, createSafeStorage, registerGameIcons } from '../index';
import type { KitConfig } from '../index';
import type { UrlWindow } from '../resilience/urlState';
import { MartProse } from '../content';
import { ReadingView, ReadingSettings } from './ReadingView';
import { readingPrefsKey } from './readingPrefs';

beforeAll(() => {
  registerGameIcons(gameIcons);
});

function mem() {
  const m = new Map<string, string>();
  return createSafeStorage(() => ({
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => { m.set(k, v); },
    removeItem: (k: string) => { m.delete(k); },
  }) as unknown as Storage);
}

const WIDE = (
  <div className="sk-prose">
    <p>Абзац текста.</p>
    <table><thead><tr><th>a</th><th>b</th></tr></thead><tbody><tr><td>1</td><td>2</td></tr></tbody></table>
    <pre><code>select 1</code></pre>
  </div>
);

const CONFIG: KitConfig = {
  modules: [{ id: 'lore', title: 'LORE', icon: 'scroll-unfurled' }],
  menu: { groups: [{ id: 'g', title: 'Работа', items: [{ id: 'sprints', title: 'Спринты' }] }] },
  kinds: {},
  statuses: { items: [] },
};

function fakeWin(): UrlWindow {
  const w: UrlWindow = {
    location: { pathname: '/', search: '', hash: '' },
    history: { pushState: () => {}, replaceState: () => {} },
  };
  return w;
}

describe('S5-05 · колонка чтения и широкие блоки', () => {
  it('текст в колонке sk-read__col; таблица и код помечены широкими и получили ⤢', () => {
    const { container } = render(<ReadingView storage={mem()}>{WIDE}</ReadingView>);
    const col = container.querySelector('.sk-read__col');
    expect(col).toBeTruthy();
    expect(col!.querySelector('table')!.classList.contains('sk-read__wide')).toBe(true);
    expect(col!.querySelector('pre')!.classList.contains('sk-read__wide')).toBe(true);
    // абзац — обычный, в колонке
    expect(col!.querySelector('p')!.classList.contains('sk-read__wide')).toBe(false);
    expect(screen.getAllByRole('button', { name: 'Блок на весь экран' })).toHaveLength(2);
  });

  it('⤢ открывает блок на весь экран копией; Esc закрывает, оригинал на месте', () => {
    const { container } = render(<ReadingView storage={mem()}>{WIDE}</ReadingView>);
    fireEvent.click(screen.getAllByRole('button', { name: 'Блок на весь экран' })[0]);
    const dlg = screen.getByRole('dialog', { name: 'Блок на весь экран' });
    expect(dlg.className).toMatch(/\bsk-read-full\b/);
    expect(within(dlg).getByText('a')).toBeTruthy();
    // в копии нет кнопок ⤢ и служебных классов колонки
    expect(dlg.querySelector('.sk-read__expand')).toBeNull();
    fireEvent.keyDown(dlg, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(container.querySelector('.sk-read__col table')).toBeTruthy();
  });

  it('диаграмма, дорисованная позже (mermaid асинхронен), тоже получает ⤢', async () => {
    const { container } = render(
      <ReadingView storage={mem()}><MartProse text={'Текст\n\n```mermaid\ngraph TD\nA-->B\n```\n\n| x | y |\n|---|---|\n| 1 | 2 |'} /></ReadingView>,
    );
    await act(async () => { await Promise.resolve(); await new Promise(r => setTimeout(r, 0)); });
    const diagram = container.querySelector('.sk-prose__diagram');
    expect(diagram, 'диаграмма отрисована').toBeTruthy();
    expect(diagram!.classList.contains('sk-read__wide')).toBe(true);
    expect(container.querySelector('.sk-prose table')!.classList.contains('sk-read__wide')).toBe(true);
    expect(screen.getAllByRole('button', { name: 'Блок на весь экран' })).toHaveLength(2);
  });

  it('без широких блоков кнопок ⤢ нет', () => {
    render(<ReadingView storage={mem()}><p>Только текст</p></ReadingView>);
    expect(screen.queryByRole('button', { name: 'Блок на весь экран' })).toBeNull();
  });
});

describe('S5-05 · Aa — размер текста запоминается', () => {
  it('по умолчанию m; Aa раскрывает выбор, «Крупный» ставит l и пишет в хранилище', () => {
    const st = mem();
    const { container, unmount } = render(<ReadingView storage={st} storageKey="t">{WIDE}</ReadingView>);
    const root = container.querySelector('.sk-read')!;
    expect(root.getAttribute('data-size')).toBe('m');
    const aa = screen.getByRole('button', { name: 'Настройки чтения' });
    expect(aa.textContent).toContain('Aa');
    expect(aa.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(aa);
    expect(aa.getAttribute('aria-expanded')).toBe('true');
    const group = screen.getByRole('radiogroup', { name: 'Размер текста' });
    fireEvent.click(within(group).getByRole('radio', { name: 'Крупный' }));
    expect(root.getAttribute('data-size')).toBe('l');
    expect(st.get(readingPrefsKey('t'))).toContain('"size":"l"');
    unmount();
    const again = render(<ReadingView storage={st} storageKey="t">{WIDE}</ReadingView>);
    expect(again.container.querySelector('.sk-read')!.getAttribute('data-size')).toBe('l');
  });

  it('Esc закрывает панель Aa и возвращает фокус на кнопку', () => {
    render(<ReadingView storage={mem()}>{WIDE}</ReadingView>);
    const aa = screen.getByRole('button', { name: 'Настройки чтения' });
    fireEvent.click(aa);
    const panel = screen.getByRole('group', { name: 'Настройки чтения' });
    fireEvent.keyDown(panel, { key: 'Escape' });
    expect(screen.queryByRole('group', { name: 'Настройки чтения' })).toBeNull();
    expect(document.activeElement).toBe(aa);
  });
});

describe('S5-05 · ушко правой колонки', () => {
  it('без содержимого колонки ушка нет', () => {
    render(<ReadingView storage={mem()}>{WIDE}</ReadingView>);
    expect(screen.queryByRole('button', { name: 'Свойства' })).toBeNull();
  });

  it('по умолчанию колонка выключена; ушко открывает и запоминает', () => {
    const st = mem();
    const { unmount } = render(
      <ReadingView storage={st} storageKey="t" rail={<p>Статус: done</p>}>{WIDE}</ReadingView>,
    );
    const ear = screen.getByRole('button', { name: 'Свойства' });
    expect(ear.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByText('Статус: done')).toBeNull();
    fireEvent.click(ear);
    expect(ear.getAttribute('aria-expanded')).toBe('true');
    const aside = screen.getByRole('complementary', { name: 'Свойства' });
    expect(ear.getAttribute('aria-controls')).toBe(aside.id);
    expect(within(aside).getByText('Статус: done')).toBeTruthy();
    unmount();
    render(<ReadingView storage={st} storageKey="t" rail={<p>Статус: done</p>}>{WIDE}</ReadingView>);
    expect(screen.getByText('Статус: done')).toBeTruthy();
  });

  it('своя подпись ушка (например, «Свойства задачи» для S5-04)', () => {
    render(<ReadingView storage={mem()} rail={<p>x</p>} railLabel="Свойства задачи">{WIDE}</ReadingView>);
    expect(screen.getByRole('button', { name: 'Свойства задачи' })).toBeTruthy();
  });

  it('на узком экране колонка открывается листом справа', () => {
    render(<ReadingView storage={mem()} narrow rail={<p>Статус: done</p>}>{WIDE}</ReadingView>);
    fireEvent.click(screen.getByRole('button', { name: 'Свойства' }));
    const dlg = screen.getByRole('dialog', { name: 'Свойства' });
    expect(within(dlg).getByText('Статус: done')).toBeTruthy();
  });
});

describe('S5-05 · меню оболочки при чтении — по настройке', () => {
  function Harness({ st, reading: initial = true }: { st: ReturnType<typeof mem>; reading?: boolean }) {
    const [reading, setReading] = useState(initial);
    return (
      <KitShell config={CONFIG} storage={st} win={fakeWin()} narrow={false}>
        <button type="button" onClick={() => setReading(r => !r)}>переключить</button>
        {reading && <ReadingView storage={st}>{WIDE}</ReadingView>}
      </KitShell>
    );
  }

  it('по умолчанию при чтении меню свёрнуто в ушко «Меню»; ушко раскрывает', () => {
    const { container } = render(<Harness st={mem()} />);
    expect(container.querySelector('.sk-shell__side')).toBeNull();
    const ear = screen.getByRole('button', { name: 'Меню' });
    expect(ear.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(ear);
    expect(container.querySelector('.sk-shell__side')).toBeTruthy();
  });

  it('вышли из чтения — меню вернулось', () => {
    const { container } = render(<Harness st={mem()} />);
    expect(container.querySelector('.sk-shell__side')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'переключить' }));
    expect(container.querySelector('.sk-shell__side')).toBeTruthy();
  });

  it('настройка «не сворачивать» — меню остаётся; переключатель в Aa меняет сразу', () => {
    const st = mem();
    st.set(readingPrefsKey('seidr-kit'), JSON.stringify({ collapseMenu: false }));
    const { container } = render(<Harness st={st} />);
    expect(container.querySelector('.sk-shell__side')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Настройки чтения' }));
    const box = screen.getByRole('checkbox', { name: 'Сворачивать меню при чтении' }) as HTMLInputElement;
    expect(box.checked).toBe(false);
    fireEvent.click(box);
    expect(container.querySelector('.sk-shell__side')).toBeNull();
    expect(st.get(readingPrefsKey('seidr-kit'))).toContain('"collapseMenu":true');
  });

  it('вне оболочки ReadingView работает (меню сворачивать некому)', () => {
    render(<ReadingView storage={mem()}>{WIDE}</ReadingView>);
    expect(screen.getByRole('button', { name: 'Настройки чтения' })).toBeTruthy();
  });
});

describe('S5-05 · ReadingSettings для страницы личных настроек', () => {
  it('те же настройки отдельным блоком: размер и «сворачивать меню»', () => {
    const st = mem();
    render(<ReadingSettings storage={st} storageKey="t" />);
    fireEvent.click(screen.getByRole('radio', { name: 'Мелкий' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Сворачивать меню при чтении' }));
    expect(JSON.parse(st.get(readingPrefsKey('t'))!)).toMatchObject({ size: 's', collapseMenu: false });
  });
});

describe('S5-05 · доступность', () => {
  it('axe: колонка, ушко, Aa открыт — без нарушений', async () => {
    const { container } = render(<ReadingView storage={mem()} rail={<p>x</p>}>{WIDE}</ReadingView>);
    fireEvent.click(screen.getByRole('button', { name: 'Настройки чтения' }));
    fireEvent.click(screen.getByRole('button', { name: 'Свойства' }));
    expect(await axeViolations(container)).toEqual([]);
  });
});
