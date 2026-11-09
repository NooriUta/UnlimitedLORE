// Сторож раскладки: в сетке, где хоть один ребёнок размещён ЯВНО, клетки
// обязаны быть названы у всех (урок прода 09.11.2026).
//
// ЧТО СЛУЧИЛОСЬ. В v1.17.7 владелица написала: «как минимум левое меню глючит
// и разворачивается во всю стену». Причина — моя правка S4-30: ручка границы
// (`.sk-shell__resize`) получила явные `grid-row: 1; grid-column: 1`, то есть
// ту же клетку, где стоит меню. CSS Grid размещает явно размещённые элементы
// первыми, а остальных расставляет автоматически, ОБХОДЯ занятые клетки:
// колонка меню уехала в колонку 2 (1fr — во всю ширину), а содержимое — во
// второй ряд. Ровно то, что видно глазами как «меню во всю стену».
//
// ПОЧЕМУ ЭТОГО НЕ ПОЙМАЛИ ТЕСТЫ. jsdom не считает раскладку: ни ширин, ни
// клеток сетки. Все 1828 тестов kit были зелёными, и правило «проверяй в
// браузере то, что видно глазами» здесь стоило прода. Поэтому сторож ниже
// читает САМ CSS — он ловит не вид, а условие, при котором вид ломается.
//
// Правило: как только в сетке появился ребёнок с явной клеткой, остальные
// дети той же сетки обязаны иметь свою. Иначе автоматическое размещение
// обойдёт занятую клетку и переставит блоки молча.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const css = readFileSync(`${process.cwd()}/src/styles/seidr.css`, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

/** Тело правила по точному селектору (или пустая строка). */
function ruleOf(selector: string): string {
  const re = new RegExp(`(?:^|[,}])\\s*${selector.replace(/[.[\]*+?^${}()|\\]/g, '\\$&')}\\s*\\{([^{}]*)\\}`, 'm');
  return re.exec(css)?.[1] ?? '';
}

const placed = (body: string): boolean =>
  /grid-area\s*:/.test(body) || (/grid-row\s*:/.test(body) && /grid-column\s*:/.test(body));

/**
 * Сетки с ручкой границы и их дети. Перечислено явно: автоматический разбор
 * «кто чей ребёнок» по CSS невозможен — родство задаёт разметка.
 */
const GRIDS: readonly { grid: string; children: readonly string[] }[] = [
  {
    // Та сетка, на которой дефект и вылез: «левое меню во всю стену». Клетки у
    // колонки и содержимого расставила сессия релиза (её Playwright-тест
    // web-next/e2e/shell-layout.spec.ts ловит ВИД, этот сторож — условие).
    grid: '.sk-shell__body',
    children: ['.sk-shell__side', '.sk-shell__main', '.sk-shell__resize'],
  },
  {
    grid: '.sk-rec__body',
    children: ['.sk-rec__content', '.sk-rec__props', '.sk-rec__resize'],
  },
  {
    grid: ".sk-dock[data-placement='right']",
    children: [
      ".sk-dock[data-placement='right'] .sk-dock__backdrop",
      ".sk-dock[data-placement='right'] .sk-dock__panel",
      ".sk-dock[data-placement='right'] .sk-dock__resize",
    ],
  },
  {
    grid: ".sk-dock[data-placement='bottom']",
    children: [
      ".sk-dock[data-placement='bottom'] .sk-dock__backdrop",
      ".sk-dock[data-placement='bottom'] .sk-dock__panel",
      ".sk-dock[data-placement='bottom'] .sk-dock__resize",
    ],
  },
];

describe('раскладка сеток с ручкой границы (урок прода 09.11.2026)', () => {
  it('положительный контроль: разбор CSS находит правила и видит явные клетки', () => {
    expect(ruleOf('.sk-rec__body')).toMatch(/display:\s*grid/);
    expect(placed(ruleOf('.sk-rec__resize'))).toBe(true);
    expect(placed('min-width: 0')).toBe(false);
  });

  it.each(GRIDS)('$grid — клетки названы у ВСЕХ детей, иначе блоки переставятся молча', ({ children }) => {
    const missing = children.filter(sel => !placed(ruleOf(sel)));
    expect(
      missing,
      `в этой сетке есть ребёнок с явной клеткой, значит клетка нужна каждому — иначе автоматическое размещение обойдёт занятую и переставит блоки (прод 09.11: «меню во всю стену»). Без клетки: ${missing.join(', ')}`,
    ).toEqual([]);
  });
});
