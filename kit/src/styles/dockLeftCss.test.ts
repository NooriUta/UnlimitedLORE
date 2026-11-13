// MP2-14-PLACE-LEFT: у места «слева» своя сетка — зеркало «справа»: панель в первой колонке,
// список во второй, граница на внутреннем (правом) краю панели, у списка тот же пол 360 px.
// jsdom раскладку не считает — сторож держит правила, как rightDockListFloor.test.ts.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('./seidr.css', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

function rule(selector: string): string {
  const esc = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = new RegExp(`(?:^|[}\\s,])${esc}\\s*\\{([^}]*)\\}`, 'm').exec(css);
  return m ? m[1] : '';
}

describe('MP2-14 · док слева', () => {
  it('сетка: панель первой колонкой', () => {
    expect(rule(".sk-dock[data-placement='left']")).toMatch(/grid-template-columns:\s*var\(--dock-panel-w[^;]*\)\s+minmax\(0,\s*1fr\)/);
  });
  it('места: панель 1/1, список 1/2, граница у правого края панели', () => {
    expect(rule(".sk-dock[data-placement='left'] .sk-dock__panel")).toMatch(/grid-area:\s*1 \/ 1/);
    expect(rule(".sk-dock[data-placement='left'] .sk-dock__backdrop")).toMatch(/grid-area:\s*1 \/ 2/);
    expect(rule(".sk-dock[data-placement='left'] .sk-dock__resize")).toMatch(/justify-self:\s*end/);
  });
  it('пол списка 360 px, как справа', () => {
    expect(rule(".sk-dock[data-placement='left'] .sk-list__scroll")).toMatch(/min-width:\s*360px/);
  });
});
