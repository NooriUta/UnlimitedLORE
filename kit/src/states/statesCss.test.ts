// S4-00c / S4-00e: стиль состояний и оболочек — в едином слое seidr.css.
// jsdom раскладку не считает, поэтому «≥44px на касании», «pill 999», «видимый
// фокус», «уважение reduced-motion» проверяются по правилам файла — с
// положительным контролем, что правило вообще найдено.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('../styles/seidr.css', import.meta.url), 'utf8');

function rule(selector: string): string {
  const esc = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = new RegExp(`(?:^|[}\\s,])${esc}\\s*\\{([^}]*)\\}`, 'm').exec(css);
  return m ? m[1] : '';
}

it('положительный контроль: правило находится, отсутствующее — пусто', () => {
  expect(rule('.sk-pill')).toMatch(/border-radius/);
  expect(rule('.sk-no-such-rule')).toBe('');
});

describe('seidr.css · состояния (S4-00c)', () => {
  it('у каждого состояния свой вид: пусто · ошибка · нет прав · обрезано', () => {
    for (const s of ['.sk-state', '.sk-state--empty', '.sk-state--error', '.sk-state--forbidden', '.sk-trunc']) {
      expect(rule(s), s).not.toBe('');
    }
    expect(rule('.sk-state--error')).toMatch(/var\(--dng\)/);
    expect(rule('.sk-state--forbidden')).toMatch(/var\(--wrn\)/);
    expect(rule('.sk-trunc')).toMatch(/var\(--wrn\)/);
  });

  it('скелет пульсирует, но не при prefers-reduced-motion', () => {
    expect(rule('.sk-skel__line')).toMatch(/animation:/);
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)\s*\{[^}]*\.sk-skel__line\s*\{\s*animation:\s*none/);
  });

  it('кнопка действия в состоянии — pill и ≥ --tap', () => {
    expect(rule('.sk-btn')).toMatch(/border-radius:\s*var\(--r-pill\)/);
    expect(rule('.sk-btn')).toMatch(/min-height:\s*max\(var\(--tap\)/);
    expect(rule('.sk-btn:focus-visible')).toMatch(/outline:\s*2px solid var\(--acc\)/);
  });
});

describe('seidr.css · оболочки (S4-00c)', () => {
  it('вкладка — pill 999, ≥ --tap, видимый фокус, выбранная — акцентом', () => {
    expect(rule('.sk-tab')).toMatch(/border-radius:\s*var\(--r-pill\)/);
    expect(rule('.sk-tab')).toMatch(/min-height:\s*max\(var\(--tap\)/);
    expect(rule('.sk-tab:focus-visible')).toMatch(/outline:\s*2px solid var\(--acc\)/);
    expect(rule(".sk-tab[aria-selected='true']")).toMatch(/var\(--acc\)/);
  });

  it('ушко — вертикальная подпись, ширина ≥ --tap, видимый фокус', () => {
    expect(rule('.sk-ear')).toMatch(/writing-mode:\s*vertical-rl/);
    expect(rule('.sk-ear')).toMatch(/min-width:\s*max\(var\(--tap\)/);
    expect(rule('.sk-ear:focus-visible')).toMatch(/outline:\s*2px solid var\(--acc\)/);
  });

  it('лист: справа (drawer), слева, снизу; на узком экране drawer во всю ширину', () => {
    for (const s of ['.sk-sheet', '.sk-sheet--right', '.sk-sheet--left', '.sk-sheet--bottom', '.sk-sheet-backdrop']) {
      expect(rule(s), s).not.toBe('');
    }
    expect(css).toMatch(/@media \(max-width: 720px\)[^{]*\{[^}]*\.sk-sheet--right[^{]*\{[^}]*width:\s*100vw/);
  });

  it('заголовок листа — Unbounded 800 токенами', () => {
    const t = rule('.sk-sheet__title');
    expect(t).toMatch(/font-family:\s*var\(--display\)/);
    expect(t).toMatch(/font-weight:\s*var\(--display-weight\)/);
  });
});
