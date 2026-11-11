// Вид «Лента» на телефоне (SPRINT_UXR_S4_UI_SHELL_LISTS/S4-MOBILE-EDGE,
// SPEC-SEIDRKIT-ADAPTIVE-TEST §3 п.5).
//
// Проверка матрицы после выкатки v1.17.13 (360×800, «Задачи» → «Лента»): пункт
// ленты — сетка `112px | 1fr`, и на телефоне текст записи вставал в колонку
// 180 px из 360 (начало на 152 px); блоки кода внутри — по 180 px с прокруткой.
// Узко колонки складываются: время и метка — над текстом, текст — во всю ширину.
// jsdom раскладку не считает — проверяется правило, с положительным контролем.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const css = readFileSync(`${process.cwd()}/src/styles/seidr.css`, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

/** Тела всех узких @media (со счётом скобок). */
function narrowBodies(): string {
  const out: string[] = [];
  const re = /@media \(max-width: 720px\)[^{]*\{/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(css))) {
    let depth = 1;
    let j = m.index + m[0].length;
    while (depth && j < css.length) { if (css[j] === '{') depth++; else if (css[j] === '}') depth--; j++; }
    out.push(css.slice(m.index + m[0].length, j - 1));
  }
  return out.join('\n');
}

describe('лента на телефоне — одной колонкой', () => {
  it('положительный контроль: на широком экране пункт ленты — две колонки', () => {
    expect(css).toMatch(/\.sk-feed__item \{[^}]*grid-template-columns: 112px minmax\(0, 1fr\)/);
  });

  it('узко пункт ленты — одна колонка: время над текстом, текст во всю ширину', () => {
    expect(narrowBodies()).toMatch(/\.sk-feed__item \{[^}]*grid-template-columns:\s*minmax\(0, 1fr\)/);
  });
});
