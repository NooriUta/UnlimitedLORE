// SPRINT_UXR_S5_RECORD_TASKS/S5-05 · раскладка режима чтения — в seidr.css.
// jsdom ширины не считает, поэтому «колонка ~680 px», «широкие блоки выходят
// за колонку», «≥44px на касании» и «размер Aa только токенами» проверяются по
// правилам файла — с положительным контролем, что правило найдено.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('../styles/seidr.css', import.meta.url), 'utf8');

function rule(selector: string): string {
  const esc = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = new RegExp(`(?:^|[}\\s,])${esc}\\s*\\{([^}]*)\\}`, 'm').exec(css);
  return m ? m[1] : '';
}

it('положительный контроль разбора', () => {
  expect(rule('.sk-ear')).toMatch(/writing-mode/);
  expect(rule('.sk-read-no-such')).toBe('');
});

describe('S5-05 · колонка и широкие блоки', () => {
  it('ширина колонки — токен --read-col = 680px (50–80 знаков, WCAG 1.4.8)', () => {
    expect(css).toMatch(/:root\s*\{[^}]*--read-col:\s*680px/);
    expect(rule('.sk-read__col')).toMatch(/max-width:\s*var\(--read-col\)/);
    expect(rule('.sk-read__col')).toMatch(/margin-inline:\s*auto/);
  });

  it('широкий блок выходит за колонку, но не за область чтения', () => {
    expect(css).toMatch(/:root\s*\{[^}]*--read-wide:/);
    const w = rule('.sk-read__wide');
    expect(w).toMatch(/width:\s*max\(100%,\s*min\(var\(--read-wide\),\s*100cqi/);
    expect(w).toMatch(/margin-inline-start:\s*calc\(/);
    expect(rule('.sk-read__main')).toMatch(/container-type:\s*inline-size/);
  });

  it('широкая таблица прокручивается сама, а не ломает страницу', () => {
    const t = rule('.sk-read__col table.sk-read__wide');
    expect(t).toMatch(/display:\s*block/);
    expect(t).toMatch(/overflow-x:\s*auto/);
  });
});

describe('S5-05 · кнопки: касание и фокус', () => {
  for (const [sel, focus] of [['.sk-read__expand', ':focus-visible'], ['.sk-read__aa', ':focus-visible'], ['.sk-read__opt', ':focus-within']]) {
    it(`${sel} — ≥ --tap и видимый фокус`, () => {
      expect(rule(sel), sel).toMatch(/min-height:\s*max\(var\(--tap\)/);
      expect(rule(`${sel}${focus}`), sel).toMatch(/outline:\s*2px solid var\(--acc\)/);
    });
  }
});

describe('S5-05 · Aa — размер текста токенами', () => {
  it('у каждой ступени своё правило с var(--fs-*)', () => {
    for (const [size, tok] of [['s', '--fs-base'], ['m', '--fs-md'], ['l', '--fs-lg'], ['xl', '--fs-touch-input']]) {
      expect(rule(`.sk-read[data-size='${size}']`), size).toContain(`var(${tok})`);
    }
    expect(rule('.sk-read__col .sk-prose')).toMatch(/font-size:\s*var\(--read-fs\)/);
  });
});

describe('S5-05 · ⤢ и колонка свойств', () => {
  it('лист «на весь экран» занимает окно', () => {
    const f = rule('.sk-sheet.sk-read-full');
    expect(f).toMatch(/width:\s*100vw/);
    expect(f).toMatch(/height:\s*100vh/);
  });

  it('колонка свойств — с рамкой токеном и своей шириной', () => {
    expect(rule('.sk-read__rail')).toMatch(/border-left:\s*1px solid var\(--bd\)/);
    expect(rule('.sk-shell__ear')).not.toBe('');
  });
});
