// Отступы паспорта в доке (владелица 13.11.2026: «отступы в карточке паспорта от границ блока
// странные»; на три найденных замером причины — «все вместе»):
//  1) «×» закрытия стояла отдельной строкой над баром — пустая полоса ~45 px. Теперь и на
//     десктопе «×» не обтекается (отрицательное нижнее поле), место ей держит бар;
//  2) асимметрия 15/22 px — плавающая «×» сужала весь паспорт по ширине кнопки;
//  3) снизу и во весь экран шапка сжималась до ширины заголовка и вставала по центру
//     (auto-поля у flex-элемента), а строка фактов — нет: width: 100% и общая колонка.
// jsdom раскладку не считает — сторож держит правила, как rightDockListFloor.test.ts.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('./seidr.css', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const outsideMedia = css.replace(/@media[^{]*\{(?:[^{}]*\{[^}]*\})*[^}]*\}/g, '');

function rule(src: string, selector: string): string {
  const esc = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = new RegExp(`(?:^|[}\\s,])${esc}\\s*[,{]([^}]*)\\}`, 'm').exec(src);
  return m ? m[1] : '';
}

describe('паспорт в доке: отступы', () => {
  it('1–2) «×» не обтекается и на десктопе, бар держит ей место', () => {
    expect(rule(outsideMedia, ".sk-dock:not([data-placement='full']) .sk-dock__close")).toMatch(/margin-bottom:\s*calc\(-1/);
    expect(rule(outsideMedia, ".sk-dock:not([data-placement='full']) .sk-rec-reader__bar")).toMatch(/padding-right:/);
  });
  it('3) снизу и во весь экран колонка шапки во всю свою ширину, факты — в той же колонке', () => {
    expect(outsideMedia).toMatch(/\.sk-dock\[data-placement='bottom'\] \.sk-rec-facts/);
    expect(outsideMedia).toMatch(/\.sk-tabpanel > \* \{ max-width: var\(--rec-col\); width: 100%;/);
  });
});
