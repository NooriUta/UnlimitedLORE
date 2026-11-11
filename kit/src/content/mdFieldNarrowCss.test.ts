// SPRINT_UXR_S4_UI_SHELL_LISTS/S4-MOBILE-EDGE п.А — MD-поле в паспорте на телефоне.
// Замер (360 px): поле правки 207 px — подпись поля колонкой слева
// (.sk-rec-fields dl, minmax(96px, max-content) 1fr) съедала треть ширины.
// Узко MD-поле встаёт под подпись и берёт всю ширину. jsdom раскладку не
// считает — проверяется правило, с положительным контролем.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('../styles/seidr.css', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const narrowBlocks = [...css.matchAll(/@media \(max-width: 720px\)[^{]*\{([\s\S]*?)\n\}/g)].map(m => m[1]).join('\n');

describe('S4-MOBILE-EDGE п.А — MD-поле записи узко во всю ширину', () => {
  it('положительный контроль: сетка полей «подпись | значение» на месте', () => {
    expect(css).toMatch(/\.sk-rec-fields dl \{[^}]*grid-template-columns: minmax\(96px, max-content\) 1fr/);
    expect(narrowBlocks.length).toBeGreaterThan(0);
  });

  it('узко подпись и значение MD-поля занимают всю строку сетки', () => {
    expect(narrowBlocks).toMatch(/\.sk-rec-fields__row\[data-type="md"\] > dt,\s*\.sk-rec-fields__row\[data-type="md"\] > dd \{[^}]*grid-column: 1 \/ -1/);
  });

  it('панель TipTap узко: блок «ещё» переносится во всю ширину', () => {
    expect(css).toMatch(/\.sk-md__more \{[^}]*flex-basis: 100%[^}]*flex-wrap: wrap/);
  });
});
