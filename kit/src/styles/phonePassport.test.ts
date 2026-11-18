// SPRINT_UXR_MOBILE_POLISH/MP2-PASSPORT-TABS-OVERLAP · телефон, паспорт спринта, вкладка «Задачи» (скрин владелицы
// 18.11.2026 14:55, стенд a2d3ae31): «у препрод съехала верстка компонентов».
// Замер (Playwright, Chrome, 412 px, сервер на копии базы):
//  1) карточка задачи: .sk-cards__fields — сетка `auto 1fr` из пар <div><dt><dd>; длинный код
//     (SPRINT_MINILORE_SRV_TELEMETRY) раздувал левую колонку до 234 px и выталкивал правую («Автор»,
//     «Принимающий») — при крупном шрифте телефона за экран;
//  2) липкие вкладки: прилипают с top: 0 внутри прокручиваемой .sk-dock__panel с отступом сверху 8 px —
//     в этой полосе над вкладками виден прокрученный контент («ИСПОЛНИТЕЛЬ»).
// jsdom раскладку не считает — проверяем правила в файле, с положительным контролем.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('./seidr.css', import.meta.url), 'utf8');

function rule(selector: string): string {
  const esc = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = new RegExp(`(?:^|[}\\s,])${esc}\\s*\\{([^}]*)\\}`, 'm').exec(css);
  return m ? m[1] : '';
}

describe('MP2-PASSPORT-TABS-OVERLAP · телефон: карточки и липкие вкладки', () => {
  it('положительный контроль: правило .sk-cards__fields найдено', () => {
    expect(rule('.sk-cards__fields')).toMatch(/display:\s*grid/);
  });

  it('поля карточки — равные колонки, не по содержимому; длинное значение переносится', () => {
    const f = rule('.sk-cards__fields');
    expect(f).not.toMatch(/grid-template-columns:\s*auto\s+1fr/);
    expect(f).toMatch(/grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/);
    expect(rule('.sk-cards__fields > div')).toMatch(/min-width:\s*0/);
    expect(rule('.sk-cards__fields dd')).toMatch(/overflow-wrap:\s*anywhere/);
    // заголовок-код карточки (SPRINT_MINILORE_SRV_TELEMETRY) тоже переносится, а не выходит за рамку
    expect(rule('.sk-cards__title')).toMatch(/overflow-wrap:\s*anywhere/);
  });

  it('липкие вкладки в доке закрывают и отступ панели: top с вычетом --dock-pad-top', () => {
    // базовое правило панели — с начала строки (у вариантов data-placement тот же хвост селектора)
    const base = /\n\.sk-dock__panel\s*\{([^}]*)\}/.exec(css);
    expect(base && base[1]).toMatch(/padding-top:\s*var\(--dock-pad-top\)/);
    expect(rule('.sk-dock__panel .sk-rec__tabs > .sk-tabs')).toMatch(
      /top:\s*calc\(var\(--rec-sticky-top,\s*0px\)\s*-\s*var\(--dock-pad-top,\s*0px\)\)/);
  });
});
