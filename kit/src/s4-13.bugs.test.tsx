// @vitest-environment jsdom
// SPRINT_UXR_S4_UI_SHELL_LISTS/S4-13 — баги B-07, B-08, B-09 из Q-UXR-4
// (D-2026-UXR-BUGS-IN-REDESIGN: чиним в каркасе v2, каждый — с падающим тестом).
// Здесь — та часть, что живёт в kit (общие механизмы оболочки, клавиш и
// строк); маршруты LORE (B-01, B-02, B-06) — web-next/src/nav/loreRoutes.test.ts.
//
// Правила, до которых обобщены частные баги:
//   B-07 → параметры URL принадлежат разделу: смена раздела/модуля оставляет
//          только параметры оболочки и явно объявленные глобальные;
//   B-08 → «редактируемая цель» определяется одной функцией на весь kit и
//          видит любого потомка contenteditable (TipTap кладёт фокус внутрь);
//   B-09 → любая строка, которую можно открыть мышью, открывается с клавиатуры.
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import gameIcons from '@iconify-json/game-icons/icons.json';
import { KitShell, createSafeStorage, registerGameIcons, useKitShell } from './index';
import type { KitConfig, KitData, KitRecord } from './index';
import type { UrlWindow } from './resilience/urlState';
import { isEditableTarget } from './resilience/editable';
import { useHotkeys } from './resilience/useHotkeys';
import { CommandPalette, useKitPalette } from './palette/Palette';
import { createRecentList } from './palette/paletteModel';
import { fixtureConfig, fixtureData } from './palette/fixtures.test-helper';
import { KitLangProvider } from './i18n';
import { ListView } from './list/ListView';
import { TreeView } from './views/tree/TreeView';

beforeAll(() => { registerGameIcons(gameIcons); });

// ── B-07: q и фильтры перетекают между разделами ─────────────────────────

const SHELL: KitConfig = {
  modules: [
    { id: 'lore', title: 'LORE', icon: 'scroll-unfurled', status: 'active' },
    { id: 'research', title: 'Исследования', icon: 'raven' },
  ],
  menu: {
    groups: [{
      id: 'work', title: 'Работа', items: [
        { id: 'sprints', title: 'Спринты', icon: 'sprint', view: 'list' },
        { id: 'adr', title: 'ADR', icon: 'scales', view: 'list' },
      ],
    }],
  },
  kinds: {},
  statuses: { items: [] },
};

function fakeWin(search = ''): UrlWindow {
  const w: UrlWindow = {
    location: { pathname: '/', search, hash: '' },
    history: {
      pushState: (_s, _t, url) => { w.location.search = String(url).replace(/^[^?]*/, '').replace(/#.*$/, ''); },
      replaceState: (_s, _t, url) => { w.location.search = String(url).replace(/^[^?]*/, '').replace(/#.*$/, ''); },
    },
  };
  return w;
}

function memStorage() {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => { m.set(k, v); },
    removeItem: (k: string) => { m.delete(k); },
  } as unknown as Storage;
}

function ViewSwitch() {
  const api = useKitShell();
  return <button type="button" onClick={() => api.navigate({ view: 'board' })}>доска</button>;
}

const LEAKY = '?mod=lore&sec=sprints&view=list&q=релиз&lf=%7B%22status%22%3A%5B%22done%22%5D%7D&lq=done&tq=x&tab=links&lang=en';

describe('B-07 · параметры раздела не перетекают в другой раздел', () => {
  it('смена раздела снимает q, фильтры списка/дерева и вкладку записи', () => {
    const win = fakeWin(LEAKY);
    render(<KitShell config={SHELL} win={win} storage={createSafeStorage(memStorage)} narrow={false} />);
    fireEvent.click(screen.getByRole('link', { name: 'ADR' }));
    const p = new URLSearchParams(win.location.search);
    expect(p.get('sec')).toBe('adr');
    for (const k of ['q', 'lf', 'lq', 'tq', 'tab']) expect(p.get(k), k).toBeNull();
  });

  it('смена модуля — то же самое', () => {
    const win = fakeWin(LEAKY);
    render(<KitShell config={SHELL} win={win} storage={createSafeStorage(memStorage)} narrow={false} />);
    fireEvent.click(screen.getByRole('button', { name: 'Исследования' }));
    const p = new URLSearchParams(win.location.search);
    expect(p.get('mod')).toBe('research');
    expect(p.get('q')).toBeNull();
    expect(p.get('lf')).toBeNull();
  });

  it('объявленные глобальные параметры (keepParams) переживают смену раздела', () => {
    const win = fakeWin(LEAKY);
    render(<KitShell config={SHELL} win={win} storage={createSafeStorage(memStorage)} narrow={false} keepParams={['lang']} />);
    fireEvent.click(screen.getByRole('link', { name: 'ADR' }));
    const p = new URLSearchParams(win.location.search);
    expect(p.get('lang')).toBe('en');
    expect(p.get('q')).toBeNull();
  });

  it('смена вида внутри раздела фильтры НЕ снимает — это тот же раздел', () => {
    const win = fakeWin(LEAKY);
    render(<KitShell config={SHELL} win={win} storage={createSafeStorage(memStorage)} narrow={false}><ViewSwitch /></KitShell>);
    fireEvent.click(screen.getByRole('button', { name: 'доска' }));
    const p = new URLSearchParams(win.location.search);
    expect(p.get('view')).toBe('board');
    expect(p.get('q')).toBe('релиз');
    expect(p.get('lq')).toBe('done');
  });
});

// ── B-08: «/» в TipTap открывает палитру ─────────────────────────────────

/** Разметка как у TipTap/ProseMirror: фокус и keydown — во вложенном узле. */
function editorDom() {
  const root = document.createElement('div');
  root.innerHTML = `
    <div class="ProseMirror" contenteditable="" role="textbox"><p data-testid="para">текст</p>
      <span contenteditable="false"><button type="button" data-testid="island">узел</button></span>
    </div>
    <div contenteditable="plaintext-only"><b data-testid="plain">x</b></div>
    <div role="textbox" data-testid="aria-box">поле</div>
    <button type="button" data-testid="btn">кнопка</button>`;
  document.body.appendChild(root);
  return root;
}

describe('B-08 · редактируемая цель — одна функция на весь kit', () => {
  it('потомок contenteditable (в т.ч. contenteditable="" и plaintext-only) — редактируемый', () => {
    const root = editorDom();
    expect(isEditableTarget(root.querySelector('[data-testid="para"]'))).toBe(true);
    expect(isEditableTarget(root.querySelector('[data-testid="plain"]'))).toBe(true);
    expect(isEditableTarget(root.querySelector('[data-testid="aria-box"]'))).toBe(true);
    root.remove();
  });

  it('остров contenteditable="false" и обычная кнопка — не редактируемые', () => {
    const root = editorDom();
    expect(isEditableTarget(root.querySelector('[data-testid="island"]'))).toBe(false);
    expect(isEditableTarget(root.querySelector('[data-testid="btn"]'))).toBe(false);
    expect(isEditableTarget(null)).toBe(false);
    expect(isEditableTarget(window)).toBe(false);
    root.remove();
  });

  it('«/» из абзаца редактора не открывает поиск палитры', () => {
    function Harness() {
      const p = useKitPalette();
      const ctx = { data: fixtureData(), config: fixtureConfig(), href: (id: string) => `#rec=${id}`, esc: (s: string) => s, md: (s: string) => s };
      return (
        <KitLangProvider lang="ru">
          {/* contenteditable="" — валидное «включено», которого нет в типах React. */}
          <div className="ProseMirror" {...({ contenteditable: '' } as Record<string, string>)} suppressContentEditableWarning><p data-testid="para">текст</p></div>
          <CommandPalette open={p.open} mode={p.mode} onClose={p.close} ctx={ctx} recent={createRecentList(createSafeStorage(() => null))} />
        </KitLangProvider>
      );
    }
    render(<Harness />);
    act(() => { fireEvent.keyDown(screen.getByTestId('para'), { code: 'Slash', key: '/' }); });
    expect(screen.queryByRole('dialog')).toBeNull();
    // Положительный контроль: та же клавиша вне редактора поиск открывает.
    act(() => { fireEvent.keyDown(document.body, { code: 'Slash', key: '/' }); });
    expect(screen.queryByRole('dialog')).not.toBeNull();
  });

  it('useHotkeys: клавиша без модификатора из абзаца редактора не срабатывает', () => {
    const run = vi.fn();
    function Harness() {
      useHotkeys({ '/': run });
      return <div contentEditable suppressContentEditableWarning><p data-testid="para">текст</p></div>;
    }
    render(<Harness />);
    act(() => { fireEvent.keyDown(screen.getByTestId('para'), { code: 'Slash', key: '/' }); });
    expect(run).not.toHaveBeenCalled();
    act(() => { fireEvent.keyDown(document.body, { code: 'Slash', key: '/' }); });
    expect(run).toHaveBeenCalledTimes(1);
  });
});

// ── B-09: строки не работают с клавиатуры ────────────────────────────────

const LIST_CFG: KitConfig = {
  modules: [], menu: { groups: [] }, kinds: { item: { title: 'Новость', icon: 'scroll-unfurled' } },
  statuses: { items: [{ code: 'todo', title: 'к работе', category: 'todo', icon: 'calendar', color: 'var(--t3)' }] },
  list: { views: ['list', 'board'], columns: ['title+id', 'status'] },
};
const rec = (id: string, fields: Record<string, unknown> = {}): KitRecord =>
  ({ id, kind: 'item', title: `Запись ${id}`, status: 'todo', fields });
const LIST_DATA: KitData = {
  records: [rec('N-1'), rec('N-2')], edges: [], journal: [], meta: { generated_at: '2026-11-07T00:00:00Z' },
};

describe('B-09 · строку, которую открывают мышью, открывают и с клавиатуры', () => {
  it('ListView без href, но с onOpen: заголовок — кнопка в порядке Tab, Enter открывает', () => {
    const onOpen = vi.fn();
    render(<KitLangProvider lang="ru"><ListView config={LIST_CFG} data={LIST_DATA} onOpen={onOpen} urlState={false} /></KitLangProvider>);
    const btn = screen.getByRole('button', { name: 'Запись N-1' });
    expect(btn.tabIndex).toBe(0);
    btn.focus();
    fireEvent.click(btn); // Enter/Space на <button> браузер превращает в click
    expect(onOpen).toHaveBeenCalledWith('N-1');
  });

  it('ListView на доске: тот же onOpen у карточки', () => {
    const onOpen = vi.fn();
    render(<KitLangProvider lang="ru"><ListView config={LIST_CFG} data={LIST_DATA} onOpen={onOpen} urlState={false} initial={{ view: 'board' }} /></KitLangProvider>);
    fireEvent.click(screen.getByRole('button', { name: 'Запись N-2' }));
    expect(onOpen).toHaveBeenCalledWith('N-2');
  });

  it('ListView с href: заголовок — ссылка, и onOpen (если задан) вызывается при переходе', () => {
    const onOpen = vi.fn();
    render(<KitLangProvider lang="ru"><ListView config={LIST_CFG} data={LIST_DATA} href={id => `#rec=${id}`} onOpen={onOpen} urlState={false} /></KitLangProvider>);
    const a = screen.getByRole('link', { name: 'Запись N-1' });
    expect(a.getAttribute('href')).toBe('#rec=N-1');
    fireEvent.click(a);
    expect(onOpen).toHaveBeenCalledWith('N-1');
  });

  it('TreeView только с href: Enter на строке дерева переходит по ссылке записи', () => {
    const cfg: KitConfig = {
      ...LIST_CFG,
      list: { views: ['list', 'tree'], tree: { parent: 'parent', order: 'order' } },
    };
    const data: KitData = { ...LIST_DATA, records: [rec('R', { parent: null, order: 1 }), rec('C', { parent: 'R', order: 1 })] };
    render(<KitLangProvider lang="ru"><TreeView config={cfg} data={data} href={id => `#rec=${id}`} /></KitLangProvider>);
    const row = screen.getAllByRole('treeitem')[0];
    const link = row.querySelector('a')!;
    const clicked = vi.fn((e: Event) => e.preventDefault());
    link.addEventListener('click', clicked);
    row.focus();
    fireEvent.keyDown(row, { key: 'Enter', code: 'Enter' });
    expect(clicked).toHaveBeenCalledTimes(1);
  });
});
