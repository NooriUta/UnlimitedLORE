// Владелица 21.11.2026 (скрин строки паспорта «‹ 21 из 30 › ⤢ ☰ ×»): «после крестика много свободного места необосновано».
// Строка паспорта держала справа место под плавающий «×» дока безусловно, а «×» уже стоит в строке инструментов
// (замер прода: padding-right 32 px, плавающей кнопки нет). Запас — только при плавающем «×» в панели.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const css = readFileSync(`${process.cwd()}/src/styles/seidr.css`, 'utf8');

const barPadRules = () => [...css.matchAll(/([^{}]*\.sk-rec-reader__bar)\s*\{([^}]*)\}/g)]
  .filter(m => /padding-right/.test(m[2])).map(m => m[1].trim());

describe('строка паспорта: запас справа только под плавающий «×» дока', () => {
  it('каждое правило запаса привязано к панели, в которой есть .sk-dock__close', () => {
    const rules = barPadRules();
    expect(rules.length).toBeGreaterThan(0);
    for (const sel of rules) expect(sel).toMatch(/\.sk-dock__panel:has\(> \.sk-dock__close\)/);
  });
});
