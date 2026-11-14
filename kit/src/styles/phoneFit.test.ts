// SPRINT_UXR_S13_KIT4/K4-PHONE-PAGE-OVERFLOW — на телефоне ничего не шире экрана.
//
// Замер приёмки 14.11 (препрод, ширина 300, сенсор): витрина /kit 349 px при
// экране 300. Распирали не сами элементы, а три правила:
//   1) сетки «сколько влезет» с минимумом колонки в пикселях —
//      repeat(auto-fill, minmax(320px, 1fr)) на экране уже 320 даёт колонку 320,
//      и она выходит за край (TipTapField и MartProse — 320 при колонке 243);
//   2) таблица в MD без своей прокрутки: таблица TipTap/MartProse шире колонки
//      раздвигала или срезалась рамкой редактора (overflow: hidden у .sk-md);
//   3) шапка графика сгорания одной строкой: вердикт «Не успеваем на 3 дня: …»
//      не переносился и обрезался многоточием.
// Правило одно: широкое содержимое листается в СВОЕЙ рамке, а сетка и строки
// сжимаются до экрана. jsdom раскладку не считает — проверяются правила, с
// положительным контролем; живой замер — e2e/kit-showcase.spec.ts (phone-300).
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('./seidr.css', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

/** Тело правила с ровно этим селектором (первое вхождение). */
function rule(selector: string): string {
  const esc = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = new RegExp(`(?:^|[}\\s,])${esc}\\s*\\{([^}]*)\\}`, 'm').exec(css);
  return m ? m[1] : '';
}

/** Все дорожки «сколько влезет»: repeat(auto-fill|auto-fit, minmax(MIN, …)). */
function autoTrackMins(src: string): string[] {
  return [...src.matchAll(/repeat\(\s*auto-(?:fill|fit)\s*,\s*minmax\(\s*((?:[^()]|\([^()]*\))+?)\s*,/g)].map(m => m[1]);
}

describe('K4-PHONE-PAGE-OVERFLOW · seidr.css: широкое — в своей рамке', () => {
  it('положительный контроль: дорожки auto-fill в seidr.css находятся', () => {
    expect(autoTrackMins(css).length).toBeGreaterThan(0);
    expect(autoTrackMins('a{grid-template-columns:repeat(auto-fit, minmax(320px, 1fr))}')).toEqual(['320px']);
    expect(autoTrackMins('a{grid-template-columns:repeat(auto-fill, minmax(min(320px, 100%), 1fr))}')).toEqual(['min(320px, 100%)']);
  });

  it('минимум колонки сетки «сколько влезет» не шире контейнера: min(Npx, 100%)', () => {
    const bad = autoTrackMins(css).filter(m => /^\d+(?:\.\d+)?px$/.test(m));
    expect(bad, `голый пиксельный минимум колонки: ${bad.join(', ')}`).toEqual([]);
  });

  it('таблица в чтении MD (MartProse) листается в своей рамке, а не раздвигает страницу', () => {
    const body = rule('.sk-prose table');
    expect(body).toMatch(/display:\s*block/);
    expect(body).toMatch(/max-width:\s*100%/);
    expect(body).toMatch(/overflow-x:\s*auto/);
  });

  it('таблица и код в правке MD (TipTapField) листаются в своей рамке', () => {
    const wrap = rule('.sk-md .ProseMirror .tableWrapper');
    expect(wrap).toMatch(/overflow-x:\s*auto/);
    expect(wrap).toMatch(/max-width:\s*100%/);
    expect(rule('.sk-md .ProseMirror pre')).toMatch(/overflow-x:\s*auto/);
  });

  // Замер после правки сеток (Playwright, 300 px): строка поля «дата + пояс»
  // в «Редакторах полей» оставалась на 13 px шире колонки — ряд без переноса.
  it('строка редактора поля (значение + подпись пояса) переносится, а не выходит за колонку', () => {
    expect(rule('.sk-field__row')).toMatch(/flex-wrap:\s*wrap/);
    expect(rule('.sk-field')).toMatch(/min-width:\s*0/);
  });

  it('шапка графика сгорания переносится: кнопка-заголовок в несколько строк, вердикт целиком', () => {
    expect(rule('.sk-burn__toggle')).toMatch(/flex-wrap:\s*wrap/);
    const v = rule('.sk-burn__verdict');
    expect(v, 'правило вердикта найдено').not.toBe('');
    expect(v).not.toMatch(/white-space:\s*nowrap/);
    expect(v).not.toMatch(/text-overflow:\s*ellipsis/);
  });
});
