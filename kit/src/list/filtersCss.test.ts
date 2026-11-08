// SPRINT_UXR_S4_UI_SHELL_LISTS/S4-05 — стиль фасетов фильтра и поиска в
// едином CSS-слое. jsdom раскладку не считает, поэтому «≥44px на касании»,
// «pill 999» и «видимый фокус» проверяются по правилам — с положительным
// контролем, что правило найдено.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

// Чтение с диска, а не `?raw`: vitest отдаёт CSS-модули пустой строкой (css: false).
const css = readFileSync(new URL('../styles/seidr.css', import.meta.url), 'utf8');

function rule(selector: string): string {
  const esc = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = new RegExp(`(?:^|[}\\s,])${esc}\\s*\\{([^}]*)\\}`, 'm').exec(css);
  return m ? m[1] : '';
}

describe('seidr.css · фасеты и поиск', () => {
  it('положительный контроль: правило listView найдено', () => {
    expect(rule('.sk-list')).toMatch(/display:\s*flex/);
  });

  it.each(['.sk-facet__btn', '.sk-facet__op', '.sk-facet__opt', '.sk-list__search'])('%s — min-height не меньше --tap', sel => {
    expect(rule(sel)).toMatch(/min-height:\s*max\(var\(--tap\)/);
  });

  it('кнопка фасета — pill 999; фокус виден', () => {
    expect(rule('.sk-facet__btn')).toMatch(/border-radius:\s*var\(--r-pill\)/);
    expect(css).toMatch(/\.sk-facet__btn:focus-visible[^{]*\{[^}]*outline:\s*2px solid var\(--acc\)/);
  });
});
