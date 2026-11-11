// Ширина текста паспорта во весь экран (жалоба владелицы 11.11.2026, дословно,
// раскладка исправлена): «во всю ширину растягивается в паспорте шапка и строка
// меню с ушками, а самое главное — MartProse и сам контекст нет!!!!».
//
// Корень: выбор ширины записи (S/M/L/«во всю ширину», data-width) меняет колонку
// --rec-col, за ней идут шапка, факты, вкладки и строки вкладки — а тело (MD-поле
// .sk-mdedit с MartProse внутри) держало СВОЮ меру max-width: var(--read-col)
// (~680 px) поверх. Правило: в полноэкранном паспорте ширину текста задаёт
// выбранная ширина записи, а не своя постоянная. В нижней панели мера чтения
// остаётся (там выбора ширины нет).
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const css = readFileSync(`${process.cwd()}/src/styles/seidr.css`, 'utf8');

/** Все правила, у которых в селекторе есть кусок `part`, — тела этих правил. */
function bodiesWith(part: string): string[] {
  const out: string[] = [];
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(css))) {
    if (m[1].split(',').some(sel => sel.includes(part))) out.push(m[2]);
  }
  return out;
}

describe('паспорт во весь экран: текст тянется за выбранной шириной', () => {
  it('положительный контроль: правила тела паспорта в полноэкранном виде найдены', () => {
    expect(bodiesWith("[data-placement='full'] .sk-mdedit").length).toBeGreaterThan(0);
    expect(bodiesWith("[data-placement='full'] .sk-tabpanel > *").length).toBeGreaterThan(0);
  });

  it('тело (MD-поле) в полноэкранном паспорте не держит свою меру --read-col', () => {
    const capped = bodiesWith("[data-placement='full'] .sk-mdedit").filter(b => /max-width:\s*var\(--read-col\)/.test(b));
    expect(capped).toEqual([]);
  });

  it('колонку текста задаёт выбранная ширина записи (--rec-col), как у шапки и вкладок', () => {
    const col = bodiesWith("[data-placement='full'] .sk-tabpanel > *").join(' ');
    expect(col).toMatch(/max-width:\s*var\(--rec-col\)/);
  });

  it('в нижней панели мера чтения остаётся (выбора ширины там нет)', () => {
    expect(bodiesWith("[data-placement='bottom'] .sk-mdedit").some(b => /max-width:\s*var\(--read-col\)/.test(b))).toBe(true);
  });
});
