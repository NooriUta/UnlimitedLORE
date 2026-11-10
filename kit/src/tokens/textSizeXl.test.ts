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

const cssRaw = readFileSync(`${process.cwd()}/src/styles/seidr.css`, 'utf8');
const css = cssRaw.replace(/\/\*[\s\S]*?\*\//g, '');

/**
 * Множитель ступени (S4-16, 10.11.2026: ось размера одна).
 *
 * До этого у каждой ступени был свой блок пикселей, и сторож сравнивал числа
 * ступень к ступени. Теперь ступень задаёт один множитель `--fs-k`, а кегли
 * считаются от него в :root — значит «крупнее на каждой ступени» выражается
 * одним числом, и сравнивать надо его.
 */
function kOf(id: string): number | null {
  const re = new RegExp(`\\[data-text-size='${id}'\\]\\s*\\{([^}]*)\\}`);
  const body = re.exec(css)?.[1] ?? '';
  const m = /--fs-k\s*:\s*(\d+(?:\.\d+)?)/.exec(body);
  return m ? Number(m[1]) : null;
}

/** Умолчание (md) живёт в :root — отдельного блока у него нет. */
function rootK(): number {
  const body = /:root\s*\{([\s\S]*?)\n\}/.exec(css)?.[1] ?? '';
  const m = /--fs-k\s*:\s*(\d+(?:\.\d+)?)/.exec(body);
  return m ? Number(m[1]) : Number.NaN;
}

/** Ступени шкалы, считаемые от множителя в :root. */
function rootSteps(): string[] {
  const body = /:root\s*\{([\s\S]*?)\n\}/.exec(css)?.[1] ?? '';
  return [...body.matchAll(/(--fs-[\w-]+)\s*:/g)].map(m => m[1]).filter(n => n !== '--fs-k' && n !== '--fs-touch-input');
}

describe('S4-16 · шкала текста: есть шаг крупнее «крупного»', () => {
  it('положительный контроль: разбор CSS видит ось и ступени', () => {
    expect(rootK(), 'множителя в :root нет — ось размера пропала').toBe(1);
    expect(kOf('lg'), 'ступень lg не задаёт множитель').toBeGreaterThan(1);
    expect(rootSteps().length, 'кегли шкалы не найдены').toBeGreaterThan(5);
  });

  it('xl объявлен в наборе и в контракте настроек', () => {
    expect(TEXT_SIZES).toContain('xl');
    expect(DEFAULT_DISPLAY.textSize).toBe('md');
    expect(displayAttrs({ textSize: 'xl', stripes: true })['data-text-size']).toBe('xl');
  });

  it('xl крупнее lg — и, значит, крупнее на КАЖДОЙ ступени шкалы', () => {
    const lg = kOf('lg');
    const xl = kOf('xl');
    expect(lg, 'ступень lg пропала').not.toBeNull();
    expect(xl, 'ступень xl пропала').not.toBeNull();
    // Кегли считаются от множителя, поэтому одно это сравнение покрывает всю
    // шкалу разом: отдельной «своей шкалы» у ступени больше нет.
    expect(xl!, 'xl должен быть крупнее lg').toBeGreaterThan(lg!);
    for (const name of rootSteps()) {
      expect(cssRaw, `${name} считается мимо множителя — ступень его не изменит`).toMatch(
        new RegExp(`${name}\\s*:\\s*calc\\([^;]*var\\(--fs-k\\)`),
      );
    }
  });

  it('порядок ступеней не перепутан: sm < md < lg < xl', () => {
    const sm = kOf('sm')!;
    const md = rootK();
    const lg = kOf('lg')!;
    const xl = kOf('xl')!;
    expect(sm).toBeLessThan(md);
    expect(md).toBeLessThan(lg);
    expect(lg).toBeLessThan(xl);
  });

  it('порог поля ввода на сенсоре шкала НЕ трогает — это не вкус, а правило iOS', () => {
    // iOS приближает страницу при фокусе на поле со шрифтом меньше 16px.
    // Личный масштаб не должен уводить это число вниз, и вверх тоже незачем.
    // Ступень задаёт ТОЛЬКО множитель, поэтому порога в ней быть не может…
    for (const id of ['sm', 'lg', 'xl']) {
      const body = new RegExp(`\\[data-text-size='${id}'\\]\\s*\\{([^}]*)\\}`).exec(css)?.[1] ?? '';
      expect(body, id).not.toContain('fs-touch-input');
    }
    // …и сам порог не считается от множителя: число постоянное.
    expect(css).toMatch(/--fs-touch-input\s*:\s*16px/);
  });
});
