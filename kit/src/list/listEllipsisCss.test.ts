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

// SPRINT_UXR_S13_KIT4/K4-PASSPORT-NO-LIST-RESET, смоук стенда 22.11.2026 (RFD2-K4RESET, «прокрутка сброшена: 307»).
// Заголовок записи в колонке «fill» с многоточием — кнопка/ссылка (display: -webkit-box) внутри nowrap-обёртки:
// у атомарного блока многоточия нет, и он вырастал до полной длины строки (382–637 px в ячейке 65 px). Текст
// обрезался посреди слова без «…», а сама кнопка торчала за край списка — и любой «показать, если не видно»
// (фокус с клавиатуры, клик Playwright) центрировал её, сдвигая прокрутку списка под паспортом на ~300 px.
it('заголовок записи в ячейке с многоточием не шире ячейки и режется «…»', () => {
  const rule = css.match(/\.sk-list__ellip > \.sk-list__title \{([^}]*)\}/)?.[1] ?? '';
  expect(rule, 'правило для заголовка внутри обёртки многоточия').not.toBe('');
  expect(rule).toMatch(/display: block/);
  expect(rule).toMatch(/max-width: 100%/);
  expect(rule).toMatch(/overflow: hidden/);
  expect(rule).toMatch(/text-overflow: ellipsis/);
  expect(rule).toMatch(/white-space: nowrap/);
  // раскрытие по касанию возвращает перенос
  expect(css).toMatch(/\.sk-list__ellip\[data-open='true'\] > \.sk-list__title \{[^}]*white-space: normal/);
});
