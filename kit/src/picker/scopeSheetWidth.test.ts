// Приёмка на телефоне 14.11.2026 (ширина 300, препрод 8e0a2eff): строки листа «Проекты» шире
// экрана — `.sk-sheet__body` scrollWidth 688 при 300, slug обрезан, «только этот» за правым краем
// и недостижим. Правило: в листе выбора ни одна строка не шире листа — элементы сжимаются
// (min-width: 0), slug режется многоточием, кнопка «только этот» всегда в пределах экрана.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const css = readFileSync(`${process.cwd()}/src/styles/seidr.css`, 'utf8');
const rule = (sel: string) => {
  const i = css.indexOf(`${sel} {`);
  expect(i, `правила ${sel} нет`).toBeGreaterThan(-1);
  return css.slice(i, css.indexOf('}', i));
};

describe('лист «Проекты» на телефоне не шире экрана', () => {
  it('тело листа не прокручивается вбок, строки и группы сжимаются', () => {
    expect(rule('.sk-scope__sheet .sk-sheet__body')).toMatch(/overflow-x:\s*hidden/);
    const r = rule('.sk-scope__sheet .sk-scope__row');
    expect(r).toMatch(/min-width:\s*0/);
    expect(r).toMatch(/max-width:\s*100%/);
  });
  it('на телефоне slug занимает не больше трети строки — «только этот» помещается', () => {
    expect(rule('.sk-scope__sheet .sk-scope__id')).toMatch(/max-width:\s*34%/);
  });
});
