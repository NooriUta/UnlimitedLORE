// @vitest-environment jsdom
// Попап рейки целиком в окне (SPRINT_UXR_POLISH_UAT_1113/PU-26).
//
// Слова владелицы 13.11 со скрина: «меню когда свёрнуто значками — попап
// недавних уходит куда-то в непонятное положение» — список обрезан левым
// краем окна и лежит поверх рейки.
//
// ПРИЧИНА. Попап рейки был position:absolute ВНУТРИ колонки меню, а у колонки
// `.sk-shell__side { overflow: auto }`. Абсолютный слой справа от колонки
// шириной 56px уходил в её прокручиваемую область: обрезался краем колонки, а
// когда ловушка фокуса ставила фокус на первую ссылку, браузер прокручивал
// колонку вбок, чтобы показать её, — список уезжал влево, на рейку и за край
// окна. Сдвиг по замеру (--pop-dx) этого не лечит: он считается от окна, а
// режет не окно, а колонка.
//
// ПРАВИЛО (на ВСЕ попапы рейки — «Недавние» и «Мои виды» идут через один
// RailMenu → Popover align="side"): слой рейки — position:fixed по координатам
// значка, справа от него; не влез вправо — переворачивается влево; дальше
// прижимается к краям окна. На телефоне — нижний лист.
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import gameIcons from '@iconify-json/game-icons/icons.json';
import { KitShell, createSafeStorage, registerGameIcons } from '../index';
import type { KitConfig, KitData } from '../index';
import type { UrlWindow } from '../resilience/urlState';
import { Popover } from './Popover';

beforeAll(() => { registerGameIcons(gameIcons); });

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
  records: [{ id: 'SPRINT_A', kind: 'sprint', title: 'Спринт А', status: 'done', fields: {} }],
  edges: [], journal: [], meta: { generated_at: '2026-11-13T00:00:00Z' },
};

function fakeWin(): UrlWindow {
  const w: UrlWindow = {
    location: { pathname: '/kit', search: '', hash: '' },
    history: {
      pushState: (_s, _t, url) => { w.location.search = String(url).replace(/^[^?]*/, ''); },
      replaceState: (_s, _t, url) => { w.location.search = String(url).replace(/^[^?]*/, ''); },
    },
  };
  return w;
}

const show = (mode: 'open' | 'rail' | 'hidden') => {
  const m = new Map<string, string>([
    ['seidr-kit.menuMode', mode],
    ['seidr-kit.recent', JSON.stringify(['SPRINT_A'])],
  ]);
  const storage = {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => { m.set(k, v); },
    removeItem: (k: string) => { m.delete(k); },
  } as unknown as Storage;
  return render(
    <KitShell config={CONFIG} data={DATA} win={fakeWin()} narrow={false}
      storage={createSafeStorage(() => storage)} recordHref={id => `/rec/${id}`}
    ><p>содержимое</p></KitShell>,
  );
};

const POP = { width: 300, height: 200 };
const rect = (left: number, top: number, width: number, height: number) => ({
  x: left, y: top, left, top, width, height, right: left + width, bottom: top + height, toJSON: () => ({}),
}) as DOMRect;

/**
 * Геометрия без раскладки. Значок рейки стоит там, где сказано; слой —
 * там, куда его поставил компонент (--pop-x/--pop-y при position:fixed).
 * Не поставил — он остаётся на месте значка (абсолютный слой в колонке),
 * то есть ровно в той колонке, которая его и режет.
 */
let restore: (() => void) | null = null;
function layout(anchor: { left: number; top: number }, vw: number, vh = 768) {
  const orig = HTMLElement.prototype.getBoundingClientRect;
  const w0 = window.innerWidth;
  const h0 = window.innerHeight;
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: vw });
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: vh });
  HTMLElement.prototype.getBoundingClientRect = function () {
    if (this.classList.contains('sk-shell__railmenu')) return rect(anchor.left, anchor.top, 56, 28);
    if (this.classList.contains('sk-pop')) {
      const x = parseFloat(this.style.getPropertyValue('--pop-x'));
      const y = parseFloat(this.style.getPropertyValue('--pop-y'));
      return rect(Number.isFinite(x) ? x : anchor.left, Number.isFinite(y) ? y : anchor.top, POP.width, POP.height);
    }
    return orig.call(this);
  };
  restore = () => {
    HTMLElement.prototype.getBoundingClientRect = orig;
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: w0 });
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: h0 });
  };
}
afterEach(() => { restore?.(); restore = null; });

/** Где слой окажется на экране: координаты, выставленные компонентом. */
function placed(pop: HTMLElement) {
  const x = parseFloat(pop.style.getPropertyValue('--pop-x'));
  const y = parseFloat(pop.style.getPropertyValue('--pop-y'));
  return { left: x, top: y, right: x + POP.width, bottom: y + POP.height };
}

const openRecent = () => {
  act(() => { screen.getByRole('button', { name: /Недавние/ }).click(); });
  return screen.getByRole('group', { name: /Недавние/ });
};

describe('PU-26 · попап рейки — целиком в окне, справа от значка', () => {
  it('рейка: «Недавние» справа от значка, left ≥ 0 и right ≤ innerWidth', () => {
    layout({ left: 0, top: 300 }, 1024);
    show('rail');
    const p = placed(openRecent());
    expect(p.left).toBeGreaterThanOrEqual(56); // правее значка, не поверх рейки
    expect(p.right).toBeLessThanOrEqual(window.innerWidth);
    expect(p.top).toBe(300);
  });

  it('не влез вправо — переворачивается влево от значка и прижимается к окну', () => {
    layout({ left: 700, top: 300 }, 800);
    show('rail');
    const p = placed(openRecent());
    expect(p.left).toBeGreaterThanOrEqual(0);
    expect(p.right).toBeLessThanOrEqual(700); // слева от значка, а не поверх
  });

  it('узкое окно: и вправо, и влево не влез — прижат к краям, но в окне', () => {
    layout({ left: 0, top: 300 }, 320);
    show('rail');
    const p = placed(openRecent());
    expect(p.left).toBeGreaterThanOrEqual(0);
    expect(p.right).toBeLessThanOrEqual(320);
  });

  it('у нижнего края — поднимается, низ в окне', () => {
    layout({ left: 0, top: 700 }, 1024, 768);
    show('rail');
    const p = placed(openRecent());
    expect(p.top).toBeGreaterThanOrEqual(0);
    expect(p.bottom).toBeLessThanOrEqual(768);
  });

  it('«Мои виды» — то же правило (оно у всех попапов рейки)', () => {
    layout({ left: 0, top: 300 }, 1024);
    show('rail');
    act(() => { screen.getByRole('button', { name: /Мои виды/ }).click(); });
    const p = placed(screen.getByRole('group', { name: /Мои виды/ }));
    expect(p.left).toBeGreaterThanOrEqual(56);
    expect(p.right).toBeLessThanOrEqual(1024);
  });

  it('раскрытое меню и скрытое — попапа нет вовсе (список в колонке / меню убрано)', () => {
    show('open');
    expect(document.querySelector('.sk-pop')).toBeNull();
    expect(screen.queryByRole('button', { name: /Недавние/ })).toBeNull();
  });

  it('скрытое меню — попапа нет', () => {
    show('hidden');
    expect(document.querySelector('.sk-pop')).toBeNull();
  });
});

describe('PU-26 · телефон — нижний лист', () => {
  it('узкий экран: слой рейки — нижним листом, без координат значка', () => {
    const mm = window.matchMedia;
    window.matchMedia = ((q: string) => ({
      matches: true, media: q, addEventListener: () => {}, removeEventListener: () => {},
    })) as unknown as typeof window.matchMedia;
    try {
      render(<div className="sk-shell__railmenu"><Popover align="side" role="group" label="Недавние" onClose={() => {}}><a href="/x">x</a></Popover></div>);
      const pop = screen.getByRole('group', { name: 'Недавние' });
      expect(pop.dataset.sheet).toBe('bottom');
      expect(pop.style.getPropertyValue('--pop-x')).toBe('');
    } finally { window.matchMedia = mm; }
  });
});

describe('PU-26 · сторож CSS: слой рейки не живёт в прокручиваемой колонке', () => {
  const css = readFileSync(resolve(process.cwd(), 'src/styles/seidr.css'), 'utf8');
  it('.sk-pop[data-align=side] — position: fixed по --pop-x/--pop-y', () => {
    const rule = css.match(/\.sk-pop\[data-align='side'\]\s*\{([^}]*)\}/)?.[1] ?? '';
    expect(rule).toMatch(/position:\s*fixed/);
    expect(rule).toMatch(/var\(--pop-x/);
    expect(rule).toMatch(/var\(--pop-y/);
  });
  it('нижний лист на узком экране — правило есть', () => {
    expect(css).toMatch(/\.sk-pop\[data-sheet='bottom'\]/);
  });
});
