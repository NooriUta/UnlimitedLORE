// @vitest-environment jsdom
// Рейка меню: «Недавние» и «Мои виды» — КНОПКА С МЕНЮ, а не куча значков;
// закреплённая группа стоит выше личных блоков
// (SPRINT_UXR_S4_UI_SHELL_LISTS/S4-MENU-STATES).
//
// Слова владелицы 09.11.2026 с прода, дословно: «и новости должны стоять до
// моих видов и недавних и при сворачивании левого меню. недавние должны быть
// кнопкой с меню, а не кучей непонятных значков».
//
// ПОЧЕМУ ЭТО ДЕФЕКТ, А НЕ ПОЖЕЛАНИЕ. В рейке подписи скрыты одним общим
// правилом, и список недавних превращался в столбик одинаковых значков: пять
// записей выглядят как пять одинаковых кнопок, и выбрать из них нельзя —
// возможность формально есть, пользоваться ею нечем. Поэтому в рейке список
// становится одной кнопкой, а записи показываются с НАЗВАНИЯМИ в меню.
//
// Второе: порядок. «Новости» — первая группа меню, но личные блоки («Мои
// виды», «Недавние») рисовались выше всех групп, и до новостей надо было
// проскроллить личное. Порядок называет приложение (`pinTop` у группы) — kit
// не знает, что «новости» важнее: предметных имён в нём нет (K-14).
import { beforeAll, describe, expect, it } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
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
      // Приложение само говорит, что эта группа идёт выше личных блоков.
      { id: 'feed', title: 'Новости', tone: 'inf', pinTop: true, items: [{ id: 'news', title: 'Новости', icon: 'lucide:megaphone', view: 'feed' }] },
      { id: 'work', title: 'Работа', tone: 'acc', items: [{ id: 'sprints', title: 'Спринты', icon: 'sprint', view: 'list' }] },
    ],
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

/** Хранилище на карте — то же, что переживает перезагрузку. */
function memStorage(initial: Record<string, string> = {}) {
  const m = new Map(Object.entries(initial));
  const s = {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => { m.set(k, v); },
    removeItem: (k: string) => { m.delete(k); },
  } as unknown as Storage;
  return { storage: s, map: m };
}

const show = (storageInit: Record<string, string> = {}) => {
  const { storage } = memStorage(storageInit);
  return render(
    <KitShell
      config={CONFIG} data={DATA} win={fakeWin()} narrow={false}
      storage={createSafeStorage(() => storage)}
      recordHref={id => `/rec/${id}`}
    ><p>содержимое</p></KitShell>,
  );
};

/** Меню в колонке (не drawer): его и смотрим. */
const sideNav = () => document.querySelector('.sk-shell__side-nav') as HTMLElement;
/** Заголовки блоков и групп по порядку, как их видит человек сверху вниз. */
const blocksOrder = () => [...sideNav().querySelectorAll('.sk-shell__grp-title')].map(h => h.textContent?.replace(/\s+/g, ' ').trim());

const RAIL = { 'seidr-kit.menuMode': 'rail' };
const RECENT = { 'seidr-kit.recent': JSON.stringify(['SPRINT_A', 'SPRINT_B']) };

describe('S4-MENU-STATES · порядок блоков меню', () => {
  it('положительный контроль: в раскрытом меню видны и личные блоки, и группы', () => {
    show();
    expect(blocksOrder()).toContain('Новости');
    expect(blocksOrder()).toContain('Мои виды');
    expect(blocksOrder()).toContain('Недавние');
  });

  it('закреплённая группа стоит ВЫШЕ «Моих видов» и «Недавних»', () => {
    show();
    const order = blocksOrder();
    expect(order.indexOf('Новости')).toBeLessThan(order.indexOf('Мои виды'));
    expect(order.indexOf('Новости')).toBeLessThan(order.indexOf('Недавние'));
    // Незакреплённая группа остаётся ниже личных блоков — порядок не перевёрнут
    // целиком, поднимается только то, что приложение закрепило.
    expect(order.indexOf('Работа')).toBeGreaterThan(order.indexOf('Недавние'));
  });

  it('в рейке закреплённая группа тоже первая', () => {
    show(RAIL);
    const first = sideNav().querySelector('a, button');
    expect(first?.getAttribute('aria-label') ?? first?.textContent).toMatch(/Новости/);
  });
});

describe('S4-MENU-STATES · в рейке «Недавние» — кнопка с меню, а не столбик значков', () => {
  it('положительный контроль: в раскрытом меню «Недавние» — список со названиями', () => {
    show(RECENT);
    const nav = sideNav();
    expect(within(nav).getByRole('link', { name: /Спринт А/ })).toBeTruthy();
    expect(within(nav).getByRole('link', { name: /Спринт Б/ })).toBeTruthy();
  });

  it('в рейке список свёрнут в ОДНУ кнопку', () => {
    show({ ...RAIL, ...RECENT });
    const nav = sideNav();
    // Ни одной записи списком — иначе это та самая «куча непонятных значков».
    expect(within(nav).queryByRole('link', { name: /Спринт А/ })).toBeNull();
    expect(within(nav).getByRole('button', { name: /Недавние/ })).toBeTruthy();
  });

  it('кнопка открывает меню, и записи в нём — С НАЗВАНИЯМИ', () => {
    show({ ...RAIL, ...RECENT });
    act(() => { screen.getByRole('button', { name: /Недавние/ }).click(); });
    const pop = screen.getByRole('group', { name: /Недавние/ });
    // Внутри ССЫЛКИ, а не пункты меню: их можно открыть в новой вкладке, и
    // объявлять их пунктами меню значило бы соврать о том, что это за элемент.
    expect(within(pop).getByRole('link', { name: /Спринт А/ })).toBeTruthy();
    expect(within(pop).getByRole('link', { name: /Спринт Б/ })).toBeTruthy();
  });

  it('меню закрывается Esc — иначе оно ловит клавиатуру', () => {
    show({ ...RAIL, ...RECENT });
    const btn = screen.getByRole('button', { name: /Недавние/ });
    act(() => { btn.click(); });
    fireEvent.keyDown(screen.getByRole('group', { name: /Недавние/ }), { key: 'Escape' });
    expect(screen.queryByRole('group', { name: /Недавние/ })).toBeNull();
    expect(btn.getAttribute('aria-expanded')).toBe('false');
  });

  it('недавних нет — меню говорит это словами, а не открывается пустым', () => {
    show(RAIL);
    act(() => { screen.getByRole('button', { name: /Недавние/ }).click(); });
    expect(within(screen.getByRole('group', { name: /Недавние/ })).getByText(/Пока пусто/i)).toBeTruthy();
  });

  it('«Мои виды» в рейке — тем же механизмом: кнопка с меню', () => {
    // Та же «куча значков» была и у видов; лечим одним приёмом, а не двумя.
    show(RAIL);
    expect(screen.getByRole('button', { name: /Мои виды/ })).toBeTruthy();
    act(() => { screen.getByRole('button', { name: /Мои виды/ }).click(); });
    expect(screen.getByRole('group', { name: /Мои виды/ })).toBeTruthy();
  });
});
