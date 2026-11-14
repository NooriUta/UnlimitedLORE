// Приёмка препрода efe20f03: невидимые зоны касания 44 px (::after, D-2026-UXR-MOBILE-FOLLOWS-V1,
// K4-PHONE-TAP-TARGETS) у соседних РЯДОВ пилюль перекрывались: пилюля 20 px при зазоре рядов
// 4–10 px — зона выступает на 12 px вверх и вниз и ложится на соседний ряд, касание у края пилюли
// уходило соседу (замер Chromium, 300 px: крестики связей — 119 точек из 640, коды в свойствах —
// 265 из 2240). Правило для рядов пилюль/чипов на сенсоре: зазор рядов = 44 − 20 (зона пилюли
// 20 px укладывается целиком), а сама зона по вертикали не выходит дальше половины зазора — так
// соседние ряды не перекрываются при любой высоте пилюли. jsdom раскладку не считает — здесь
// правила; живой замер — Chromium (pointer: coarse), числа в описании PR.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('./seidr.css', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

/** Тела всех правил внутри @media (pointer: coarse). */
function coarseBlocks(): string {
  const out: string[] = [];
  const re = /@media\s*\(pointer:\s*coarse\)\s*\{/g;
  while (re.exec(css)) {
    let depth = 1;
    let i = re.lastIndex;
    for (; i < css.length && depth > 0; i++) {
      if (css[i] === '{') depth++;
      else if (css[i] === '}') depth--;
    }
    out.push(css.slice(re.lastIndex, i - 1));
  }
  return out.join('\n');
}

/** Ряды пилюль/чипов, где пилюли переносятся на следующую строку. */
// Только ряды с живой зоной: у .sk-pill и .sk-rec-chips__link зона обрезана overflow: hidden самой
// пилюли (замер: зона 16–18 px), соседний ряд они не перекрывают.
const CHIP_ROWS = ['.sk-relfield__chips', '.sk-rec-fields__refs'];

describe('ряды пилюль на сенсоре: зоны касания не перекрывают соседний ряд', () => {
  const coarse = coarseBlocks();

  it('положительный контроль: блоки pointer: coarse находятся, общая зона 44 в них есть', () => {
    expect(coarse).toMatch(/--hit:\s*44px/);
    expect(coarse).toMatch(/height:\s*max\(100%,\s*var\(--hit\)\)/);
  });

  it('у каждого ряда пилюль зазор рядов — общий токен --chiprow-gap', () => {
    const i = coarse.indexOf('--chiprow-gap:');
    expect(i, 'токена --chiprow-gap нет').toBeGreaterThan(-1);
    const sel = coarse.slice(coarse.lastIndexOf('}', i) + 1, coarse.indexOf('{', coarse.lastIndexOf('}', i) + 1));
    for (const row of CHIP_ROWS) expect(sel, `${row} без --chiprow-gap`).toContain(row);
    expect(coarse).toMatch(/--chiprow-gap:\s*calc\(var\(--hit\)\s*-\s*20px\)/);
    expect(coarse).toMatch(/row-gap:\s*var\(--chiprow-gap\)/);
  });

  it('зона цели внутри ряда по вертикали не дальше половины зазора', () => {
    expect(coarse).toMatch(/height:\s*min\(max\(100%,\s*var\(--hit\)\),\s*calc\(100%\s*\+\s*var\(--chiprow-gap\)\)\)/);
  });
});
