// @vitest-environment jsdom
// SPRINT_UXR_S5_RECORD_TASKS/S5-07 · «Markdown → TipTap → Markdown без потерь».
//
// Правка на месте (S5-06) открывает тело записи в TipTapField и сохраняет то,
// что вернул сериализатор. Всё, что круг Markdown → TipTap → Markdown меняет
// в источнике, уезжает в базу молча: [[ссылка]] становится «\[\[…\]\]» и
// перестаёт быть ребром, `\|` в ячейке разваливает таблицу на лишний столбец,
// ссылка lore: теряет адрес, формула получает удвоенные обратные слэши.
//
// Правило (обобщение частных случаев): источник после круга совпадает с
// исходником — с точностью до пустых строк между блоками вне фенсов (они не
// меняют ни рендер, ни смысл). Набор ниже — по одному элементу каждого вида,
// который живёт в телах LORE; новый вид блока = новая строка в CORPUS.
//
// Зубы теста: тот же набор через «голый» TipTap (без слоя без-потерь) обязан
// упасть на каждом виде, ради которого слой существует, а намеренная порча
// одного элемента в выходе — ловиться сравнением.
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, waitFor } from '@testing-library/react';

vi.mock('katex/dist/katex.min.css', () => ({}));

import { Editor } from '@tiptap/core';
import {
  markdownExtensions,
  markdownRoundTrip,
  normalizeMarkdown,
  plainMarkdownExtensions,
} from './markdownRoundTrip';
import { TipTapField } from './TipTapField';

interface Case { name: string; md: string; /** «голый» TipTap теряет этот вид */ lossyWithoutLayer?: boolean }

const CORPUS: Case[] = [
  {
    name: 'заголовки, акценты, код, внешняя ссылка',
    md: '# Заголовок\n\n## Второй\n\nАбзац со **жирным**, *курсивом*, ~~зачёркнутым~~, `кодом` и [ссылкой](https://example.com).\n',
  },
  {
    name: 'таблица',
    md: '| Колонка | Число |\n| --- | --- |\n| а | 1 |\n| **б** | `2` |\n',
  },
  {
    name: 'таблица: экранированная | в ячейке',
    md: '| Выражение | Смысл |\n| --- | --- |\n| a \\| b | или |\n',
    lossyWithoutLayer: true,
  },
  {
    name: 'mermaid',
    md: '```mermaid\ngraph TD\n  A[Старт] --> B{Выбор}\n  B -->|да| C\n  B -->|нет| D\n```\n',
  },
  {
    name: '[[ссылки]] всех форм',
    md: 'См. [[ADR-LORE-038]], [[task:SPRINT_MINILORE_CUTOVER/CO-11]] и [[D-2026-MINILORE-WRONG-INDICATOR]].\n',
    lossyWithoutLayer: true,
  },
  {
    name: '[[ссылка]] с подписью и в списке',
    md: '- задача [[SPRINT_X/CO-11|переезд]]\n- решение [[decision:D-2026-A]]\n',
    lossyWithoutLayer: true,
  },
  {
    name: 'lore-блок: фенс ```lore-*',
    md: '```lore-slice\nslice: tasks_of_sprint\nsprint_id: SPRINT_X\n```\n',
  },
  {
    name: 'lore-блок: ссылка lore: (актор, спринт)',
    md: 'Ответственный [@Анна](lore:actor/anna), спринт [переезд](lore:sprint/SPRINT_X).\n',
    lossyWithoutLayer: true,
  },
  {
    name: 'lore-блок: директива :::',
    md: ':::lore-note\nБлок-директива с **жирным** и [[ADR-LORE-038]]\n:::\n',
    lossyWithoutLayer: true,
  },
  {
    name: 'lore-блок: HTML-комментарий-метка',
    md: '<!-- lore:meta id=1 -->\n\nТекст после метки.\n',
    lossyWithoutLayer: true,
  },
  {
    name: 'перенос строки внутри абзаца',
    md: 'Первая строка абзаца\nвторая строка того же абзаца.\n',
    lossyWithoutLayer: true,
  },
  {
    name: 'жёсткий перенос',
    md: 'строка\\\nследующая\n',
  },
  {
    name: 'списки: маркированный, вложенный, нумерованный, чек-лист',
    md: '- пункт 1\n- пункт 2\n  - вложенный\n\n1. первый\n2. второй\n\n- [ ] открыто\n- [x] сделано\n',
  },
  {
    name: 'цитата и разделитель',
    md: '> цитата\n> в две строки\n\n---\n\nпосле\n',
  },
  {
    name: 'формулы: строчная, выключная, фенс math (S5-13)',
    md: 'Формула $a^2 + b_1$ в строке.\n\n$$\n\\sum_g N(g)\n$$\n\n```math\nE = mc^2\n```\n',
    lossyWithoutLayer: true,
  },
  {
    name: 'доллары-цены не формула (S5-13)',
    md: 'Цена $5 и $10 за штуку.\n',
  },
  {
    name: 'экранированный доллар \\$ остаётся экранированным (S5-13)',
    md: 'Не формула: \\$x\\$ и \\$y\\$.\n',
    lossyWithoutLayer: true,
  },
  {
    name: 'подчёркивания и звёздочки в словах',
    md: 'Поле snake_case_name и выражение 2*3*4.\n',
  },
];

describe('S5-07 · Markdown → TipTap → Markdown без потерь', () => {
  for (const c of CORPUS) {
    it(c.name, () => {
      expect(normalizeMarkdown(markdownRoundTrip(c.md))).toBe(normalizeMarkdown(c.md));
    });
  }

  it('весь набор одним телом — тоже без потерь', () => {
    const all = CORPUS.map(c => c.md).join('\n');
    expect(normalizeMarkdown(markdownRoundTrip(all))).toBe(normalizeMarkdown(all));
  });

  it('второй круг ничего не меняет (идемпотентность)', () => {
    const all = CORPUS.map(c => c.md).join('\n');
    const once = markdownRoundTrip(all);
    expect(markdownRoundTrip(once)).toBe(once);
  });
});

// Какие атомы-исходники получились из MD: [вид, исходник].
function rawAtoms(md: string): Array<[string, string]> {
  const editor = new Editor({ extensions: markdownExtensions(), content: md });
  const out: Array<[string, string]> = [];
  editor.state.doc.descendants(n => {
    if (n.type.name === 'mdRaw' || n.type.name === 'mdRawBlock') out.push([String(n.attrs.kind), String(n.attrs.raw)]);
  });
  editor.destroy();
  return out;
}

describe('S5-07 · что становится атомом-исходником', () => {
  it('цены «$5 и $10» — текст, а не формула (правило долларов как у marked)', () => {
    expect(rawAtoms('Цена $5 и $10 за штуку.')).toEqual([]);
  });

  it('формулы, [[ссылки]], \\$, директива и комментарий — атомы своего вида', () => {
    expect(rawAtoms('$a^2$ и [[ADR-LORE-038]] и \\$')).toEqual([['math', '$a^2$'], ['wikilink', '[[ADR-LORE-038]]'], ['escape', '\\$']]);
    expect(rawAtoms(':::note\nтекст\n:::\n\n<!-- метка -->')).toEqual([['directive', ':::note\nтекст\n:::'], ['comment', '<!-- метка -->']]);
  });

  it('код не трогается: $ и [[ внутри `кода` и фенса — не атомы', () => {
    expect(rawAtoms('`$a$ [[X]]`\n\n```\n$$b$$\n```')).toEqual([]);
  });

  it('незакрытая директива — обычный абзац, как у marked', () => {
    expect(rawAtoms(':::note\nбез закрытия')).toEqual([]);
  });
});

describe('S5-07 · у теста есть зубы', () => {
  for (const c of CORPUS.filter(x => x.lossyWithoutLayer)) {
    it(`«голый» TipTap теряет: ${c.name}`, () => {
      const plain = markdownRoundTrip(c.md, plainMarkdownExtensions());
      expect(normalizeMarkdown(plain)).not.toBe(normalizeMarkdown(c.md));
    });
  }

  it('порча одного элемента в выходе ловится сравнением', () => {
    const src = CORPUS.find(c => c.name === '[[ссылки]] всех форм')!.md;
    const spoiled = markdownRoundTrip(src).replace('[[ADR-LORE-038]]', '\\[\\[ADR-LORE-038\\]\\]');
    expect(normalizeMarkdown(spoiled)).not.toBe(normalizeMarkdown(src));
  });

  it('нормализация не прячет пустые строки внутри фенса', () => {
    expect(normalizeMarkdown('```\na\n\n\nb\n```\n')).not.toBe(normalizeMarkdown('```\na\n\nb\n```\n'));
    expect(normalizeMarkdown('a\n\n\n\nb\n')).toBe(normalizeMarkdown('a\n\nb\n'));
  });
});

describe('S5-07 · TipTapField отдаёт тот же источник', () => {
  it('режим md показывает исходник без потерь', async () => {
    const md = CORPUS.map(c => c.md).join('\n');
    const { container, getByRole } = render(<TipTapField value={md} onChange={() => {}} ariaLabel="Тело" />);
    await waitFor(() => expect(container.querySelector('.ProseMirror')).toBeTruthy());
    fireEvent.click(getByRole('button', { name: 'режим markdown-источника' }));
    const area = container.querySelector('textarea') as HTMLTextAreaElement;
    expect(normalizeMarkdown(area.value)).toBe(normalizeMarkdown(md));
  });
});
