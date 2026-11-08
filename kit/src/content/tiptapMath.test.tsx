// @vitest-environment jsdom
// SPRINT_UXR_S5_RECORD_TASKS/S5-13 · формулы LaTeX в TipTap kit.
// Чтение (MartProse, тело записи) уже рисует KaTeX через markdownMath (K-04).
// Здесь — поле правки: формулы видны прямо в WYSIWYG (превью TipTap), а круг
// «Markdown → TipTap → Markdown» не теряет ни формул, ни обычных долларов
// (дополнение к кругу без потерь S5-07: формулы — его часть).
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, waitFor } from '@testing-library/react';

vi.mock('katex/dist/katex.min.css', () => ({}));

// jsdom не меряет раскладку: focus() редактора после правки прокручивает к
// каретке и зовёт getClientRects у Range/узлов. Пустые прямоугольники — тот же
// исход, что «ничего не видно», без необработанной ошибки прогона.
const noRects = () => ({ length: 0, item: () => null, [Symbol.iterator]: [][Symbol.iterator] }) as unknown as DOMRectList;
const zeroRect = () => ({ x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0, toJSON: () => ({}) }) as DOMRect;
for (const proto of [Range.prototype, Element.prototype, Text.prototype as unknown as Element]) {
  const p = proto as unknown as { getClientRects?: unknown; getBoundingClientRect?: unknown };
  if (typeof p.getClientRects !== 'function') p.getClientRects = noRects;
  if (typeof p.getBoundingClientRect !== 'function') p.getBoundingClientRect = zeroRect;
}

import { TipTapField } from './index';

/** Markdown, который поле отдаёт наружу: тот же getMarkdown, что и onChange. */
async function roundTrip(md: string): Promise<string> {
  const { container, getByRole, unmount } = render(<TipTapField value={md} onChange={() => {}} ariaLabel="M" />);
  await waitFor(() => expect(container.querySelector('.ProseMirror')).toBeTruthy());
  fireEvent.click(getByRole('button', { name: /markdown/i }));
  const src = container.querySelector('textarea.sk-md__source') as HTMLTextAreaElement;
  const out = src.value;
  unmount();
  return out;
}

describe('S5-13 · KaTeX в превью TipTap', () => {
  it('строчная $…$ рисуется KaTeX внутри редактора', async () => {
    const { container } = render(<TipTapField value={'площадь $x^2$ квадрата'} onChange={() => {}} ariaLabel="M" />);
    await waitFor(() => expect(container.querySelector('.ProseMirror .katex')).toBeTruthy());
    expect(container.querySelector('.ProseMirror')?.textContent).not.toContain('$x^2$');
  });

  it('выключная $$…$$ блоком — display-режим', async () => {
    const { container } = render(<TipTapField value={'текст\n\n$$\n\\frac{a}{b}\n$$\n\nещё'} onChange={() => {}} ariaLabel="M" />);
    await waitFor(() => expect(container.querySelector('.ProseMirror .katex-display')).toBeTruthy());
  });

  it('ошибка разбора видна в редакторе: исходник + сообщение, не пустота', async () => {
    const { container } = render(<TipTapField value={'сломано $\\frac{a$ тут'} onChange={() => {}} ariaLabel="M" />);
    await waitFor(() => expect(container.querySelector('.ProseMirror .math-error')).toBeTruthy());
    expect(container.querySelector('.ProseMirror .math-error')?.textContent).toContain('\\frac{a');
  });

  it('цены не становятся формулами: «$5 и $10»', async () => {
    const { container } = render(<TipTapField value={'стоит $5 и $10'} onChange={() => {}} ariaLabel="M" />);
    await waitFor(() => expect(container.querySelector('.ProseMirror')?.textContent).toContain('$5 и $10'));
    expect(container.querySelector('.ProseMirror .katex')).toBeNull();
  });
});

describe('S5-13 · Markdown → TipTap → Markdown без потерь (формулы, к S5-07)', () => {
  const cases: [string, string][] = [
    ['строчная', 'площадь $x^2 + y_1$ квадрата'],
    ['строчная с обратными слэшами', 'дробь $\\frac{a}{b} \\cdot \\alpha$ здесь'],
    ['выключная блоком', 'до\n\n$$\n\\sum_{i=1}^{n} i = \\frac{n(n+1)}{2}\n$$\n\nпосле'],
    ['выключная в одну строку', '$$E = mc^2$$'],
    ['выключная внутри абзаца', 'итого $$a+b$$ и всё'],
    ['цены остаются текстом', 'стоит $5 и $10'],
    ['экранированный доллар не становится формулой', 'не формула: \\$x\\$ — текст'],
    ['фенс math', '```math\na+b\n```'],
    ['формула рядом с разметкой', '**жирный** и $\\sqrt{2}$ и `код`'],
    ['выключная в цитате', '> $$\n> a^2 + b^2\n> $$'],
    ['строчная в списке', '- первый $a_1$\n- второй $a_2$'],
    ['формула и цена в одном абзаце', 'за $5 получаем $x = 1$ и \\$y\\$'],
  ];
  for (const [name, md] of cases) {
    it(name, async () => {
      expect(await roundTrip(md)).toBe(md);
    });
  }

  it('после круга формула всё ещё формула (повторный рендер видит KaTeX)', async () => {
    const once = await roundTrip('a $x$ b');
    const { container } = render(<TipTapField value={once} onChange={() => {}} ariaLabel="M" />);
    await waitFor(() => expect(container.querySelector('.ProseMirror .katex')).toBeTruthy());
  });
});

describe('S5-13 · вставка и правка формулы в редакторе', () => {
  it('кнопка «формула» вставляет строчную формулу, onChange получает $…$', async () => {
    const prompt = vi.spyOn(window, 'prompt').mockReturnValue('\\pi r^2');
    const changes: string[] = [];
    const { container, getByRole } = render(<TipTapField value="" onChange={md => changes.push(md)} ariaLabel="M" />);
    await waitFor(() => expect(container.querySelector('.ProseMirror')).toBeTruthy());
    fireEvent.click(getByRole('button', { name: /LaTeX/i }));
    await waitFor(() => expect(container.querySelector('.ProseMirror .katex')).toBeTruthy());
    expect(changes[changes.length - 1]).toBe('$\\pi r^2$');
    prompt.mockRestore();
  });

  it('двойной клик по формуле меняет исходник; отмена ничего не трогает', async () => {
    const prompt = vi.spyOn(window, 'prompt').mockReturnValueOnce(null).mockReturnValueOnce('y^3');
    const changes: string[] = [];
    const { container } = render(<TipTapField value="a $x$ b" onChange={md => changes.push(md)} ariaLabel="M" />);
    await waitFor(() => expect(container.querySelector('.ProseMirror .sk-md__math')).toBeTruthy());
    fireEvent.dblClick(container.querySelector('.ProseMirror .sk-md__math')!);
    // Отмена: содержимое не меняется (эхо исходного значения допустимо).
    expect(changes.filter(c => c !== 'a $x$ b')).toEqual([]);
    fireEvent.dblClick(container.querySelector('.ProseMirror .sk-md__math')!);
    await waitFor(() => expect(changes[changes.length - 1]).toBe('a $y^3$ b'));
    prompt.mockRestore();
  });
});

describe('S5-13 · повторный рендер', () => {
  it('формула после круга видна KaTeX', async () => {
    const once = await roundTrip('a $x$ b');
    const { container } = render(<TipTapField value={once} onChange={() => {}} ariaLabel="M" />);
    await waitFor(() => expect(container.querySelector('.ProseMirror .katex')).toBeTruthy());
  });
});
