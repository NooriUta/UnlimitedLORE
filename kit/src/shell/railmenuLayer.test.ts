// PU-26 (приёмка препрода 0dccfe73, 14.11.2026): попап «Недавние» у меню-рейки вставал в окне,
// но «просвечивал» — сквозь пункты читались строки списка. Замер в браузере: фон у
// .sk-shell__railmenu-pop белый и непрозрачный, а elementFromPoint в центре попапа отдавал ячейку
// списка. Корень — наложение, не фон: колонка меню .sk-shell__side — position:sticky, это свой
// контекст наложения с z-index:auto. Попап (z 65) заперт внутри неё, а .sk-shell__main идёт в
// DOM позже и рисуется поверх. Правило: пока у колонки открыт попап рейки, колонка стоит над
// слоями в потоке main (панели фасетов и колонок — 20), но под всплывающими слоями (60+) и
// модальными (листы 70, палитра 80) — им колонка мешать не должна.
//
// jsdom наложения не считает — сторож читает правило из seidr.css.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('../styles/seidr.css', import.meta.url), 'utf8');

const zOf = (selector: string): number | null => {
  const esc = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = css.match(new RegExp(`${esc}\\s*\\{[^}]*z-index:\\s*(\\d+)`));
  return m ? Number(m[1]) : null;
};

describe('PU-26 · попап меню-рейки над списком', () => {
  it('колонка меню с открытым попапом рейки поднимается над main', () => {
    const z = zOf('.sk-shell__side:has(.sk-shell__railmenu-pop)');
    expect(z, 'нет правила z-index для колонки меню с открытым попапом').not.toBeNull();
    expect(z!).toBeGreaterThan(zOf('.sk-facet__panel') ?? 20);
    expect(z!).toBeGreaterThan(zOf('.sk-tasks__colspop') ?? 20);
  });

  it('и остаётся под всплывающими и модальными слоями', () => {
    const z = zOf('.sk-shell__side:has(.sk-shell__railmenu-pop)')!;
    for (const sel of ['.sk-tip', '.sk-vmenu__panel', '.sk-sheet-backdrop', '.sk-palette-backdrop']) {
      const top = zOf(sel);
      expect(top, `нет z-index у ${sel}`).not.toBeNull();
      expect(z, `${sel} (${top}) должен быть выше колонки меню`).toBeLessThan(top!);
    }
  });
});
