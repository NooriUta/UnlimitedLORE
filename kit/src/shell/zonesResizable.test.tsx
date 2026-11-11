// @vitest-environment jsdom
// Границы зон ПОДКЛЮЧЕНЫ: левое меню, правая колонка свойств, нижний док
// (SPRINT_UXR_S4_UI_SHELL_LISTS/S4-30).
//
// Повод — владелица 09.11.2026: «левое, правое меню не имеет драг анд дроп
// мышкой свернуть развернуть», и позже: «надеюсь что ресайзбл границы между
// блоками вы все же доделаете».
//
// Почему это отдельный файл, а не продолжение `ResizeBorder.test.tsx`: тот
// проверяет САМ разделитель, а здесь — что он доходит до человека в каждой из
// трёх зон. Ровно этот разрыв уже случался дважды в один день (выбор колонок и
// личные ширины: написаны, покрыты тестами, ниоткуда не вызывались), и
// снаружи он выглядит не как «не доделано», а как «возможности нет».
//
// Второе, что здесь закреплено: границы НЕТ там, где тянуть нечего — у рейки
// иконок, у меню, убранного в ушко, и у паспорта во весь экран. Ручка без
// зоны обещала бы управление, которого нет.
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { writeWidths } from '../list/columnWidths';
import { act, render, screen, within } from '@testing-library/react';
import gameIcons from '@iconify-json/game-icons/icons.json';
import { KitShell, RecordDock, RecordView, createSafeStorage, registerGameIcons } from '../index';
import type { KitConfig, KitCtx, KitData, KitRecord } from '../index';
import type { UrlWindow } from '../resilience/urlState';

beforeAll(() => { registerGameIcons(gameIcons); });

const CONFIG: KitConfig = {
  modules: [{ id: 'lore', title: 'LORE', icon: 'scroll-unfurled', status: 'active' }],
  menu: { groups: [{ id: 'work', title: 'Работа', tone: 'acc', items: [{ id: 'sprints', title: 'Спринты', icon: 'sprint', view: 'list' }] }] },
  kinds: {
    sprint: {
      title: 'Спринт', icon: 'sprint',
      fields: [{ key: 'goal', title: 'Цель', type: 'text' }, { key: 'owner', title: 'Владелец', type: 'text' }],
    },
  },
  statuses: { items: [{ code: 'done', title: 'Готово', category: 'done', icon: 'check-mark', color: 'var(--suc)' }] },
};

const DATA: KitData = {
  records: [{ id: 'SPRINT_A', kind: 'sprint', title: 'Спринт А', status: 'done', fields: {} }],
  edges: [], journal: [], meta: { generated_at: '2026-11-09T00:00:00Z' },
};

const RECORD: KitRecord = {
  id: 'SPRINT_A', kind: 'sprint', title: 'Спринт А', status: 'done',
  fields: { goal: 'Доделать границы', owner: 'kit' },
};
const CTX: KitCtx = { config: CONFIG, data: DATA, href: id => `#${id}`, esc: s => s, md: s => s };

function fakeWin(search = ''): UrlWindow {
  const w: UrlWindow = {
    location: { pathname: '/kit', search, hash: '' },
    history: {
      pushState: (_s, _t, url) => { w.location.search = String(url).replace(/^[^?]*/, '').replace(/#.*$/, ''); },
      replaceState: (_s, _t, url) => { w.location.search = String(url).replace(/^[^?]*/, '').replace(/#.*$/, ''); },
    },
  };
  return w;
}

function memStorage() {
  const m = new Map<string, string>();
  const s = {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => { m.set(k, v); },
    removeItem: (k: string) => { m.delete(k); },
  } as unknown as Storage;
  return { storage: s, map: m };
}

/** См. `ResizeBorder.test.tsx`: PointerEvent в jsdom нет, координаты несёт MouseEvent. */
const drag = (el: HTMLElement, dx: number, dy = 0) => {
  act(() => {
    el.dispatchEvent(new MouseEvent('pointerdown', { clientX: 300, clientY: 400, bubbles: true, cancelable: true }));
    window.dispatchEvent(new MouseEvent('pointermove', { clientX: 300 + dx, clientY: 400 + dy, bubbles: true }));
    window.dispatchEvent(new MouseEvent('pointerup', { bubbles: true }));
  });
};

const shell = (extra: Partial<Parameters<typeof KitShell>[0]> = {}) => {
  const { storage, map } = memStorage();
  const r = render(
    <KitShell config={CONFIG} data={DATA} win={fakeWin()} storage={createSafeStorage(() => storage)} narrow={false} {...extra}>
      <p>содержимое</p>
    </KitShell>,
  );
  return { ...r, map };
};

const body = () => document.querySelector('.sk-shell__body') as HTMLElement;
const sideBorder = () => screen.queryByRole('separator', { name: /Ширина меню/ });

describe('S4-30 · граница левого меню подключена к оболочке', () => {
  it('положительный контроль: у раскрытого меню граница есть', () => {
    shell();
    expect(sideBorder()).toBeTruthy();
  });

  it('потянули — применённая ширина колонки изменилась', () => {
    shell();
    // До перетаскивания переменной нет: работает умолчание из seidr.css, и
    // «не трогали» отличается от «поставили ровно 232».
    expect(body().style.getPropertyValue('--side-w')).toBe('232px');
    drag(sideBorder() as HTMLElement, 40);
    expect(body().style.getPropertyValue('--side-w')).toBe('272px');
  });

  it('ширина переживает перезагрузку — она личная, как ширина колонки', () => {
    const { storage, map } = memStorage();
    const first = render(
      <KitShell config={CONFIG} data={DATA} win={fakeWin()} storage={createSafeStorage(() => storage)} narrow={false}><p>a</p></KitShell>,
    );
    drag(screen.getByRole('separator', { name: /Ширина меню/ }), 50);
    expect([...map.values()].join('')).toContain('282');
    first.unmount();
    render(
      <KitShell config={CONFIG} data={DATA} win={fakeWin()} storage={createSafeStorage(() => storage)} narrow={false}><p>a</p></KitShell>,
    );
    expect(body().style.getPropertyValue('--side-w')).toBe('282px');
  });

  it('в адрес ширина НЕ уходит: ссылка общая, ширина личная', () => {
    const win = fakeWin();
    const { storage } = memStorage();
    render(
      <KitShell config={CONFIG} data={DATA} win={win} storage={createSafeStorage(() => storage)} narrow={false}><p>a</p></KitShell>,
    );
    drag(screen.getByRole('separator', { name: /Ширина меню/ }), 40);
    expect(win.location.search).not.toContain('side');
  });

  it('ПОТЯНУЛИ УЗКО — меню стало рейкой иконок: состояние достигается рукой', () => {
    // Владелица 09.11.2026: «ни разу не получилось получить мини бар», и
    // позже: «не только при полном развороте — это промежуточное состояние
    // resizable состояния». Рейка была объявлена в переключателе и
    // недостижима рукой; теперь она — среднее положение той же границы.
    shell();
    drag(sideBorder() as HTMLElement, -160);
    expect(document.querySelector('.sk-shell--menu-rail')).toBeTruthy();
  });

  it('потянули ещё узже — меню ушло в ушко', () => {
    shell();
    drag(sideBorder() as HTMLElement, -230);
    expect(document.querySelector('.sk-shell--menu-collapsed')).toBeTruthy();
  });

  it('из рейки тянем обратно — меню раскрывается, и подписи возвращаются', () => {
    const { storage } = memStorage();
    storage.setItem('seidr-kit.menuMode', 'rail');
    render(
      <KitShell config={CONFIG} data={DATA} win={fakeWin()} storage={createSafeStorage(() => storage)} narrow={false}><p>a</p></KitShell>,
    );
    // В рейке граница ЕСТЬ — иначе из неё не выбраться мышью.
    const el = screen.getByRole('separator', { name: /Ширина меню/ });
    drag(el, 200);
    expect(document.querySelector('.sk-shell--menu-rail')).toBeNull();
    expect(screen.getByRole('link', { name: /Спринты/ })).toBeTruthy();
  });

  it('меню убрано в ушко — границы нет', () => {
    const { storage } = memStorage();
    storage.setItem('seidr-kit.menuMode', 'hidden');
    render(
      <KitShell config={CONFIG} data={DATA} win={fakeWin()} storage={createSafeStorage(() => storage)} narrow={false}><p>a</p></KitShell>,
    );
    expect(sideBorder()).toBeNull();
  });

  it('на телефоне границы нет: меню там выезжает листом, а не стоит колонкой', () => {
    shell({ narrow: true });
    expect(sideBorder()).toBeNull();
  });
});

describe('S4-30 · граница правой колонки свойств подключена к записи', () => {
  const record = (extra: Partial<Parameters<typeof RecordView>[0]> = {}) => render(
    <RecordView record={RECORD} ctx={CTX} tab="overview" onTab={() => {}} placement="bottom" defaultPropsOpen {...extra} />,
  );
  const propsBorder = () => screen.queryByRole('separator', { name: /Ширина колонки свойств/ });

  it('положительный контроль: колонка свойств открыта и у неё есть граница', () => {
    record();
    expect(document.querySelector('.sk-rec__props')).toBeTruthy();
    expect(propsBorder()).toBeTruthy();
  });

  it('потянули влево — колонка свойств стала шире', () => {
    record();
    const grid = document.querySelector('.sk-rec__body') as HTMLElement;
    // Граница слева от колонки: курсор влево (dx < 0) расширяет колонку.
    drag(propsBorder() as HTMLElement, -40);
    expect(grid.style.getPropertyValue('--props-w')).toBe('320px');
  });

  it('свойства свёрнуты — границы нет: колонки нет', () => {
    record({ defaultPropsOpen: false });
    expect(propsBorder()).toBeNull();
  });
});

describe('S4-30 · граница дока: список и паспорт делят место', () => {
  const dock = (placement: 'right' | 'bottom' | 'full') => render(
    <RecordDock placement={placement} backdrop={<p>список</p>}>
      <p>паспорт</p>
    </RecordDock>,
  );
  const node = () => document.querySelector('.sk-dock') as HTMLElement;

  it('положительный контроль: док справа нарисован, в нём список и паспорт', () => {
    dock('right');
    expect(within(node()).getByText('список')).toBeTruthy();
    expect(within(node()).getByText('паспорт')).toBeTruthy();
  });

  it('панель справа — граница по ширине', () => {
    dock('right');
    const el = screen.getByRole('separator', { name: /Ширина паспорта/ });
    drag(el, -60);
    expect(node().style.getPropertyValue('--dock-panel-w')).toBe('620px');
  });

  // Владелица 11.11.2026: «паспорт сбоку может раздвигаться на две трети
  // экрана». Потолок был числом (1100 px) — на широком экране паспорт
  // упирался задолго до 2/3, на узком позволял съесть почти весь список.
  describe('потолок панели сбоку — две трети окна', () => {
    const was = window.innerWidth;
    const setW = (w: number) => { Object.defineProperty(window, 'innerWidth', { configurable: true, value: w }); };
    afterEach(() => setW(was));

    it('широкое окно: тянется до 2/3 ширины, а не до прежних 1100 px', () => {
      setW(1800);
      dock('right');
      const el = screen.getByRole('separator', { name: /Ширина паспорта/ });
      drag(el, -2000);
      expect(node().style.getPropertyValue('--dock-panel-w')).toBe('1200px');
      expect(el.getAttribute('aria-valuemax')).toBe('1200');
    });

    it('узкое окно: потолок тоже 2/3 — список не исчезает', () => {
      setW(1200);
      dock('right');
      drag(screen.getByRole('separator', { name: /Ширина паспорта/ }), -2000);
      expect(node().style.getPropertyValue('--dock-panel-w')).toBe('800px');
    });

    it('минимум прежний: уже 320 px не сжимается', () => {
      setW(1800);
      dock('right');
      drag(screen.getByRole('separator', { name: /Ширина паспорта/ }), 2000);
      expect(node().style.getPropertyValue('--dock-panel-w')).toBe('320px');
    });

    it('запомненный размер больше 2/3 (окно сузили) — рисуется по потолку', () => {
      setW(900);
      const store = createSafeStorage(() => memStorage().storage);
      writeWidths(store, 'zones', { 'dock.panel.w': 1100 });
      render(<RecordDock placement="right" backdrop={<p>список</p>} widthStore={store}><p>паспорт</p></RecordDock>);
      expect(node().style.getPropertyValue('--dock-panel-w')).toBe('600px');
    });
  });

  // Владелица 11.11.2026: «нижняя панель — 1/3 от высоты, если не
  // предопределено контрактом, с ресайзбл линией». Высота окна — как ширина
  // сбоку: пересчёт вместе с окном, потолок 2/3, запомненное — в пределах окна.
  describe('нижняя панель — 1/3 высоты окна, потолок 2/3', () => {
    const was = window.innerHeight;
    const setH = (h: number) => { Object.defineProperty(window, 'innerHeight', { configurable: true, value: h }); };
    // Док без widthStore пишет в localStorage окна, и размер, натянутый одним
    // тестом, стал бы «личным» в следующем.
    beforeEach(() => { try { window.localStorage.clear(); } catch { /* нет хранилища */ } });
    afterEach(() => setH(was));
    const sep = () => screen.getByRole('separator', { name: /Высота паспорта/ });

    it('панель снизу — граница по ВЫСОТЕ, и тянется вверх', () => {
      setH(1260);
      dock('bottom');
      drag(sep(), 0, -70);
      expect(node().style.getPropertyValue('--dock-panel-h')).toBe('490px');
      // Тянули — помечено: размер личный только у того, кто тянул.
      expect(node().getAttribute('data-sized')).toBe('h');
    });

    it('не тянули — высота 1/3 окна, и это НЕ личный размер', () => {
      setH(900);
      dock('bottom');
      expect(node().style.getPropertyValue('--dock-panel-h')).toBe('300px');
      expect(node().getAttribute('data-sized')).toBeNull();
    });

    it('приложение задало свою высоту (контракт) — она вместо 1/3', () => {
      setH(900);
      render(<RecordDock placement="bottom" backdrop={<p>список</p>} bottomHeight={500}><p>паспорт</p></RecordDock>);
      expect(node().style.getPropertyValue('--dock-panel-h')).toBe('500px');
    });

    it('потолок — 2/3 высоты окна, а не прежние 900 px', () => {
      setH(1800);
      dock('bottom');
      drag(sep(), 0, -3000);
      expect(node().style.getPropertyValue('--dock-panel-h')).toBe('1200px');
      expect(sep().getAttribute('aria-valuemax')).toBe('1200');
    });

    it('окно изменилось — умолчание и потолок пересчитаны', () => {
      setH(900);
      dock('bottom');
      act(() => { setH(1200); window.dispatchEvent(new Event('resize')); });
      expect(node().style.getPropertyValue('--dock-panel-h')).toBe('400px');
      expect(sep().getAttribute('aria-valuemax')).toBe('800');
    });

    it('запомненная высота больше 2/3 (окно уменьшили) — рисуется по потолку', () => {
      setH(600);
      const store = createSafeStorage(() => memStorage().storage);
      writeWidths(store, 'zones', { 'dock.panel.h': 900 });
      render(<RecordDock placement="bottom" backdrop={<p>список</p>} widthStore={store}><p>паспорт</p></RecordDock>);
      expect(node().style.getPropertyValue('--dock-panel-h')).toBe('400px');
      expect(node().getAttribute('data-sized')).toBe('h');
    });
  });

  it('во весь экран границы нет — делить место не с кем', () => {
    dock('full');
    expect(screen.queryByRole('separator')).toBeNull();
  });
});
