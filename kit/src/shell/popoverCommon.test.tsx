// @vitest-environment jsdom
// ОДИН ОБЩИЙ ПОПОВЕР ВМЕСТО ПЯТИ РАЗНЫХ МЕНЮ
// (SPRINT_UXR_S4_UI_SHELL_LISTS/S4-MENU-STATES, строка «долг» в плане владелицы).
//
// ОТКУДА ДОЛГ. Его назвал сам код — KitShell, RailMenu: «Своё маленькое
// всплывающее меню, а не общий элемент: в kit их уже три (палитра статусов,
// „Ещё“ у вкладок, и это), и общий поповер стоит завести отдельно».
//
// ПЕРЕВЕДЁННЫЕ МЕСТА (список держать здесь, иначе сторож отстаёт от кода):
//   1. меню статуса у чипа — core/StatusPopover (первая правка S4-MENU-STATES);
//   2. «Ещё» у вкладок — shell/Tabs;
//   3. личный блок рейки — shell/KitShell, RailMenu;
//   4. палитра звезды статуса — elements/StatusPalette (эта правка);
//   5. ячейка статуса в таблице задач — tasks/TaskTable (эта правка).
// Шестого «своего» всплывающего меню в kit быть не должно: оболочка одна.
// Отдельно стоят поповеры-ДИАЛОГИ полосы списка (list/ViewMenu, list/GroupMenu,
// list/SortMenu, picker/ScopePicker): у них role=dialog, которую общий слой пока
// не носит, — они в этот сторож не входят и остались при своей ловушке фокуса.
//
// ИНВЕНТАРИЗАЦИЯ ПЕРВЫХ ТРЁХ МЕНЮ (до сведения). Разное у них ровно двух родов.
//
// 1) СОДЕРЖИМОЕ — различается ПО СУЩЕСТВУ, и сводить его нельзя:
//    • меню статуса — пункты (role=menuitem) плюс «Отмена» и третий шаг
//      (подтверждение завершающего статуса), и «Отмена» обязана быть ВНЕ
//      role=menu: она не menuitem;
//    • «Ещё» у вкладок — пункты, но ОТКРЫВАТЕЛЬ живёт внутри role=tablist и
//      обязан быть role=tab: обычная кнопка там валит axe (aria-required-children);
//    • меню рейки — ССЫЛКИ на записи и виды, поэтому role=group, а не menu:
//      объявить меню и положить внутрь ссылки значит соврать скринридеру и
//      отнять у ссылок их поведение (новая вкладка, копировать адрес).
//    Эти три правила здесь закреплены тестами — чтобы сведение их не стёрло.
//
// 2) ПОВЕДЕНИЕ ОБОЛОЧКИ — различалось СЛУЧАЙНО, у каждого свой огрызок:
//    ловушка фокуса, возврат фокуса, стрелки, щелчок вне, край экрана. Вот это
//    и сводится в общий Popover, причём двое из трёх на этом не теряют, а
//    ПРИОБРЕТАЮТ: у «Ещё» не было ни щелчка вне, ни фокуса, ни стрелок; у
//    рейки — ни ловушки фокуса, ни стрелок, ни возврата фокуса.
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import gameIcons from '@iconify-json/game-icons/icons.json';
import { KitShell, StatusPopover, StatusStar, TaskTable, Tabs, createSafeStorage, registerGameIcons } from '../index';
import type { KitConfig, KitData, TabItem, TaskRowData } from '../index';
import type { UrlWindow } from '../resilience/urlState';
import { Popover } from './Popover';
import { axeViolations } from '../test/axe';

beforeAll(() => { registerGameIcons(gameIcons); });

// В jsdom-окружении import.meta.url не file:// — путь от корня пакета kit
// (vitest запускается из kit/, как и в CI), ровно как в bare-html.test.tsx.
const css = readFileSync(resolve(process.cwd(), 'src/styles/seidr.css'), 'utf8');

/** Правило CSS по селектору (первое вхождение), без комментариев. */
function rule(selector: string): string {
  const body = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const at = body.indexOf(`\n${selector}`);
  if (at < 0) return '';
  const open = body.indexOf('{', at);
  const close = body.indexOf('}', open);
  return open < 0 || close < 0 ? '' : body.slice(open + 1, close);
}

// ---------- стенд: вкладки со свёрткой «Ещё» ----------

const TABS: TabItem[] = [
  { id: 'tasks', label: 'Задачи', count: 59 },
  { id: 'phases', label: 'Фазы', secondary: true },
  { id: 'deps', label: 'Зависит от', secondary: true },
  { id: 'blocks', label: 'Блокирует', secondary: true },
];

/** Вкладки открыты на «Ещё»; возвращает кнопку свёртки и её меню. */
function openMore() {
  const onChange = vi.fn();
  render(<Tabs items={TABS} value="tasks" onChange={onChange} label="Разделы" />);
  const btn = screen.getByRole('tab', { name: /Ещё/ });
  btn.focus();
  fireEvent.click(btn);
  return { btn, pop: screen.getByRole('menu', { name: /Ещё/ }), onChange };
}

// ---------- стенд: рейка меню ----------

const CONFIG: KitConfig = {
  modules: [{ id: 'lore', title: 'LORE', icon: 'scroll-unfurled', status: 'active' }],
  menu: {
    myViews: true,
    recent: true,
    groups: [{ id: 'work', title: 'Работа', tone: 'acc', items: [{ id: 'sprints', title: 'Спринты', icon: 'sprint', view: 'list' }] }],
  },
  kinds: { sprint: { title: 'Спринт', icon: 'sprint' } },
  statuses: { items: [{ code: 'done', title: 'Готово', category: 'done', icon: 'check-mark', color: 'var(--suc)' }] },
};

const DATA: KitData = {
  records: [
    { id: 'SPRINT_A', kind: 'sprint', title: 'Спринт А', status: 'done', fields: {} },
    { id: 'SPRINT_B', kind: 'sprint', title: 'Спринт Б', status: 'done', fields: {} },
  ],
  edges: [], journal: [], meta: { generated_at: '2026-11-09T00:00:00Z' },
};

function fakeWin(): UrlWindow {
  const w: UrlWindow = {
    location: { pathname: '/kit', search: '', hash: '' },
    history: {
      pushState: (_s, _t, url) => { w.location.search = String(url).replace(/^[^?]*/, '').replace(/#.*$/, ''); },
      replaceState: (_s, _t, url) => { w.location.search = String(url).replace(/^[^?]*/, '').replace(/#.*$/, ''); },
    },
  };
  return w;
}

function memStorage(initial: Record<string, string>) {
  const m = new Map(Object.entries(initial));
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => { m.set(k, v); },
    removeItem: (k: string) => { m.delete(k); },
  } as unknown as Storage;
}

const RAIL = { 'seidr-kit.menuMode': 'rail', 'seidr-kit.recent': JSON.stringify(['SPRINT_A', 'SPRINT_B']) };

/** Рейка открыта на «Недавних»; возвращает кнопку и её поповер. */
function openRail() {
  render(
    <KitShell
      config={CONFIG} data={DATA} win={fakeWin()} narrow={false}
      storage={createSafeStorage(() => memStorage(RAIL))}
      recordHref={id => `/rec/${id}`}
    ><p>содержимое</p></KitShell>,
  );
  const btn = screen.getByRole('button', { name: /Недавние/ });
  btn.focus();
  act(() => { btn.click(); });
  return { btn, pop: screen.getByRole('group', { name: /Недавние/ }) };
}

// ---------- стенд: меню статуса ----------

const STATUSES: KitConfig['statuses'] = {
  items: [
    { code: 'todo', title: 'К работе', category: 'todo', icon: 'checkbox-tree', color: '--t3' },
    { code: 'active', title: 'В работе', category: 'active', icon: 'progression', color: 'acc' },
    { code: 'done', title: 'Готово', category: 'done', icon: 'divided-spiral', color: 'var(--suc)' },
  ],
};

// ---------- стенд: палитра звезды статуса ----------

const STAR_TITLES: Record<string, string> = { todo: 'К работе', active: 'В работе', done: 'Готово', blocked: 'Заблокировано' };
const STAR_OPTIONS = ['todo', 'active', 'done', 'blocked'];

/** Звезда открыта на палитре; возвращает звезду, меню и сам слой поповера. */
function openStar() {
  const onPick = vi.fn(async () => {});
  render(
    <StatusStar status="todo" options={STAR_OPTIONS} titleOf={c => STAR_TITLES[c] ?? c} onPick={onPick} showLabel />,
  );
  const btn = screen.getByRole('button', { name: /^Статус:/ });
  btn.focus();
  fireEvent.click(btn);
  const menu = screen.getByRole('menu', { name: 'Сменить статус' });
  // Слой — корень всплывашки (.sk-spop), меню лежит ВНУТРИ него: «Отмена» не
  // menuitem и обязана быть вне role=menu, поэтому роль не у корня.
  return { btn, menu, pop: menu.closest('.sk-spop') as HTMLElement, onPick };
}

// ---------- стенд: ячейка статуса в таблице задач ----------

const TT_TASKS: TaskRowData[] = [
  { uid: 'u2', id: 'S5-02', title: 'Вкладка задач', status: 'todo', phase: null, effortDays: null, executor: null, reviewer: null, taskType: null, workClass: null, order: 1 },
];

/** Ячейка статуса открыта; возвращает звезду ячейки и её меню. */
function openTaskStatus() {
  const onStatusChange = vi.fn(async () => {});
  render(<TaskTable tasks={TT_TASKS} phases={[]} groupBy="none" onStatusChange={onStatusChange} label="Задачи" />);
  const star = screen.getByRole('button', { name: /Статус/ });
  star.focus();
  fireEvent.click(star);
  return { star, pop: screen.getByRole('menu', { name: /S5-02/ }), onStatusChange };
}

/**
 * Замер без раскладки: jsdom не считает геометрию, поэтому прямоугольник слоя
 * подменяется. Общий для всех мест — край экрана у них один и тот же.
 */
const withRect = (box: { left: number; width: number; top?: number; height?: number }, run: () => void) => {
  const orig = HTMLElement.prototype.getBoundingClientRect;
  HTMLElement.prototype.getBoundingClientRect = function () {
    if (!this.classList.contains('sk-pop')) return orig.call(this);
    const top = box.top ?? 10;
    const height = box.height ?? 100;
    return {
      x: box.left, y: top, left: box.left, top, width: box.width, height,
      right: box.left + box.width, bottom: top + height, toJSON: () => ({}),
    } as DOMRect;
  };
  try { run(); } finally { HTMLElement.prototype.getBoundingClientRect = orig; }
};

// =====================================================================
// 1. Что остаётся РАЗНЫМ (сведение не имеет права это стереть)
// =====================================================================

describe('S4-MENU-STATES · инвентаризация: разное по существу — остаётся разным', () => {
  it('меню статуса: пункты — menuitem, «Отмена» — ВНЕ role=menu (она не пункт меню)', () => {
    render(<StatusPopover statuses={STATUSES} current="todo" onPick={() => {}} onCancel={() => {}} />);
    const menu = screen.getByRole('menu');
    expect(within(menu).getAllByRole('menuitem').length).toBeGreaterThan(0);
    const cancel = screen.getByRole('button', { name: 'Отмена' });
    expect(menu.contains(cancel)).toBe(false);
  });

  it('«Ещё» у вкладок: открыватель — role=tab внутри tablist, а не кнопка (иначе axe валит ряд)', () => {
    const { btn } = openMore();
    expect(btn.getAttribute('role')).toBe('tab');
    expect(btn.getAttribute('aria-haspopup')).toBe('menu');
    expect(btn.closest('[role="tablist"]')).toBeTruthy();
  });

  it('«Ещё»: САМО меню лежит ВНЕ tablist — role=menu внутри ряда вкладок axe валит', () => {
    // Вторая половина находки B13. Тогда из ряда убрали чужую роль у КНОПКИ
    // свёртки, а чужую роль у всплывашки не заметили: axe её открытой не
    // проверяли. Ряд вкладок обязан содержать только вкладки.
    const { pop, btn } = openMore();
    expect(pop.closest('[role="tablist"]')).toBeNull();
    // При этом кнопка — внутри ряда, и связь между ними названа.
    expect(btn.closest('[role="tablist"]')).toBeTruthy();
    expect(btn.getAttribute('aria-controls')).toBe(pop.id);
    // Ряд остаётся ПРЯМЫМ ребёнком корня: на это опирается липкий ряд записи
    // (`.sk-rec__tabs > .sk-tabs`), поэтому обёртку вокруг ряда ставить нельзя.
    const list = screen.getByRole('tablist');
    expect(list.parentElement?.classList.contains('sk-tabs-root')).toBe(true);
    expect(list.nextElementSibling).toBe(pop);
  });

  it('меню рейки: role=group со ССЫЛКАМИ — объявить его меню значило бы соврать', () => {
    const { pop } = openRail();
    expect(pop.getAttribute('role')).toBe('group');
    expect(within(pop).getAllByRole('link').length).toBeGreaterThan(0);
    expect(within(pop).queryAllByRole('menuitem')).toHaveLength(0);
  });
});

// =====================================================================
// 2. Общая оболочка: один слой на все три
// =====================================================================

describe('S4-MENU-STATES · общий слой: все три всплывашки — один элемент', () => {
  it('у класса sk-pop есть правило в seidr.css, и оно — положение и рамка слоя', () => {
    const r = rule('.sk-pop ');
    expect(r).toMatch(/position:\s*absolute/);
    expect(r).toMatch(/--pop-dx/);
  });

  it('меню статуса, «Ещё» и рейка носят общий класс sk-pop', () => {
    render(<StatusPopover statuses={STATUSES} current="todo" onPick={() => {}} onCancel={() => {}} />);
    expect(document.querySelector('.sk-spop')?.classList.contains('sk-pop')).toBe(true);
    const { pop: more } = openMore();
    expect(more.classList.contains('sk-pop')).toBe(true);
    const { pop: rail } = openRail();
    expect(rail.classList.contains('sk-pop')).toBe(true);
  });

  it('всплывашка свёртки держится своего места в потоке (ей задан data-align=under)', () => {
    const { pop } = openMore();
    expect(pop.dataset.align).toBe('under');
    // И у этого положения есть правило: без своего `top` — у абсолютного
    // элемента без top сохраняется статическое место, то есть прямо под рядом
    // (margin-top — это зазор, а не положение).
    const r = rule(".sk-pop[data-align='under']");
    expect(r).toMatch(/right:\s*0/);
    expect(r.replace(/margin-top:[^;]*;?/g, '')).not.toMatch(/top:/);
  });

  it('цель касания у пунктов всех трёх — не меньше var(--tap)', () => {
    for (const sel of ['.sk-spop__item ', '.sk-tabs__more-item ', '.sk-shell__item ']) {
      expect(rule(sel), sel).toMatch(/min-height:\s*max\(var\(--tap\)/);
    }
  });
});

// =====================================================================
// 3. Связь открывателя и поповера (aria-controls) — у всех трёх
// =====================================================================

describe('S4-MENU-STATES · открыватель назван связью с поповером', () => {
  it('«Ещё»: aria-controls указывает на открытое меню и исчезает при закрытии', () => {
    const { btn, pop } = openMore();
    expect(btn.getAttribute('aria-controls')).toBe(pop.id);
    expect(pop.id).toBeTruthy();
    fireEvent.keyDown(pop, { key: 'Escape', code: 'Escape' });
    expect(btn.getAttribute('aria-controls')).toBeNull();
  });

  it('рейка: aria-controls указывает на открытый поповер', () => {
    const { btn, pop } = openRail();
    expect(btn.getAttribute('aria-controls')).toBe(pop.id);
    expect(pop.id).toBeTruthy();
  });
});

// =====================================================================
// 4. Щелчок вне закрывает — все три
// =====================================================================

describe('S4-MENU-STATES · щелчок вне закрывает', () => {
  it('«Ещё»: щелчок мимо закрывает свёртку (раньше её нельзя было закрыть мышью)', () => {
    openMore();
    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole('menu', { name: /Ещё/ })).toBeNull();
  });

  it('«Ещё»: щелчок по самой кнопке — это переключатель, а не «вне» (меню закрывается, а не мигает)', () => {
    const { btn } = openMore();
    fireEvent.mouseDown(btn);
    fireEvent.click(btn);
    expect(screen.queryByRole('menu', { name: /Ещё/ })).toBeNull();
  });

  it('рейка: щелчок мимо закрывает (положительный контроль — умела и раньше)', () => {
    openRail();
    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole('group', { name: /Недавние/ })).toBeNull();
  });

  it('рейка: щелчок по кнопке закрывает, а не открывает заново', () => {
    const { btn } = openRail();
    fireEvent.mouseDown(btn);
    act(() => { btn.click(); });
    expect(screen.queryByRole('group', { name: /Недавние/ })).toBeNull();
  });
});

// =====================================================================
// 5. Клавиатура: фокус внутрь, стрелки, ловушка Tab, возврат фокуса
// =====================================================================

describe('S4-MENU-STATES · «Ещё»: клавиатура как у меню статуса', () => {
  it('при открытии фокус уходит на первый пункт', () => {
    const { pop } = openMore();
    expect(document.activeElement).toBe(within(pop).getAllByRole('menuitem')[0]);
  });

  it('стрелки ходят по пунктам по кругу', () => {
    const { pop } = openMore();
    const items = within(pop).getAllByRole('menuitem');
    fireEvent.keyDown(items[0], { key: 'ArrowDown', code: 'ArrowDown' });
    expect(document.activeElement).toBe(items[1]);
    fireEvent.keyDown(items[1], { key: 'ArrowUp', code: 'ArrowUp' });
    expect(document.activeElement).toBe(items[0]);
    fireEvent.keyDown(items[0], { key: 'ArrowUp', code: 'ArrowUp' });
    expect(document.activeElement).toBe(items[items.length - 1]);
  });

  it('ловушка Tab: с последнего пункта — на первый, Shift+Tab с первого — на последний', () => {
    const { pop } = openMore();
    const items = within(pop).getAllByRole('menuitem');
    const last = items[items.length - 1];
    fireEvent.keyDown(items[0], { key: 'Tab', code: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(last);
    fireEvent.keyDown(last, { key: 'Tab', code: 'Tab' });
    expect(document.activeElement).toBe(items[0]);
  });

  it('Esc закрывает и возвращает фокус на «Ещё» — иначе место на странице потеряно', () => {
    const { btn, pop } = openMore();
    fireEvent.keyDown(pop, { key: 'Escape', code: 'Escape' });
    expect(screen.queryByRole('menu', { name: /Ещё/ })).toBeNull();
    expect(document.activeElement).toBe(btn);
    expect(btn.getAttribute('aria-expanded')).toBe('false');
  });

  it('выбор пункта по-прежнему переключает вкладку (ничего не потеряно)', () => {
    const { pop, onChange } = openMore();
    fireEvent.click(within(pop).getByRole('menuitem', { name: /Зависит от/ }));
    expect(onChange).toHaveBeenCalledWith('deps');
  });
});

describe('S4-MENU-STATES · рейка: та же клавиатура, хотя внутри ссылки', () => {
  it('при открытии фокус уходит на первую ссылку', () => {
    const { pop } = openRail();
    expect(document.activeElement).toBe(within(pop).getAllByRole('link')[0]);
  });

  it('стрелки ходят по ссылкам по кругу', () => {
    const { pop } = openRail();
    const links = within(pop).getAllByRole('link');
    expect(links.length).toBeGreaterThan(1);
    fireEvent.keyDown(links[0], { key: 'ArrowDown', code: 'ArrowDown' });
    expect(document.activeElement).toBe(links[1]);
    fireEvent.keyDown(links[1], { key: 'ArrowUp', code: 'ArrowUp' });
    expect(document.activeElement).toBe(links[0]);
  });

  it('ловушка Tab не выпускает фокус из поповера', () => {
    const { pop } = openRail();
    const links = within(pop).getAllByRole('link');
    const last = links[links.length - 1];
    fireEvent.keyDown(last, { key: 'Tab', code: 'Tab' });
    expect(document.activeElement).toBe(links[0]);
  });

  it('Esc закрывает и возвращает фокус на кнопку рейки', () => {
    const { btn, pop } = openRail();
    fireEvent.keyDown(pop, { key: 'Escape', code: 'Escape' });
    expect(screen.queryByRole('group', { name: /Недавние/ })).toBeNull();
    expect(document.activeElement).toBe(btn);
  });
});

// =====================================================================
// 6. Край экрана
// =====================================================================

describe('S4-MENU-STATES · поповер не уезжает за границу экрана', () => {
  it('выход за правый край — поповер сдвигается влево на столько же', () => {
    withRect({ left: 900, width: 300 }, () => {
      render(<Popover onClose={() => {}} label="Меню" role="menu"><button type="button" role="menuitem">раз</button></Popover>);
      const pop = screen.getByRole('menu', { name: 'Меню' });
      // window.innerWidth в jsdom — 1024; правый край 1200 → сдвиг на -180 (с зазором 4).
      expect(pop.style.getPropertyValue('--pop-dx')).toBe('-180px');
    });
  });

  it('положительный контроль: поповер в границах экрана не сдвигается', () => {
    withRect({ left: 100, width: 300 }, () => {
      render(<Popover onClose={() => {}} label="Меню" role="menu"><button type="button" role="menuitem">раз</button></Popover>);
      const pop = screen.getByRole('menu', { name: 'Меню' });
      expect(pop.style.getPropertyValue('--pop-dx')).toBe('');
    });
  });

  it('выход за нижний край — поповер раскрывается вверх', () => {
    withRect({ left: 100, width: 200, top: 600, height: 300 }, () => {
      render(<Popover onClose={() => {}} label="Меню" role="menu"><button type="button" role="menuitem">раз</button></Popover>);
      // window.innerHeight в jsdom — 768; низ 900 за краем, а сверху 300 места есть.
      expect(screen.getByRole('menu', { name: 'Меню' }).dataset.side).toBe('up');
    });
  });
});

// =====================================================================
// 6б. Палитра звезды статуса (место 4): та же оболочка
//
// До этой правки у палитры был свой огрызок: свой разбор Esc, свои стрелки,
// свой первый фокус, а щелчок мимо ловила ОБЁРТКА звезды (свой mousedown на
// document). Чего не было вовсе: ловушки Tab и прижатия к краю экрана — на
// узком экране палитра уезжала за правый край.
// =====================================================================

describe('S4-MENU-STATES · палитра звезды: тот же слой, что у остальных', () => {
  it('палитра носит общий класс sk-pop', () => {
    const { pop } = openStar();
    expect(pop.classList.contains('sk-pop')).toBe(true);
  });

  it('край экрана: палитра сдвигается влево, а не уезжает за правый край', () => {
    withRect({ left: 900, width: 300 }, () => {
      const { pop } = openStar();
      // window.innerWidth в jsdom — 1024; правый край 1200 → сдвиг на -180 (с зазором 4).
      expect(pop.style.getPropertyValue('--pop-dx')).toBe('-180px');
    });
  });

  it('ловушка Tab: с «Отмена» — на первый пункт, Shift+Tab с первого — на «Отмена»', () => {
    const { menu, pop } = openStar();
    const items = within(menu).getAllByRole('menuitem');
    const cancel = within(pop).getByRole('button', { name: 'Отмена' });
    fireEvent.keyDown(items[0], { key: 'Tab', code: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(cancel);
    fireEvent.keyDown(cancel, { key: 'Tab', code: 'Tab' });
    expect(document.activeElement).toBe(items[0]);
  });

  it('инвариант: «Отмена» лежит ВНЕ role=menu (она не пункт меню)', () => {
    const { menu, pop } = openStar();
    expect(menu.contains(within(pop).getByRole('button', { name: 'Отмена' }))).toBe(false);
  });

  it('фокус при открытии — на первом пункте, стрелки ходят по кругу (умела и раньше)', () => {
    const { menu } = openStar();
    const items = within(menu).getAllByRole('menuitem');
    expect(document.activeElement).toBe(items[0]);
    fireEvent.keyDown(items[0], { key: 'ArrowDown', code: 'ArrowDown' });
    expect(document.activeElement).toBe(items[1]);
    fireEvent.keyDown(items[1], { key: 'ArrowUp', code: 'ArrowUp' });
    expect(document.activeElement).toBe(items[0]);
    fireEvent.keyDown(items[0], { key: 'ArrowUp', code: 'ArrowUp' });
    expect(document.activeElement).toBe(items[items.length - 1]);
  });

  it('Esc закрывает и возвращает фокус на звезду (умела и раньше)', () => {
    const { btn, menu } = openStar();
    fireEvent.keyDown(menu, { key: 'Escape', code: 'Escape' });
    expect(screen.queryByRole('menu')).toBeNull();
    expect(document.activeElement).toBe(btn);
    expect(btn.getAttribute('aria-expanded')).toBe('false');
  });

  it('щелчок мимо закрывает (умела и раньше — но уже оболочкой, а не обёрткой)', () => {
    openStar();
    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('щелчок по самой звезде закрывает, а не открывает заново', () => {
    const { btn } = openStar();
    fireEvent.mouseDown(btn);
    fireEvent.click(btn);
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('выбор пункта по-прежнему пишет статус (ничего не потеряно)', () => {
    const { menu, onPick } = openStar();
    fireEvent.click(within(menu).getByRole('menuitem', { name: /В работе/ }));
    expect(onPick).toHaveBeenCalledWith('active', 'todo');
  });
});

// =====================================================================
// 6в. Ячейка статуса в таблице задач (место 5): та же оболочка
//
// До правки у ячейки был свой разбор клавиш (Esc, стрелки, Home/End) и
// закрытие ПО УХОДУ ФОКУСА (onBlur) вместо щелчка вне: мышью мимо таблицы
// меню не закрывалось, пока фокус оставался внутри. Ловушки Tab и прижатия к
// краю экрана не было, а связь звезды с меню (aria-controls) не называлась.
// =====================================================================

describe('S4-MENU-STATES · ячейка статуса в таблице задач: тот же слой', () => {
  it('меню ячейки носит общий класс sk-pop', () => {
    const { pop } = openTaskStatus();
    expect(pop.classList.contains('sk-pop')).toBe(true);
  });

  it('звезда ячейки названа связью с меню (aria-controls → id меню)', () => {
    const { star, pop } = openTaskStatus();
    expect(pop.id).toBeTruthy();
    expect(star.getAttribute('aria-controls')).toBe(pop.id);
    expect(star.getAttribute('aria-expanded')).toBe('true');
  });

  it('щелчок мимо закрывает меню — мышью, а не только уходом фокуса', () => {
    openTaskStatus();
    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('щелчок по звезде при открытом меню закрывает его, а не открывает заново', () => {
    const { star } = openTaskStatus();
    fireEvent.mouseDown(star);
    fireEvent.click(star);
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('ловушка Tab: с последнего пункта — на первый, Shift+Tab с первого — на последний', () => {
    const { pop } = openTaskStatus();
    const items = within(pop).getAllByRole('menuitemradio');
    const last = items[items.length - 1];
    fireEvent.keyDown(items[0], { key: 'Tab', code: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(last);
    fireEvent.keyDown(last, { key: 'Tab', code: 'Tab' });
    expect(document.activeElement).toBe(items[0]);
  });

  it('край экрана: меню ячейки сдвигается влево', () => {
    withRect({ left: 900, width: 300 }, () => {
      const { pop } = openTaskStatus();
      expect(pop.style.getPropertyValue('--pop-dx')).toBe('-180px');
    });
  });

  it('инвариант: пункты — menuitemradio с aria-checked, а не простые menuitem', () => {
    const { pop } = openTaskStatus();
    expect(within(pop).queryAllByRole('menuitem')).toHaveLength(0);
    const items = within(pop).getAllByRole('menuitemradio');
    expect(items.length).toBeGreaterThan(1);
    expect(items.filter(i => i.getAttribute('aria-checked') === 'true')).toHaveLength(1);
  });

  it('фокус при открытии — на текущем статусе; стрелки, Home и End ходят по пунктам', () => {
    const { pop } = openTaskStatus();
    const items = within(pop).getAllByRole('menuitemradio');
    const checked = items.find(i => i.getAttribute('aria-checked') === 'true')!;
    expect(document.activeElement).toBe(checked);
    fireEvent.keyDown(checked, { key: 'ArrowDown', code: 'ArrowDown' });
    expect(document.activeElement).toBe(items[items.indexOf(checked) + 1]);
    fireEvent.keyDown(document.activeElement!, { key: 'End', code: 'End' });
    expect(document.activeElement).toBe(items[items.length - 1]);
    fireEvent.keyDown(document.activeElement!, { key: 'Home', code: 'Home' });
    expect(document.activeElement).toBe(items[0]);
  });

  it('Esc закрывает и возвращает фокус на звезду ячейки (умела и раньше)', () => {
    const { star, pop } = openTaskStatus();
    fireEvent.keyDown(pop, { key: 'Escape', code: 'Escape' });
    expect(screen.queryByRole('menu')).toBeNull();
    expect(document.activeElement).toBe(star);
  });

  it('выбор пункта по-прежнему пишет статус (ничего не потеряно)', async () => {
    const { pop, onStatusChange } = openTaskStatus();
    await act(async () => { fireEvent.click(within(pop).getByRole('menuitemradio', { name: 'Готово' })); });
    expect(onStatusChange).toHaveBeenCalledWith(TT_TASKS[0], 'done');
    expect(screen.queryByRole('menu')).toBeNull();
  });
});

// =====================================================================
// 7. Доступность открытых поповеров
// =====================================================================

describe('S4-MENU-STATES · axe: открытые поповеры', () => {
  it('открытая свёртка «Ещё» внутри tablist — без нарушений', async () => {
    const { container } = render(<Tabs items={TABS} value="tasks" onChange={() => {}} label="Разделы" />);
    fireEvent.click(screen.getByRole('tab', { name: /Ещё/ }));
    expect(await axeViolations(container)).toEqual([]);
  });

  it('открытый поповер рейки — без нарушений', async () => {
    openRail();
    expect(await axeViolations(document.querySelector('.sk-shell') as Element)).toEqual([]);
  });

  it('меню статуса — без нарушений', async () => {
    const { container } = render(<StatusPopover statuses={STATUSES} current="todo" onPick={() => {}} onCancel={() => {}} />);
    expect(await axeViolations(container)).toEqual([]);
  });

  it('открытая палитра звезды — без нарушений', async () => {
    openStar();
    expect(await axeViolations(document.querySelector('.sk-star-wrap') as Element)).toEqual([]);
  });

  it('открытое меню ячейки статуса внутри таблицы — без нарушений', async () => {
    // Роли внутри таблицы проверяются целиком: role=menu внутри чужой роли
    // (как было с tablist) axe валит именно на уровне контейнера.
    openTaskStatus();
    expect(await axeViolations(document.querySelector('.sk-tasks') as Element)).toEqual([]);
  });
});
