// SPRINT_UXR_S4_UI_SHELL_LISTS/S4-MENU-STATES — ушко свёрнутого меню.
//
// Владелица 09.11: «сворачивается оно вообще вверх, ухо хоть в середину
// поставьте». Ушко стояло у верхнего края колонки (`align-self: start;
// margin-top: 8px`) и при прокрутке длинного списка уезжало вместе со
// страницей — рукой его не находили. Теперь оно липнет к середине высоты
// окна: где бы человек ни был в списке, ушко на том же месте.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const css = readFileSync(`${process.cwd()}/src/styles/seidr.css`, 'utf8');
const rule = (sel: string) => {
  const start = css.indexOf(`\n${sel} {`);
  return start < 0 ? '' : css.slice(css.indexOf('{', start) + 1, css.indexOf('}', start));
};

describe('S4-MENU-STATES · ушко свёрнутого меню — посередине окна', () => {
  const ear = rule('.sk-shell__ear');

  it('липнет при прокрутке, а не уезжает со страницей', () => {
    expect(ear).toMatch(/position:\s*sticky/);
  });

  it('стоит по середине высоты окна, а не у верхнего края', () => {
    expect(ear).toMatch(/top:\s*50%/);
    expect(ear).toMatch(/transform:\s*translateY\(-50%\)/);
    expect(ear).not.toMatch(/margin-top:\s*8px/);
  });
});
