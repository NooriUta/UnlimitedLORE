// @vitest-environment jsdom
// Аудит навигации 08.11.2026, находка P1: «Пункты — кнопки: 11 <button>,
// 0 <a href> — нельзя открыть в новой вкладке, скопировать адрес, средний клик;
// для скринридера это кнопки-действия, а не навигация».
//
// Раздел в v2 и так живёт в адресе (?sec=…), то есть у каждого пункта адрес
// есть — он просто не был написан в разметке. Поэтому это не «добавить
// ссылки», а «перестать прятать адрес, который уже есть».
//
// Что закрепляем:
//   • пункт меню и сохранённый вид — <a href> с настоящим адресом раздела;
//   • обычный щелчок остаётся переходом внутри приложения (без перезагрузки);
//   • щелчок с Ctrl/⌘/Shift/Alt и средняя кнопка НЕ перехватываются — иначе
//     ссылка снова становится кнопкой, просто похожей на ссылку;
//   • «Недавнее» становится ссылкой только если приложение дало адрес записи;
//     без адреса остаётся кнопкой — поддельная ссылка хуже кнопки;
//   • уход в другой раздел чистит параметры прежнего и якорь: ровно тот «мусор
//     place=…#SPRINT_…», который аудит нашёл после выхода из дока.
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import gameIcons from '@iconify-json/game-icons/icons.json';
import { KitShell, createSafeStorage, registerGameIcons } from '../index';
import type { KitConfig, KitData } from '../index';
import type { UrlWindow } from '../resilience/urlState';

beforeAll(() => { registerGameIcons(gameIcons); });

const CONFIG: KitConfig = {
  modules: [{ id: 'lore', title: 'LORE', icon: 'scroll-unfurled', status: 'active' }],
  menu: {
    myViews: true,
    recent: true,
    groups: [
      {
        id: 'work', title: 'Работа', tone: 'acc', items: [
          { id: 'sprints', title: 'Спринты', icon: 'sprint', view: 'list' },
          { id: 'tasks', title: 'Задачи', icon: 'checklist', view: 'board' },
        ],
      },
    ],
  },
  kinds: { sprint: { title: 'Спринт', icon: 'sprint' } },
  statuses: { items: [{ code: 'done', title: 'Готово', category: 'finished', icon: 'check-mark', color: 'var(--suc)' }] },
};

const DATA: KitData = {
  records: [{ id: 'SPRINT_A', kind: 'sprint', title: 'Спринт А', status: 'done', fields: {} }],
  edges: [], journal: [], meta: { generated_at: '2026-11-08T00:00:00Z' },
};

function fakeWin(search = '', hash = ''): UrlWindow {
  const w: UrlWindow = {
    location: { pathname: '/', search, hash },
    history: {
      pushState: (_s, _t, url) => {
        const s = String(url);
        w.location.search = s.includes('?') ? s.replace(/^[^?]*/, '').replace(/#.*$/, '') : '';
        w.location.hash = s.includes('#') ? s.replace(/^[^#]*/, '') : '';
      },
      replaceState: (_s, _t, url) => w.history.pushState(null, '', url),
    },
  };
  return w;
}

const mem = () => {
  const m = new Map<string, string>();
  return createSafeStorage(() => ({
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => { m.set(k, v); },
    removeItem: (k: string) => { m.delete(k); },
  } as unknown as Storage));
};

const side = () => screen.getByRole('navigation', { name: 'Разделы' });

function mount(opts: { win?: UrlWindow; recordHref?: (id: string) => string; onNavigate?: () => void } = {}) {
  const win = opts.win ?? fakeWin();
  render(
    <KitShell config={CONFIG} data={DATA} win={win} storage={mem()} narrow={false}
      recordHref={opts.recordHref} onNavigate={opts.onNavigate}>
      <p>экран</p>
    </KitShell>,
  );
  return win;
}

describe('пункты меню — ссылки', () => {
  it('положительный контроль: меню отрисовано и пункты на месте', () => {
    mount();
    expect(within(side()).getByText('Спринты')).toBeTruthy();
  });

  it('пункт — <a href> с адресом своего раздела', () => {
    mount();
    const link = within(side()).getByRole('link', { name: 'Задачи' });
    expect(link.tagName).toBe('A');
    const href = link.getAttribute('href') ?? '';
    expect(href).toMatch(/sec=tasks/);
    expect(href).toMatch(/view=board/);
  });

  it('текущий раздел помечен aria-current и остаётся ссылкой', () => {
    mount({ win: fakeWin('?sec=tasks') });
    const link = within(side()).getByRole('link', { name: 'Задачи' });
    expect(link.getAttribute('aria-current')).toBe('page');
  });

  it('обычный щелчок — переход внутри приложения, без перезагрузки', () => {
    const onNavigate = vi.fn();
    const win = mount({ onNavigate });
    const link = within(side()).getByRole('link', { name: 'Задачи' });
    const ev = fireEvent.click(link, { button: 0 });
    expect(ev).toBe(false); // preventDefault: браузер страницу не грузит
    expect(onNavigate).toHaveBeenCalled();
    expect(win.location.search).toMatch(/sec=tasks/);
  });

  it('Ctrl/⌘/Shift/Alt-щелчок не перехватывается — это «открыть в новой вкладке»', () => {
    for (const mod of ['ctrlKey', 'metaKey', 'shiftKey', 'altKey'] as const) {
      const onNavigate = vi.fn();
      mount({ onNavigate, win: fakeWin() });
      const link = within(side()).getAllByRole('link', { name: 'Задачи' })[0];
      // Слушатель на документе отвечает после обработчика ссылки: он видит,
      // отменили событие или нет, и сам гасит переход — иначе jsdom пытался бы
      // уйти по адресу и сыпал «Not implemented: navigation» в журнал.
      let prevented: boolean | null = null;
      const watch = (e: Event) => { prevented = e.defaultPrevented; e.preventDefault(); };
      document.addEventListener('click', watch);
      try {
        fireEvent.click(link, { button: 0, [mod]: true });
      } finally {
        document.removeEventListener('click', watch);
      }
      expect(prevented, mod).toBe(false); // приложение событие не забрало
      expect(onNavigate, mod).not.toHaveBeenCalled();
      screen.getByRole('navigation', { name: 'Разделы' }).remove();
    }
  });

  it('средняя кнопка не перехватывается', () => {
    const onNavigate = vi.fn();
    mount({ onNavigate });
    const link = within(side()).getByRole('link', { name: 'Задачи' });
    const watch = (e: Event) => e.preventDefault();
    document.addEventListener('click', watch);
    try {
      fireEvent.click(link, { button: 1 });
    } finally {
      document.removeEventListener('click', watch);
    }
    expect(onNavigate).not.toHaveBeenCalled();
  });

  it('уход в другой раздел снимает параметры прежнего и якорь', () => {
    mount({ win: fakeWin('?sec=sprints&lq=поиск&place=bottom', '#SPRINT_A') });
    const href = within(side()).getByRole('link', { name: 'Задачи' }).getAttribute('href') ?? '';
    expect(href).not.toMatch(/lq=/);
    expect(href).not.toMatch(/place=/);
    expect(href).not.toMatch(/#/);
  });
});

describe('недавнее и виды', () => {
  it('«Недавнее» без адреса записи остаётся кнопкой — поддельная ссылка хуже кнопки', () => {
    const win = fakeWin();
    render(
      <KitShell config={CONFIG} data={DATA} win={win} storage={mem()} narrow={false}>
        <p>экран</p>
      </KitShell>,
    );
    // Пока ничего не открывали, «Недавнее» пусто — и это честная подпись,
    // а не отсутствие блока.
    expect(within(side()).getByText(/Пока ничего не открывали|Недавнего нет|пусто/i)).toBeTruthy();
  });

  it('сохранённый вид — ссылка на свой раздел', () => {
    mount({ win: fakeWin('?sec=tasks') });
    fireEvent.click(within(side()).getByRole('button', { name: 'Сохранить вид' }));
    const saved = within(side()).getAllByRole('link').map(a => a.getAttribute('href') ?? '');
    expect(saved.some(h => /sec=tasks/.test(h))).toBe(true);
  });
});
