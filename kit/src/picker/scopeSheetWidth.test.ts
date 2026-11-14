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

// Приёмка препрода efe20f03: после «slug ≤34%» имя проекта на телефоне резалось до ~9 букв, а
// slug занимал больше места, чем имя. Правило листа: имя главное — оно занимает свободную ширину и
// переносится (до двух строк) только при нехватке; slug вторичен — мельче и сжимается ПЕРВЫМ.
describe('лист «Проекты» на телефоне: имя главнее slug', () => {
  const flexShrink = (r: string) => Number(/flex:\s*\S+\s+(\d+)/.exec(r)?.[1] ?? NaN);
  it('slug сжимается первым: его flex-shrink много больше, чем у имени, и он может сжаться до нуля', () => {
    const id = rule('.sk-scope__sheet .sk-scope__id');
    const title = rule('.sk-scope__sheet .sk-scope__title');
    expect(flexShrink(id)).toBeGreaterThanOrEqual(100 * flexShrink(title));
    expect(id).toMatch(/min-width:\s*0/);
  });
  it('имя растёт на свободное место и переносится до двух строк, а не режется в одну', () => {
    const title = rule('.sk-scope__sheet .sk-scope__title');
    expect(title).toMatch(/flex:\s*1\s+1/);
    expect(title).toMatch(/white-space:\s*normal/);
    expect(title).toMatch(/-webkit-line-clamp:\s*2/);
  });
});
