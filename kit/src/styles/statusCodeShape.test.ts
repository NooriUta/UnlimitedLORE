// Форма статуса и кода записи — как в v1 (скрин владелицы 08.11, паспорт спринта):
// «статусы не в кружках, а в квадратах с чуть закруглёнными краями, с повторением
// статусного цвета»; «пилюли перед кодом нет — только цвет».
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const css = readFileSync(`${process.cwd()}/src/styles/seidr.css`, 'utf8');
const ruleOf = (sel: string) => {
  const start = css.indexOf(`\n${sel} {`);
  return start < 0 ? '' : css.slice(css.indexOf('{', start) + 1, css.indexOf('}', start));
};

describe('статус и код записи — форма v1', () => {
  it('положительный контроль: правила найдены', () => {
    expect(ruleOf('.sk-schip')).toMatch(/display/);
    expect(ruleOf('.sk-pill--id')).toMatch(/--pill-c/);
  });
  it('статус — квадрат со скруглением var(--r-sm), заливка и рамка цветом статуса', () => {
    const r = ruleOf('.sk-schip');
    expect(r).toMatch(/border-radius:\s*var\(--r-sm\)/);
    expect(r).toMatch(/border:[^;]*--schip-c/);
    expect(r).toMatch(/background:[^;]*--schip-c/);
  });
  it('код записи — без пилюли: ни рамки, ни заливки, только цвет', () => {
    const r = ruleOf('.sk-pill--id');
    expect(r).toMatch(/border-color:\s*transparent/);
    expect(r).toMatch(/background:\s*none/);
    expect(r).toMatch(/padding:\s*0[;\s]/);
  });
});
