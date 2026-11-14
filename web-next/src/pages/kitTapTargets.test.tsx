// @vitest-environment jsdom
// SPRINT_UXR_S13_KIT4/K4-PHONE-TAP-TARGETS — цели касания на витрине /kit.
//
// Приёмка 14.11 (препрод, 300 px, pointer:coarse) насчитала ≈70 кнопок, пилюль и
// вкладок высотой 14–24 px. Это ВИДИМЫЙ размер, и он по решению владелицы
// D-2026-UXR-MOBILE-FOLLOWS-V1 и должен оставаться плотным: --tap = 0 везде, а
// 44 px на сенсоре даёт НЕВИДИМАЯ зона ::after (--hit). Замер зоны в браузере
// (Playwright, 300 px, coarse) показал, у кого её нет на самом деле: у ссылок без
// kit-класса — «Вернуться в LORE» (11 px) и навигация разделов витрины (24 px).
// Общая зона доставалась только ссылкам с классом sk-*, а ссылка-элемент
// приложения (свой класс) оставалась без неё.
//
// Здесь — тот же приём, что в shellLists.a11y (S4-12), но по правилу, которое
// действует сейчас: у КАЖДОГО интерактивного элемента витрины на сенсоре есть
// цель ≥ 44 px — зона ::after из seidr.css, правило высоты var(--hit) или
// подпись-цель с чекбоксом. Исключение одно и названное: ссылка внутри прозы
// MD (там цель — строка текста; зона ловила бы касания соседних строк).
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import gameIcons from '@iconify-json/game-icons/icons.json';
import { registerGameIcons } from '@seidr/kit';

vi.mock('mermaid', () => ({
  default: {
    registerLayoutLoaders: vi.fn(),
    initialize: vi.fn(),
    render: vi.fn(async (id: string) => ({ svg: `<svg id="${id}" role="img" aria-label="diagram"><text>d</text></svg>` })),
  },
}));
vi.mock('bpmn-js/lib/NavigatedViewer', () => ({
  default: class {
    importXML() { return Promise.resolve(); }
    get() { return { zoom: () => {} }; }
    destroy() {}
  },
}));

import KitPage from './KitPage';
import { OutsideShell } from './OutsideShell';

if (typeof HTMLCanvasElement !== 'undefined') {
  HTMLCanvasElement.prototype.getContext = (() => null) as typeof HTMLCanvasElement.prototype.getContext;
}

beforeAll(() => {
  registerGameIcons(gameIcons);
});

const require = createRequire(import.meta.url);
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '');
const seidrCss = strip(readFileSync(require.resolve('@seidr/kit/styles/seidr.css'), 'utf8'));
const appCss = ['./KitPage.css', './OutsideShell.css']
  .map(p => strip(readFileSync(new URL(p, import.meta.url), 'utf8'))).join('\n');

/** Тела блоков @media, условие которых включает (pointer: coarse) без ограничения ширины/высоты. */
function coarseBodies(css: string): string {
  const out: string[] = [];
  const re = /@media\s*([^{]+)\{/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(css))) {
    const cond = m[1].trim();
    let depth = 1, j = re.lastIndex;
    while (depth && j < css.length) { if (css[j] === '{') depth++; else if (css[j] === '}') depth--; j++; }
    if (cond.split(',').some(c => c.trim() === '(pointer: coarse)')) out.push(css.slice(re.lastIndex, j - 1));
    re.lastIndex = j;
  }
  return out.join('\n');
}

interface Rule { selectors: string[]; body: string }
function rules(css: string): Rule[] {
  return [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(r => ({
    selectors: r[1].split(/,(?![^(]*\))/).map(s => s.trim().replace(/\s+/g, ' ')).filter(Boolean),
    body: r[2],
  }));
}

const COARSE = rules(coarseBodies(seidrCss) + '\n' + coarseBodies(appCss));

/** Селекторы, которым общая зона ::after даёт ≥ --hit (правило с width/height max(100%, var(--hit))). */
const ZONE = COARSE
  .filter(r => /height:\s*max\(100%,\s*var\(--hit\)\)/.test(r.body) && /content:\s*''/.test(r.body))
  .flatMap(r => r.selectors.filter(s => s.endsWith('::after')).map(s => s.slice(0, -'::after'.length)));

/** Где зону сняли нарочно (content: none) — проза: строка текста сама цель. */
const ZONE_OFF = COARSE
  .filter(r => /content:\s*none/.test(r.body))
  .flatMap(r => r.selectors.filter(s => s.endsWith('::after')).map(s => s.slice(0, -'::after'.length)));

/** Правила высоты под палец: min-height/height var(--hit). */
const HIT_HEIGHT = COARSE
  .filter(r => /(?:^|[\s;])(?:min-)?height\s*:\s*var\(--hit\)/.test(r.body))
  .flatMap(r => r.selectors);

/** Подпись-цель для чекбокса: селекторы `…:has(> input[type='checkbox'], …)` без :has. */
const LABEL_HIT = HIT_HEIGHT
  .filter(s => /:has\(> input\[type='checkbox'\]/.test(s))
  .map(s => s.replace(/:has\((?:[^()]|\([^()]*\))*\)/, ''));

const matchesAny =(el: Element, sels: string[]) => sels.some(s => { try { return el.matches(s); } catch { return false; } });

function hasTouchTarget(el: Element): boolean {
  if (matchesAny(el, HIT_HEIGHT)) return true;
  // Чекбокс/радио прямо в подписи — цель вся подпись (правило `label:has(> input…)`).
  // :has jsdom не разбирает, поэтому условие «input — прямой ребёнок» проверяем сами.
  const label = el.matches("input[type='checkbox'], input[type='radio']") && el.parentElement?.matches('label') ? el.parentElement : null;
  if (label && matchesAny(label, LABEL_HIT)) return true;
  return matchesAny(el, ZONE) && !matchesAny(el, ZONE_OFF);
}

/** Ссылка в прозе MD — цель касания строка текста (исключение, названное в шапке). */
const inProse = (el: Element) => el.matches('a[href]') && !!el.closest('.sk-prose, .sk-md__doc');

const INTERACTIVE = [
  'a[href]', 'button', 'input:not([type="hidden"])', 'select', 'summary',
  '[role="button"]', '[role="tab"]', '[role="option"]', '[role="menuitem"]', '[role="radio"]', '[role="checkbox"]',
].join(', ');

function describeEl(el: Element): string {
  const cls = el.getAttribute('class') ?? '';
  const name = el.getAttribute('aria-label') ?? el.textContent?.trim().slice(0, 30) ?? '';
  return `<${el.tagName.toLowerCase()} class="${cls}"> «${name}»`;
}

describe('K4-PHONE-TAP-TARGETS · у каждого элемента витрины /kit на сенсоре цель ≥ 44 px', () => {
  it('разбор CSS не слепой: зона ::after, её снятие в прозе и высота поля под палец найдены', () => {
    expect(ZONE.length).toBeGreaterThan(0);
    expect(ZONE_OFF.join(' ')).toMatch(/\.sk-prose a\[href\]/);
    expect(HIT_HEIGHT.length).toBeGreaterThan(0);
    expect(LABEL_HIT.length).toBeGreaterThan(0);
    const btn = document.createElement('button');
    expect(hasTouchTarget(btn)).toBe(true);
    const div = document.createElement('div');
    expect(hasTouchTarget(div)).toBe(false);
  });

  it('ссылка-элемент с классом приложения (не sk-*) тоже получает зону', () => {
    const a = document.createElement('a');
    a.href = '#x';
    a.className = 'app-navlink';
    expect(hasTouchTarget(a)).toBe(true);
  });

  it('витрина целиком: ни одного интерактивного элемента без цели касания', async () => {
    const { container } = render(<><OutsideShell kind="demo" /><KitPage /></>);
    await waitFor(() => expect(container.querySelector('.sk-md__toolbar')).toBeTruthy());
    const all = [...container.querySelectorAll(INTERACTIVE)];
    expect(all.length).toBeGreaterThan(50);
    // Выключенный элемент (флажок чек-листа в чтении MD — disabled) нажать нельзя — не цель.
    const small = [...new Set(all.filter(el => !el.matches(':disabled') && !inProse(el) && !hasTouchTarget(el)).map(describeEl))];
    expect(small).toEqual([]);
  });
});
