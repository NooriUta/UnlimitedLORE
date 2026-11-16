// Владелица 16.11 на «Аналитику» препрода: «расположение графиков странное» — на широком экране четыре
// узких графика в ряд и пустой экран под ними. Правило: не больше двух блоков в ряд (2 × 2), на телефоне — столбик.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const css = readFileSync(resolve(process.cwd(), 'src/App.css'), 'utf8');
const rule = css.match(/\.an-grid\s*\{([^}]*)\}/)?.[1] ?? '';

describe('Аналитика: сетка блоков', () => {
  it('колонка не уже половины ряда — больше двух в ряд не встанет', () => {
    expect(rule).toMatch(/grid-template-columns:\s*repeat\(auto-fit,\s*minmax\(min\(100%,\s*max\(420px,\s*calc\(50% - 6px\)\)\),\s*1fr\)\)/);
  });
  it('на узком экране колонка не шире экрана (min(100%, …))', () => {
    expect(rule).toContain('min(100%');
  });
});
