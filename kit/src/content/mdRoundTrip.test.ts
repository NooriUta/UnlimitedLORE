// @vitest-environment jsdom
// SPRINT_UXR_S5_RECORD_TASKS/S5-07 (страховка S5-06): «Markdown → TipTap →
// Markdown без потерь». Правка на месте (MdInlineEdit) пускает текст через
// визуальный режим TipTap; если круг теряет хоть символ смысла, сохранение
// молча испортит тело записи. Здесь — корпус конструкций, которые реально
// живут в *_md LORE (таблицы, чек-листы, mermaid, формулы, ссылки lore:), и
// контракт детектора: где круг с потерями, визуальный режим честно закрыт.
import { describe, expect, it } from 'vitest';
import { roundTripMd, isLosslessMd, sameMd } from './tiptapMd';

const CORPUS: Record<string, string> = {
  heading: '# Заголовок\n\n## Второй\n\n### Третий',
  inline: 'Текст **жирный**, *курсив*, ~~зачёркнут~~ и `код`.',
  link: 'Ссылка [LORE](https://lore.example/x?a=1) и [@Аня](lore:actor/A-1).',
  bullets: '- раз\n- два\n  - вложенный\n- три',
  ordered: '1. первый\n2. второй\n3. третий',
  tasks: '- [x] сделано\n- [ ] не сделано',
  quote: '> цитата во всю строку',
  image: 'Схема: ![диаграмма](https://lore.example/a.png)',
  hr: 'до\n\n---\n\nпосле',
  fence: '```ts\nconst a = 1;\n```',
  mermaid: '```mermaid\ngraph TD\n  a-->b\n```',
  mathFence: '```math\na^2+b^2=c^2\n```',
  table: '| a | b |\n| --- | --- |\n| 1 | 2 |\n| 3 | 4 |',
  mixed: '## Задачи\n\n- [x] S5-06\n- [ ] S5-07\n\n| код | статус |\n| --- | --- |\n| S5-06 | done |\n\n```mermaid\ngraph LR\n  x-->y\n```\n\nИтог: **готово**.',
};

/** Сравниваем смысл, не пробелы на краях: хвостовой перевод строки не потеря. */
const norm = (s: string) => s.replace(/\r\n/g, '\n').trim();

describe('S5-07 · Markdown → TipTap → Markdown без потерь', () => {
  for (const [name, md] of Object.entries(CORPUS)) {
    it(`круг сохраняет: ${name}`, () => {
      expect(norm(roundTripMd(md))).toBe(norm(md));
      expect(isLosslessMd(md)).toBe(true);
    });
  }

  it('мягкий перенос внутри абзаца — не потеря: текст склеен пробелом, рендер тот же', () => {
    const md = '> цитата\n> вторая строка цитаты\n\nабзац\nс переносом';
    const out = roundTripMd(md);
    expect(norm(out)).not.toBe(norm(md)); // текст действительно другой…
    expect(sameMd(out, md)).toBe(true); // …а читатель видит то же
    expect(isLosslessMd(md)).toBe(true);
  });

  it('второй круг — неподвижная точка (сохранение не «дрейфует» от правки к правке)', () => {
    const once = roundTripMd(CORPUS.mixed);
    expect(roundTripMd(once)).toBe(once);
  });

  it('пустое тело — пустое, без мусора', () => {
    expect(norm(roundTripMd(''))).toBe('');
    expect(isLosslessMd('')).toBe(true);
  });

  it('детектор ловит потерю: сырой HTML TipTap выбрасывает — круг не без потерь', () => {
    // Положительный контроль детектора: без него «всегда true» выглядел бы зелёным.
    const md = 'до\n\n<details><summary>свёрнуто</summary>тайна</details>\n\nпосле';
    expect(norm(roundTripMd(md))).not.toBe(norm(md));
    expect(isLosslessMd(md)).toBe(false);
  });
});
