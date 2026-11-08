import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// SPRINT_UXR_S4_UI_SHELL_LISTS/S4-CONTENT-V4 п.5 (прототип v4): текст паспорта внизу и во весь экран —
// колонкой чтения (--read-col ~680 px, кегль --read-fs), а не на всю ширину мелким кеглем.
// Только токены kit режима чтения (S5-05), сырых px и цветов нет.
describe('паспорт из списка — колонка чтения', () => {
  it('seidr.css (единственный CSS-слой kit) ограничивает текст записи --read-col и --read-fs в bottom и full', () => {
    const css = readFileSync(resolve(__dirname, '../../../kit/src/styles/seidr.css'), 'utf8');
    const rule = css.slice(css.indexOf('S4-CONTENT-V4 п.5'));
    expect(rule).toMatch(/\[data-placement='(bottom|full)'\][^{]*\.sk-mdedit[^{]*\{[^}]*max-width:\s*var\(--read-col\)/);
    expect(rule).toMatch(/font-size:\s*var\(--read-fs/);
  });
});
