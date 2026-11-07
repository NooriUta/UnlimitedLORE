// SPRINT_UXR_S10_SEIDR_KIT/K-04 · чтение MD в kit — тот же рендер, что v1:
// формулы KaTeX (копия src/components/lore/markdownMath.ts, S0-09, PR #857)
// подключены в единственную точку настройки marked kit (content/markdown.ts),
// значит их видят MartProse и тело записи kit.
import { describe, expect, it, vi } from 'vitest';

// CSS KaTeX в node-окружении vitest не нужен.
vi.mock('katex/dist/katex.min.css', () => ({}));

import { marked } from './markdown';
import { renderMath } from './markdownMath';

const html = (md: string) => marked.parse(md) as string;

describe('K-04 · KaTeX в marked kit', () => {
  it('строчная $…$ рисуется KaTeX', () => {
    expect(html('площадь $x^2$ квадрата')).toMatch(/class="katex"/);
  });

  it('выключная $$…$$ блоком — display-режим', () => {
    expect(html('$$\n\\frac{a}{b}\n$$')).toMatch(/katex-display/);
  });

  it('```math — выключная формула', () => {
    expect(html('```math\na+b\n```')).toMatch(/katex-display/);
  });

  it('цены не становятся формулами: «$5 и $10»', () => {
    const out = html('стоит $5 и $10');
    expect(out).not.toMatch(/katex/);
    expect(out).toContain('$5 и $10');
  });

  it('ошибка разбора видна: исходник + сообщение, не пустота', () => {
    const out = renderMath('\\frac{a', false);
    expect(out).toMatch(/math-error/);
    expect(out).toContain('\\frac{a');
  });

  it('прочие фенсы — штатный рендер marked', () => {
    expect(html('```js\nlet a = 1\n```')).toMatch(/<code class="language-js">/);
  });
});
