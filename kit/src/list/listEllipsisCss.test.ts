// Многоточие в колонке списка (S4-35 / ADR-LORE-049, overflow: 'ellipsis'). Найдено на странице шлюза miniLORE
// 22.11.2026: длинное название (первая фраза диалога) растянуло колонку «Запись» до 1100 px, таблица стала 1800 px
// в окне 950, а «Состояние», «Источник», «Объём» уехали за край. Причина — таблица с автораскладкой: ширина ячейки
// для неё только нижняя граница, а nowrap-текст многоточия задаёт минимум колонки своей полной длиной.
// Правило: шаг ширины — это и потолок (max-width); «fill» берёт остаток (max-width: 0 + width: 100% — обычный приём
// автотаблицы), и многоточие режет по нему. jsdom раскладку не считает — проверяется правило, с положительным контролем.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('../styles/seidr.css', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

describe('колонка с многоточием не растягивает таблицу', () => {
  it('положительный контроль: шаги ширины и многоточие на месте', () => {
    expect(css).toMatch(/\.sk-list__td\[data-w='l'\] \{ width: 240px;/);
    expect(css).toMatch(/\.sk-list__ellip \{[^}]*text-overflow: ellipsis/);
  });

  it('у каждого шага ширины ячейки есть потолок той же величины', () => {
    for (const [w, px] of [['xs', 64], ['s', 104], ['m', 168], ['l', 240]] as const) {
      expect(css).toMatch(new RegExp(String.raw`\.sk-list__td\[data-w='${w}'\] \{[^}]*max-width: ${px}px`));
    }
  });

  it('«fill» берёт остаток строки и режется многоточием, а не раздвигает таблицу', () => {
    expect(css).toMatch(/\.sk-list__td\[data-w='fill'\] \{[^}]*width: 100%[^}]*max-width: 0/);
  });
});
