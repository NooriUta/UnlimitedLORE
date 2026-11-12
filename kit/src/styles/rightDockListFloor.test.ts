// Правый док, сжатый до предела (SPRINT_UXR_POLISH_V11717/P-04): колонка списка
// minmax(0, 1fr) сжималась почти до нуля, и overflow-wrap: anywhere рвал названия
// посередине слова («SECURI/TY», «OMILOR/E»).
//
// Две стороны фикса, обе здесь закреплены:
//   1. Название — overflow-wrap: break-word: слово рвётся, только если само не
//      влезает в строку; anywhere рвал и такие слова, лишь чтобы выровнять
//      min-content. Код (.sk-list__c-id) посимвольно переносится по-прежнему —
//      длинный код читают целиком (S4-30, PR #941).
//   2. Список получает пол 360 px только в правом доке: прокрутка списка не
//      сжимается уже, и включается горизонтальная прокрутка бэкдропа. Пол у
//      колонки сетки нельзя — док обрезал бы панель (overflow: hidden). Пол
//      глобально у .sk-list__scroll нельзя — сорвётся S9-12 (страница не шире
//      окна), здесь базовое min-width: 0 тоже держится.
// jsdom раскладку не считает — сторож держит правила, как в scrollBoxMinWidth.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('./seidr.css', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

function rule(selector: string): string {
  const esc = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = new RegExp(`(?:^|[}\\s,])${esc}\\s*\\{([^}]*)\\}`, 'm').exec(css);
  return m ? m[1] : '';
}

describe('P-04 · правый док: слова списка не рвутся посередине', () => {
  it('название — break-word, а не anywhere: слово цело, пока влезает в строку', () => {
    expect(rule('.sk-list__title')).toMatch(/overflow-wrap:\s*break-word/);
    expect(rule('.sk-list__title')).not.toMatch(/overflow-wrap:\s*anywhere/);
  });

  it('код переносится посимвольно по-прежнему (S4-30, PR #941)', () => {
    expect(rule('.sk-list__c-id')).toMatch(/overflow-wrap:\s*anywhere/);
  });

  it('пол списка 360 px — только в правом доке, прокрутка у бэкдропа', () => {
    expect(rule(".sk-dock[data-placement='right'] .sk-list__scroll")).toMatch(/min-width:\s*360px/);
    // Базовое правило бэкдропа (не размещение в сетке): именно оно несёт прокрутку.
    expect(css).toMatch(/(?:^|\n)\.sk-dock__backdrop\s*\{[^}]*overflow:\s*auto/);
  });

  it('глобальный бокс списка не задет: min-width: 0 (S9-12) на месте', () => {
    expect(rule('.sk-list__scroll')).toMatch(/min-width:\s*0/);
    expect(rule('.sk-list__scroll')).toMatch(/overflow-x:\s*auto/);
  });
});
