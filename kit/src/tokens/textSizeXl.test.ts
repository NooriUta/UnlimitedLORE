// Шкала текста доходит до «очень крупно»: шаг `xl`
// (SPRINT_UXR_S4_UI_SHELL_LISTS/S4-16).
//
// Слова владелицы 09.11.2026, дословно: «и я просила улучшить крупнее текст у
// меня экран не как у мужа у меня 4к и все мелкое». Прежняя шкала
// заканчивалась на `lg` (base 14px), и «крупнее» было некуда.
//
// ЭТО НЕ ВЫДУМКА НОВОГО ЗНАЧЕНИЯ. Боевой сервер личных настроек уже знает
// `text_size: xl` — в контракте S2 это прямо записано как расхождение, о
// котором клиент v2 обязан предупреждать («сервер знает значения, которых в v2
// нет»). То есть человек МОГ выбрать xl, а v2 показывал умолчание и ругался.
// Здесь v2 догоняет сервер, и расхождение исчезает само.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { DEFAULT_DISPLAY, TEXT_SIZES, displayAttrs } from './prefs';

const css = readFileSync(`${process.cwd()}/src/styles/seidr.css`, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

/** Значения шкалы --fs-* внутри блока `[data-text-size='<id>']`. */
function scaleOf(id: string): Record<string, number> {
  const re = new RegExp(`\\[data-text-size='${id}'\\]\\s*\\{([^}]*)\\}`);
  const body = re.exec(css)?.[1] ?? '';
  const out: Record<string, number> = {};
  for (const m of body.matchAll(/--(fs-[\w-]+)\s*:\s*(\d+(?:\.\d+)?)px/g)) out[m[1]] = Number(m[2]);
  return out;
}

/** Умолчание (md) живёт в :root — отдельного блока у него нет. */
function rootScale(): Record<string, number> {
  const body = /:root\s*\{([\s\S]*?)\n\}/.exec(css)?.[1] ?? '';
  const out: Record<string, number> = {};
  for (const m of body.matchAll(/--(fs-[\w-]+)\s*:\s*(\d+(?:\.\d+)?)px/g)) out[m[1]] = Number(m[2]);
  return out;
}

const STEPS = ['fs-2xs', 'fs-xs', 'fs-sm', 'fs-base', 'fs-md', 'fs-lg', 'fs-xl', 'fs-2xl'] as const;

describe('S4-16 · шкала текста: есть шаг крупнее «крупного»', () => {
  it('положительный контроль: разбор CSS видит прежние шкалы', () => {
    expect(rootScale()['fs-base']).toBe(12);
    expect(scaleOf('lg')['fs-base']).toBe(14);
  });

  it('xl объявлен в наборе и в контракте настроек', () => {
    expect(TEXT_SIZES).toContain('xl');
    expect(DEFAULT_DISPLAY.textSize).toBe('md');
    expect(displayAttrs({ textSize: 'xl', stripes: true })['data-text-size']).toBe('xl');
  });

  it('у xl есть своя шкала в seidr.css, и она КРУПНЕЕ lg на каждой ступени', () => {
    const lg = scaleOf('lg');
    const xl = scaleOf('xl');
    expect(Object.keys(xl).length).toBeGreaterThan(0);
    for (const step of STEPS) {
      expect(xl[`${step}`], `${step}: xl должен быть крупнее lg`).toBeGreaterThan(lg[`${step}`]);
    }
  });

  it('порядок шкал не перепутан: sm < md < lg < xl по основному тексту', () => {
    const base = (s: Record<string, number>) => s['fs-base'];
    expect(base(scaleOf('sm'))).toBeLessThan(base(rootScale()));
    expect(base(rootScale())).toBeLessThan(base(scaleOf('lg')));
    expect(base(scaleOf('lg'))).toBeLessThan(base(scaleOf('xl')));
  });

  it('порог поля ввода на сенсоре шкала НЕ трогает — это не вкус, а правило iOS', () => {
    // iOS приближает страницу при фокусе на поле со шрифтом меньше 16px.
    // Личный масштаб не должен уводить это число вниз, и вверх тоже незачем.
    for (const id of ['sm', 'lg', 'xl']) {
      expect(scaleOf(id)['fs-touch-input'], id).toBeUndefined();
    }
  });
});
