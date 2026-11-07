// S4-00b / S4-00e: стиль элементов живёт в едином CSS-слое (seidr.css), чтобы
// тот же вид получал и голый HTML. jsdom раскладку не считает, поэтому
// требования «≥44px на касании», «pill 999» и «видимый фокус» проверяются по
// правилам в файле — и с положительным контролем, что правило найдено.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

// Чтение с диска, а не `?raw`: vitest отдаёт CSS-модули пустой строкой (css: false).
const css = readFileSync(new URL('../styles/seidr.css', import.meta.url), 'utf8');

it('положительный контроль: seidr.css прочитан', () => {
  expect(css).toMatch(/--fs-base/);
});

/** Тело первого правила с данным селектором (точное совпадение начала блока). */
function rule(selector: string): string {
  const esc = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = new RegExp(`(?:^|[}\\s,])${esc}\\s*\\{([^}]*)\\}`, 'm').exec(css);
  return m ? m[1] : '';
}

describe('seidr.css · стиль базовых элементов', () => {
  it('pill — скругление токеном 999', () => {
    expect(rule('.sk-pill')).toMatch(/border-radius:\s*var\(--r-pill\)/);
  });

  it('IconButton — цель не меньше --tap (44px на касании) и видимый фокус', () => {
    const body = rule('.sk-iconbtn');
    expect(body).toMatch(/min-width:\s*max\(var\(--tap\)/);
    expect(body).toMatch(/min-height:\s*max\(var\(--tap\)/);
    expect(rule('.sk-iconbtn:focus-visible')).toMatch(/outline:\s*2px solid var\(--acc\)/);
  });

  it('и сам токен --tap на сенсоре — 44px', () => {
    expect(css).toMatch(/@media \(pointer: coarse\)[^{]*\{\s*:root\s*\{\s*--tap:\s*44px/);
  });

  it('звезда статуса и фильтр-пилюля тоже ≥ --tap', () => {
    expect(rule('.sk-star--btn')).toMatch(/min-height:\s*max\(var\(--tap\)/);
    expect(rule('.sk-pill--filter')).toMatch(/min-height:\s*max\(var\(--tap\)/);
  });

  it('подсказка клавиш прячется на сенсоре (клавиатуры там нет)', () => {
    expect(css).toMatch(/@media \(pointer: coarse\)\s*\{[^}]*\.sk-kbd\s*\{\s*display:\s*none/);
  });
});
