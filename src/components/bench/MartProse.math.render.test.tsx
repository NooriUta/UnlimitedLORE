import { describe, expect, it } from 'vitest';
import { renderUi } from '../../test/render';
import { MartProse } from './MartProse';

// SPRINT_UXR_S0_SAFETY/S0-09 · формулы LaTeX в Markdown рендерятся KaTeX.
// Поймано владелицей на SPEC-LORE-UXR-NEWS-ALGORITHMS: формулы шли сырым текстом.
function prose(md: string): HTMLElement {
  const { container } = renderUi(<MartProse text={md} />);
  const root = container.querySelector('.mart-prose');
  if (!root) throw new Error('MartProse ничего не нарисовал');
  return root as HTMLElement;
}

describe('MartProse · формулы (KaTeX)', () => {
  it('строчная $a^2$ — формула внутри абзаца', () => {
    const root = prose('Площадь $a^2$ квадрата.');
    const k = root.querySelector('p .katex');
    expect(k).not.toBeNull();
    expect(root.querySelector('.katex-display')).toBeNull();
    expect(root.textContent).not.toContain('$a^2$');
    expect(root.textContent).toContain('Площадь');
  });

  it('блок $$…$$ — выключная формула', () => {
    const root = prose('До\n\n$$\\sum_g N(g)$$\n\nПосле');
    expect(root.querySelector('.katex-display')).not.toBeNull();
    expect(root.textContent).not.toContain('$$');
    expect(root.textContent).toContain('После');
  });

  it('многострочный блок $$ … $$', () => {
    const root = prose('$$\nO_g(t)=\\sum_{x\\in T_g}\\mathrm{open}(x,t)\n$$');
    expect(root.querySelector('.katex-display')).not.toBeNull();
  });

  it('фенс ```math — выключная формула', () => {
    const root = prose('```math\n\\frac{a}{b}\n```');
    expect(root.querySelector('.katex-display')).not.toBeNull();
    expect(root.querySelector('pre')).toBeNull();
  });

  it('цены «$5» и «$5 и $10» остаются текстом', () => {
    const root = prose('Стоит $5.\n\nОт $5 и $10 за штуку.');
    expect(root.querySelector('.katex')).toBeNull();
    expect(root.textContent).toContain('Стоит $5.');
    expect(root.textContent).toContain('От $5 и $10 за штуку.');
  });

  it('экранированный \\$ — текст, инлайн-код с $ — код', () => {
    const root = prose('Цена \\$x\\$ и `$y$`.');
    expect(root.querySelector('.katex')).toBeNull();
    expect(root.querySelector('code')?.textContent).toBe('$y$');
  });

  it('ошибка формулы — исходник и текст ошибки, не пустота', () => {
    const root = prose('$$\\frac{$$');
    const err = root.querySelector('.math-error');
    expect(err).not.toBeNull();
    expect(err!.textContent).toContain('\\frac{');
    expect(err!.querySelector('.math-error-msg')?.textContent?.length ?? 0).toBeGreaterThan(3);
    expect(root.querySelector('.katex-display')).toBeNull();
  });

  it('санитайзер не вырезает KaTeX и не пропускает скрипты', () => {
    const root = prose('$x$ <img src=x onerror="alert(1)"> <script>alert(2)</script>');
    expect(root.querySelector('.katex .katex-html')).not.toBeNull();
    // MathML-копия для скринридеров тоже доходит до DOM.
    expect(root.querySelector('.katex .katex-mathml math')).not.toBeNull();
    expect(root.querySelector('script')).toBeNull();
    expect(root.querySelector('[onerror]')).toBeNull();
  });

  it('фенсы mermaid по-прежнему выделяются из потока', () => {
    const root = prose('$a$\n\n```mermaid\nflowchart LR\n  A-->B\n```\n\n$$b$$');
    expect(root.querySelectorAll('.katex').length).toBe(2);
    expect(root.textContent).not.toContain('flowchart LR');
  });

  // Фикстура — кусок тела SPEC-LORE-UXR-NEWS-ALGORITHMS (§7, v0.4.0) как есть.
  it('спека SPEC-LORE-UXR-NEWS-ALGORITHMS: формулы §7 рисуются', () => {
    const md = [
      '**Обозначения:**',
      '- период $P=[t_0,t_1)$, предыдущий $P^-=[t_0-(t_1-t_0),\\,t_0)$;',
      '- $G(x)$ — группы разреза элемента $x$; $E_g=\\{e\\in E: g\\in G(\\mathrm{el}(e))\\}$; $X(S)=\\{\\mathrm{el}(e):e\\in S\\}$;',
      '- $\\mathrm{cat}(x,t)$ — категория статуса $x$ в момент $t$ по снимку SCD2 (последняя версия с $\\mathrm{valid\\_from}\\le t$);',
      '',
      '### 7.1 Счёт событий и элементов — общий для всех классов',
      '',
      '$$N_{ev}(g)=|E_g|,\\qquad N_{el}(g)=|X(E_g)|,\\qquad N^{\\Sigma}_{ev}=|E|,\\qquad N^{\\Sigma}_{el}=|X(E)|$$',
      '',
      '$$M=|\\{x\\in X(E):|G(x)|\\ge 2\\}|,\\qquad \\sum_g N_{el}(g)=N^{\\Sigma}_{el}+\\sum_{x\\in X(E)}(|G(x)|-1)$$',
      '',
      'По видам и по типам — те же формулы на подмножествах $E^{k}$.',
      '',
      '- Flow = $Acc(1)+Rej(0)-New(1)=0$, совпадает с $Q(t_0)-Q(t_1)$;',
      '',
      '> Формулы записаны в LaTeX ($…$ и $$…$$).',
    ].join('\n');
    const root = prose(md);
    expect(root.querySelectorAll('.katex-display').length).toBeGreaterThanOrEqual(2);
    expect(root.querySelectorAll('.katex').length).toBeGreaterThanOrEqual(12);
    expect(root.querySelector('.math-error')).toBeNull();
    // Видимый текст: MathML-копия (.katex-mathml, для скринридеров) несёт исходник в <annotation>.
    const visible = root.cloneNode(true) as HTMLElement;
    visible.querySelectorAll('.katex-mathml').forEach(n => n.remove());
    expect(visible.textContent).not.toMatch(/\\mathrm|\\qquad|\\sum/);
  });
});
