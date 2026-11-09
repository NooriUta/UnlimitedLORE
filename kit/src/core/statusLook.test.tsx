// @vitest-environment jsdom
// Иконка и цвет статуса — ОДИН источник на все виды: словарь приложения
// (SPRINT_UXR_S4_UI_SHELL_LISTS/S4-STATUS-AXIS-CONFIG).
//
// Слова владелицы 09.11.2026, дословно: «напомни остальным что статусную
// модель и иконки к ним по контракту несут они, а ты просто обрабатываешь
// согласно контракту, а то вся работа в тебя — ты мне так кит не сделаешь».
// И следом: «контракты пусть правят другие сессии, а тебе пишут что сделать
// универсального».
//
// ЧТО БЫЛО. У статусных иконок в kit было ДВА источника: словарь приложения
// (config.statuses, он же словарь модели /lore/model) и внутренняя таблица
// kit `statusMeta` с кодами LORE. Чип брал словарь, а лента новостей —
// таблицу. Поэтому на проде v1.17.7 релизная сессия увидела, что иконки
// статусов в новостях не те, что в задачах и спринтах: не «разные вкусы», а
// два разных источника правды.
//
// ЧТО ЗАКРЕПЛЯЕТСЯ. Словарь главнее всегда. Таблица kit остаётся ЗАПАСОМ на
// случай «словаря нет» (модель недоступна, витрина вне оболочки) — и этот
// случай ПОМЕЧЕН: вид обязан иметь возможность сказать «иконка из запаса», а
// не выдавать её за данные приложения.
import { describe, expect, it } from 'vitest';
import { statusLook } from './statusLook';
import type { KitConfig } from './contract';

type Items = KitConfig['statuses']['items'];

const items: Items = [
  { code: 'done', title: 'Готово', category: 'done', icon: 'divided-spiral', color: 'var(--st-done)' },
  { code: 'ready_for_deploy', title: 'К выкатке', category: 'active', icon: 'wave-crest', color: 'var(--inf)' },
  // Дыра в справочнике: статус есть, а оформления у него нет. Так на проде
  // выглядят adr-статусы draft/deferred (замер серверной сессии 09.11).
  { code: 'draft', title: 'Черновик', category: 'todo', icon: '', color: '' },
];

describe('S4-STATUS-AXIS-CONFIG · словарь приложения главнее таблицы kit', () => {
  it('положительный контроль: код есть в словаре — иконка и цвет оттуда', () => {
    const r = statusLook('ready_for_deploy', items);
    expect(r.icon).toBe('wave-crest');
    expect(r.color).toBe('var(--inf)');
    expect(r.source).toBe('dict');
  });

  it('словарь отдал ДРУГУЮ иконку, чем таблица kit — побеждает словарь', () => {
    // Иначе «иконки несёт контракт» остаётся словами: таблица kit знает свой
    // значок для done, и раньше лента рисовала именно его.
    const own: Items = [{ code: 'done', title: 'Готово', category: 'done', icon: 'castle', color: 'var(--acc)' }];
    const r = statusLook('done', own);
    expect(r.icon).toBe('castle');
    expect(r.color).toBe('var(--acc)');
  });

  it('словаря нет вовсе (витрина вне оболочки) — запас kit, и это ПОМЕЧЕНО', () => {
    const r = statusLook('done', undefined);
    expect(r.icon).not.toBe('');
    expect(r.source).toBe('fallback');
    expect(r.why).toMatch(/словар/i);
  });

  it('кода в словаре нет — запас kit с пометкой, а не пустая иконка', () => {
    const r = statusLook('partial', items);
    expect(r.icon).not.toBe('');
    expect(r.source).toBe('fallback');
    expect(r.why).toContain('partial');
  });

  it('в словаре статус БЕЗ оформления — тоже запас, и названо, что дыра в справочнике', () => {
    // Это реальная дыра прода: у adr-статусов draft/deferred icon и color
    // пустые. Показать пустую иконку значило бы спрятать дыру.
    const r = statusLook('draft', items);
    expect(r.icon).not.toBe('');
    expect(r.source).toBe('fallback');
    expect(r.why).toMatch(/без иконки|без цвета/i);
  });

  it('цвет не токен — нейтральный, и сказано: сырой hex в тему не пускаем', () => {
    const bad: Items = [{ code: 'x', title: 'X', category: 'active', icon: 'castle', color: '#ff0000' }];
    const r = statusLook('x', bad);
    expect(r.color).toMatch(/^var\(--/);
    expect(r.why).toMatch(/не токен/i);
  });

  it('кода нет совсем (null, пусто) — общий значок «неизвестно», не пустота', () => {
    for (const code of [null, undefined, '']) {
      const r = statusLook(code, items);
      expect(r.icon, String(code)).not.toBe('');
      expect(r.source, String(code)).toBe('fallback');
    }
  });
});
