// SPRINT_UXR_S4_UI_SHELL_LISTS/S4-21 (волна 1a) — плотность «roomy» по умолчанию и формы контролов.
// Решение владелицы 08.11: roomy по умолчанию, compact и comfortable — выбор в настройках.
// Прототип v4 держит строку списка ~51 px и название в 2 строки, а v2 — 24 px с обрезкой.
// Высота строки списка — отдельный токен --list-row-h: --row-h задаёт высоту
// контролов (кнопок, полей), и раздувать их вместе со строкой нельзя.
// jsdom раскладку не считает, поэтому проверяются правила — с положительным контролем.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('../styles/seidr.css', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

function rule(selector: string): string {
  const esc = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = new RegExp(`(?:^|[}\\s,])${esc}\\s*\\{([^}]*)\\}`, 'm').exec(css);
  return m ? m[1] : '';
}
const px = (block: string, token: string) => {
  const m = new RegExp(`${token}:\\s*([\\d.]+)px`).exec(block);
  return m ? Number(m[1]) : NaN;
};

describe('плотность строк списка', () => {
  it('положительный контроль: :root найден', () => {
    expect(rule(':root')).toMatch(/--row-h:/);
  });

  it(':root = roomy: строка списка ≥ 40 px, название до 2 строк', () => {
    expect(px(rule(':root'), '--list-row-h')).toBeGreaterThanOrEqual(40);
    expect(rule(':root')).toMatch(/--list-title-lines:\s*2/);
  });

  it('compact — прежняя плотность: 24 px, одна строка названия', () => {
    const b = rule("[data-density='compact']");
    expect(px(b, '--row-h')).toBe(24);
    expect(px(b, '--list-row-h')).toBe(24);
    expect(b).toMatch(/--list-title-lines:\s*1/);
  });

  it('ячейка растёт по содержимому (min-height через высоту tr), а не режется фиксированной высотой', () => {
    expect(rule('.sk-list__td')).toMatch(/height:\s*var\(--list-row-h\)/);
    expect(rule('.sk-list__title')).toMatch(/-webkit-line-clamp:\s*var\(--list-title-lines\)/);
  });

  it('заголовки колонок — не мельче --fs-xs (9 px в тёмной теме не читается)', () => {
    expect(rule('.sk-list__th')).toMatch(/font-size:\s*var\(--fs-xs\)/);
  });
});

describe('формы контролов', () => {
  it('вкладки-подчёркивание: без рамки-пилюли, выбранная — линия снизу', () => {
    expect(rule('.sk-tabs--underline .sk-tab')).toMatch(/border-radius:\s*0/);
    expect(rule(".sk-tabs--underline .sk-tab[aria-selected='true']")).toMatch(/border-bottom-color:\s*var\(--acc\)/);
  });

  it('число быстрого фильтра — с отступом от подписи, простым текстом как в v1 (владелица 08.11: шарик был выше пилюли)', () => {
    const b = rule('.sk-list__qcount');
    expect(b).toMatch(/margin-left:/);
    expect(b).not.toMatch(/background|border-radius/);
  });
});
