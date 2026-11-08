// Сторож (08.11, #895): при разрешении git-конфликта в seidr.css потерялась закрывающая
// скобка @media. Тесты kit читают CSS как текст и это пропустили — упала только
// сборка образа web-next (postcss «Unclosed block»). Баланс скобок проверяем здесь,
// без комментариев и строк, с положительным контролем.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('./seidr.css', import.meta.url), 'utf8');
// Комментарии убираем (строк с фигурными скобками в seidr.css нет).
const strip = (s: string) => s.replace(new RegExp('/\\*[\\s\\S]*?\\*/', 'g'), '');
function balance(s: string): { ok: boolean; line: number } {
  let depth = 0;
  const lines = strip(s).split('\n');
  for (let i = 0; i < lines.length; i++) {
    for (const ch of lines[i]) {
      if (ch === '{') depth++;
      else if (ch === '}') { depth--; if (depth < 0) return { ok: false, line: i + 1 }; }
    }
  }
  return { ok: depth === 0, line: lines.length };
}

describe('seidr.css — скобки сбалансированы', () => {
  it('положительный контроль: незакрытый блок ловится', () => {
    expect(balance('.a { x: 1; }\n@media (x) {\n .b { y: 2; }\n').ok).toBe(false);
  });
  it('в seidr.css все блоки закрыты и нет лишних конфликтных маркеров', () => {
    expect(balance(css)).toEqual({ ok: true, line: expect.any(Number) });
    expect(css).not.toMatch(/^(<{7}|={7}|>{7})/m);
  });
});
