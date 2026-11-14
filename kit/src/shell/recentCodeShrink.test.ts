// Приёмка препрода efe20f03: в «Недавних» меню ☰ на телефоне длинный код записи
// (SPRINT_…/K4-…) занимал всю строку, и названия не было видно. У кода не было
// min-width: 0 — он не сжимался ниже своей ширины, а название (flex: 1; min-width: 0)
// схлопывалось в ноль. Правило для любого пункта меню оболочки: код рядом с
// названием вторичен — ограничен по ширине и режется многоточием, название остаётся.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const css = readFileSync(`${process.cwd()}/src/styles/seidr.css`, 'utf8');
const rule = (sel: string) => {
  const i = css.indexOf(`${sel} {`);
  expect(i, `правила ${sel} нет`).toBeGreaterThan(-1);
  return css.slice(i, css.indexOf('}', i));
};

describe('пункт меню оболочки: код не вытесняет название', () => {
  it('код рядом с названием сжимается и режется многоточием, а не держит свою ширину', () => {
    const r = rule('.sk-shell__item > .sk-shell__id');
    expect(r).toMatch(/min-width:\s*0/);
    expect(r).toMatch(/max-width:\s*45%/);
    expect(r).toMatch(/text-overflow:\s*ellipsis/);
    expect(r).toMatch(/white-space:\s*nowrap/);
    expect(r).toMatch(/overflow:\s*hidden/);
  });
});
