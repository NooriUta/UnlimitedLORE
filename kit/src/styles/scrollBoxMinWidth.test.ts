// Ни один экран не шире окна (SPRINT_UXR_S9_SCALE_OPT/S9-12).
//
// ПРИЧИНА, а не симптом. Замер владелицы и соседней сессии на проде v1.17.8:
// при экране 393 px страница прокручивалась боком, уезжали «Группировка»,
// «Порядок» и шапка. Живой замер в браузере 09.11 (web-next/e2e/list-narrow.spec.ts)
// показал два независимых источника:
//
//  1. `.sk-list__scroll` — бокс таблицы с `overflow-x: auto`, но без
//     `min-width: 0`. У элемента внутри flex/grid минимальная ширина равна
//     СОДЕРЖИМОМУ, пока не сказано иначе, поэтому своя полоса прокрутки у бокса
//     не появлялась: вместо неё раздвигалась полоса-родитель.
//  2. `.sk-shell` — сетка без объявленных колонок. Неявная колонка — `auto`,
//     то есть по max-content: таблица на десять колонок растягивала ОБОЛОЧКУ
//     (замер: колонка 692 px при окне 412 px). `minmax(0, 1fr)` запрещает это
//     по построению.
//
// Поэтому правило, а не частный случай (стандарт владелицы: «частный фикс
// обобщать до правила»): бокс с собственной прокруткой в потоке содержимого
// обязан объявить `min-width: 0`, а сетка оболочки — свои колонки.
//
// Почему тест читает CSS, а не браузер: Playwright у нас локальный (решение
// владелицы «тесты локально»), в CI его нет. Живая проверка раскладки — в
// web-next/e2e/list-narrow.spec.ts; этот сторож держит те же правила в CI.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('./seidr.css', import.meta.url), 'utf8');

/** Тело правила по точному селектору (первое вхождение). */
function block(selector: string): string {
  const i = css.indexOf(selector + ' {');
  expect(i, `правила ${selector} в seidr.css нет — поправьте список`).toBeGreaterThan(-1);
  const open = css.indexOf('{', i);
  const close = css.indexOf('}', open);
  return css.slice(open + 1, close);
}

/**
 * Боксы со своей прокруткой В ПОТОКЕ СОДЕРЖИМОГО: они стоят элементами flex или
 * grid, и без min-width: 0 раздвигают страницу. Накладки (popup, sheet, dock,
 * палитра) сюда не входят — они позиционированы и из потока выведены, у них
 * ширину задаёт не содержимое.
 */
const SCROLL_BOXES: readonly [selector: string, why: string][] = [
  ['.sk-list__scroll', 'таблица списка на десять колонок (S9-12, замер 412 px: правый край был 672)'],
  ['.sk-list__chipscroll', 'полоса условий фильтра: листаются чипы, а не управление'],
  ['.sk-tasks__wrap', 'таблица задач спринта — тот же класс, что таблица списка'],
  ['.sk-board', 'доска: колонки статусов листаются боком'],
  ['.sk-news__scroll', 'таблица новостей'],
  ['.sk-read__rail', 'рейка чтения записи'],
  ['.sk-read__full-body', 'тело записи во весь экран (широкие таблицы в разметке)'],
  ['.sk-mdedit__live', 'живой просмотр MD рядом с исходником'],
  ['.sk-shell__main', 'область содержимого оболочки'],
  ['.sk-shell__mods', 'полоса модулей в шапке'],
  ['.sk-matrix__scroll', 'матрица «ось × ось»: колонок столько, сколько у приложения (K2-MATRIX)'],
];

describe('S9-12 · страница не шире окна: правила, которые это держат', () => {
  it('положительный контроль: seidr.css прочитан и в нём есть разбираемые правила', () => {
    expect(css.length).toBeGreaterThan(10_000);
    expect(css).toContain('.sk-list__scroll {');
  });

  it.each(SCROLL_BOXES)('%s объявляет min-width: 0 — %s', (selector) => {
    const body = block(selector);
    expect(/overflow(-x)?:\s*(auto|scroll)/.test(body), `${selector}: в правиле нет прокрутки — список устарел`).toBe(true);
    expect(/min-width:\s*0/.test(body), `${selector}: прокрутка есть, а min-width: 0 нет — бокс раздвинет полосу вместо себя`).toBe(true);
  });

  it('оболочка объявляет свою колонку: minmax(0, …), а не неявную auto', () => {
    const body = block('.sk-shell');
    const m = body.match(/grid-template-columns:\s*([^;]+);/);
    expect(m, '.sk-shell: колонки не объявлены — неявная колонка auto растянется по max-content').not.toBeNull();
    expect(m![1]).toMatch(/minmax\(\s*0/);
  });

  it('строка оболочки (меню + содержимое) не растягивается содержимым', () => {
    const body = block('.sk-shell__body');
    expect(/min-width:\s*0/.test(body), '.sk-shell__body: без min-width: 0 таблица снова распирает строку').toBe(true);
    expect(body).toMatch(/grid-template-columns:[^;]*minmax\(\s*0/);
  });
});

// Полосы прокрутки — в теме, а не системные (просьба владелицы 10.11.2026:
// «ползунки скролов сделай что бы в тему попадали а не выглядели инородно»).
//
// Системная полоса рисуется цветами ОС: в тёмной теме Seiðr она светло-серая
// и режет глаз, в светлой — наоборот. Два механизма нужны оба: scrollbar-color
// понимают Firefox и новые Chromium, псевдоэлементы webkit — Safari и старые
// Chromium; один без другого оставит половину браузеров с чужой полосой.
describe('Полосы прокрутки одеты темой', () => {
  it('цвет ползунка — токеном темы, а не системный', () => {
    expect(css).toMatch(/scrollbar-color:\s*var\(--bd\)/);
  });

  it('есть и webkit-механизм: Safari и старые Chromium понимают только его', () => {
    expect(css).toMatch(/::-webkit-scrollbar-thumb\s*\{[^}]*var\(--bd\)/);
  });

  it('дорожка прозрачная: своя подложка спорила бы с фоном блока', () => {
    expect(css).toMatch(/::-webkit-scrollbar-track\s*\{[^}]*transparent/);
  });

  it('боксы, которые прячут полосу намеренно, не задеты', () => {
    expect(css).toMatch(/\.sk-news__frow[^}]*scrollbar-width:\s*none/);
  });
});
