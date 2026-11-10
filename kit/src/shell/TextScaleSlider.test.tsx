// @vitest-environment jsdom
// Ползунок размера текста (SPRINT_UXR_S4_UI_SHELL_LISTS/S4-16).
//
// Решение владелицы 10.11.2026, дословно: «не а на мобилке даже покрупнее
// сделайте вообще ползунок с сохранением множителя поставьте в настройках я
// скажу сколько мин макс оставить после выкатки».
//
// Отдельно записываю, как этот файл появился: сначала я сделала быстрые
// A− / A+ по существующей оси ступеней, и это было НЕ то, что она просила.
// Кнопки сняты, остался ползунок.
//
// Правило, которое держит файл: ось размера ОДНА. Ступени sm/md/lg/xl стали
// предустановками того же множителя (согласовано с серверной сессией), и в
// теме не осталось второго способа задать кегль. Размер, заданный в двух
// местах, даёт человеку два разных ответа на один вопрос.
import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fireEvent, render, screen } from '@testing-library/react';
import { KitLangProvider } from '../i18n';
import {
  TEXT_SCALE_DEFAULT, TEXT_SCALE_MAX, TEXT_SCALE_MIN, TEXT_SCALE_STEP,
  applyTextScale, clampTextScale,
} from '../core/textScale';
import { TextScaleSlider } from './TextScaleSlider';

const css = readFileSync(join(process.cwd(), 'src/styles/seidr.css'), 'utf8');

const show = (value: number, onChange = vi.fn()) => {
  render(<KitLangProvider lang="ru"><TextScaleSlider value={value} onChange={onChange} /></KitLangProvider>);
  return onChange;
};
const range = () => screen.getByRole('slider') as HTMLInputElement;

describe('S4-16 · границы и шаг множителя', () => {
  it('положительный контроль: границы названы и умолчание между ними', () => {
    expect(TEXT_SCALE_MIN).toBeLessThan(TEXT_SCALE_DEFAULT);
    expect(TEXT_SCALE_MAX).toBeGreaterThan(TEXT_SCALE_DEFAULT);
    expect(TEXT_SCALE_STEP).toBeGreaterThan(0);
  });

  it('значение вне границ ПРИЖИМАЕТСЯ, а не отвергается', () => {
    // Человек приедет со старым числом после сужения границ: отказ он прочтёт
    // как поломку настроек, а прижатие — как «подвинули к краю».
    expect(clampTextScale(0.1)).toBe(TEXT_SCALE_MIN);
    expect(clampTextScale(9)).toBe(TEXT_SCALE_MAX);
  });

  it('непонятное значение — «выбора не было», а не «мелко»', () => {
    expect(clampTextScale(undefined)).toBe(TEXT_SCALE_DEFAULT);
    expect(clampTextScale('крупно')).toBe(TEXT_SCALE_DEFAULT);
    expect(clampTextScale(Number.NaN)).toBe(TEXT_SCALE_DEFAULT);
  });

  it('значение округляется до шага — в настройках не копится 1.2000000000000002', () => {
    const v = clampTextScale(1.23);
    expect(Math.abs(v / TEXT_SCALE_STEP - Math.round(v / TEXT_SCALE_STEP))).toBeLessThan(1e-9);
  });
});

describe('S4-16 · запись множителя в корень', () => {
  const root = () => {
    const props = new Map<string, string>();
    const attrs = new Map<string, string>();
    return {
      props, attrs,
      style: {
        setProperty: (n: string, v: string) => { props.set(n, v); },
        removeProperty: (n: string) => { props.delete(n); },
      },
      setAttribute: (n: string, v: string) => { attrs.set(n, v); },
      removeAttribute: (n: string) => { attrs.delete(n); },
    };
  };

  it('выбранный множитель доезжает до переменной темы', () => {
    const r = root();
    applyTextScale(r, 1.25);
    expect(r.props.get('--fs-k')).toBe('1.25');
    expect(r.attrs.get('data-text-scale')).toBe('1.25');
  });

  it('умолчание СНИМАЕТ свойство: «не выбирал» и «выбрал 100%» — разные вещи', () => {
    const r = root();
    applyTextScale(r, 1.25);
    applyTextScale(r, 1);
    expect(r.props.has('--fs-k'), 'умолчание записано значением — снаружи не отличить от выбора').toBe(false);
    expect(r.attrs.has('data-text-scale')).toBe(false);
  });

  it('документа нет — не падаем (сервер, тесты)', () => {
    expect(applyTextScale(null, 1.4)).toBe(1.4);
  });
});

describe('S4-16 · сам ползунок', () => {
  it('положительный контроль: ползунок на экране, с подписью и границами', () => {
    show(1);
    const el = range();
    expect(el.min).toBe(String(TEXT_SCALE_MIN));
    expect(el.max).toBe(String(TEXT_SCALE_MAX));
    expect(el.step).toBe(String(TEXT_SCALE_STEP));
    expect(el.getAttribute('aria-label')).toMatch(/размер текста/i);
  });

  it('движение отдаёт выбранное значение наружу — хранит его приложение', () => {
    const onChange = show(1);
    fireEvent.change(range(), { target: { value: '1.25' } });
    expect(onChange).toHaveBeenCalledWith(1.25);
  });

  it('значение показано процентами — доля «1.25» человеку ничего не говорит', () => {
    show(1.25);
    expect(screen.getByTestId('kit-text-scale').textContent).toContain('125');
    expect(range().getAttribute('aria-valuetext')).toContain('125');
  });

  it('пришло значение вне границ — ползунок показывает край, а не ломается', () => {
    show(9);
    expect(Number(range().value)).toBe(TEXT_SCALE_MAX);
  });
});

describe('S4-16 · ось размера одна', () => {
  it('ступени размера задают тот же множитель, а не свои пиксели', () => {
    for (const step of ['sm', 'lg', 'xl']) {
      const m = new RegExp(`\\[data-text-size='${step}'\\]\\s*\\{([^}]*)\\}`).exec(css);
      expect(m, `блок ступени ${step} пропал`).toBeTruthy();
      expect(m![1], `ступень ${step} задаёт кегли сама — это вторая ось размера`).toMatch(/--fs-k\s*:/);
      // Сам множитель — это и есть ось; ищем ОСТАЛЬНЫЕ токены шкалы.
      expect(m![1], `ступень ${step} всё ещё держит свои пиксели`).not.toMatch(/--fs-(?!k\b)[a-z0-9-]+\s*:\s*\d/);
    }
  });

  it('каждый кегль шкалы считается от множителя — забытый не будет масштабироваться', () => {
    const root = /:root\s*\{([\s\S]*?)\n\}/.exec(css)?.[1] ?? '';
    const forgotten = [...root.matchAll(/(--fs-[a-z0-9-]+)\s*:\s*([^;]+);/g)]
      .filter(([, name]) => name !== '--fs-k' && name !== '--fs-touch-input')
      .filter(([, , value]) => !value.includes('var(--fs-k)'))
      .map(([, name]) => name);
    expect(forgotten, 'эти кегли не масштабируются вместе с остальными').toEqual([]);
  });

  it('цель касания множителем не трогается: палец не растёт вместе с кеглем', () => {
    const root = /:root\s*\{([\s\S]*?)\n\}/.exec(css)?.[1] ?? '';
    const tap = /--tap\s*:\s*([^;]+);/.exec(root)?.[1] ?? '';
    expect(tap, 'не нашли --tap').toBeTruthy();
    expect(tap, 'цель касания привязана к размеру текста').not.toContain('var(--fs-k)');
  });

  it('порог поля ввода на сенсоре масштаб НЕ трогает — это правило iOS', () => {
    // Решение принято раньше и здесь только подтверждается: при кегле меньше
    // 16px iOS приближает страницу на фокусе, и человек теряет из виду то,
    // что заполняет. Это не вкус, поэтому и вверх его не ведём.
    const root = /:root\s*\{([\s\S]*?)\n\}/.exec(css)?.[1] ?? '';
    const v = /--fs-touch-input\s*:\s*([^;]+);/.exec(root)?.[1] ?? '';
    expect(v.trim(), 'порог стал зависеть от масштаба').toBe('16px');
  });
});
