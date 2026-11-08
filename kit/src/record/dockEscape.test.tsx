// @vitest-environment jsdom
// Аудит навигации 08.11.2026, находка P0: «Esc не закрывает ни палитру, ни док
// (проверено по два раза)». Это первое, что ломает ощущение нормального
// приложения: слой открылся, а выйти из него клавишей нельзя.
//
// Причина у дока была ровно одна: слушатель Esc вешался ТОЛЬКО в полном экране
// и только при наличии onExitFull. В обычном доке (справа, снизу) Esc не
// обрабатывался вовсе — его молча съедала страница. То есть не «Esc сломался»,
// а «Esc там никогда и не было».
//
// Что закрепляем:
//   • Esc в доке справа/снизу — закрывает паспорт;
//   • Esc в полном экране — выходит из полного экрана, а НЕ закрывает запись:
//     это два разных действия, и схлопывать их в одно значит терять запись;
//   • полный экран без onExitFull — Esc закрывает (иначе из слоя нет выхода);
//   • чужой Esc, уже обработанный вложенным слоем (палитра, редактор,
//     поповер), док не перехватывает: иначе Esc в поле правки закрыл бы
//     паспорт вместе с несохранённым текстом.
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { RecordDock } from './RecordDock';

const esc = (init: KeyboardEventInit = {}) => fireEvent.keyDown(document, { key: 'Escape', code: 'Escape', ...init });

describe('Esc в доке — находка P0 аудита 08.11', () => {
  it('положительный контроль: док отрисован и кнопка закрытия на месте', () => {
    render(<RecordDock placement="right" onClose={() => {}}><p>паспорт</p></RecordDock>);
    expect(screen.getByTestId('kit-rec-dock')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Закрыть паспорт' })).toBeTruthy();
  });

  it.each(['right', 'bottom'] as const)('%s: Esc закрывает паспорт', placement => {
    const onClose = vi.fn();
    render(<RecordDock placement={placement} onClose={onClose}><p>паспорт</p></RecordDock>);
    esc();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('полный экран: Esc выходит из полного экрана и НЕ закрывает запись', () => {
    const onClose = vi.fn();
    const onExitFull = vi.fn();
    render(<RecordDock placement="full" onClose={onClose} onExitFull={onExitFull}><p>паспорт</p></RecordDock>);
    esc();
    expect(onExitFull).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('полный экран без выхода из него: Esc закрывает — иначе из слоя не выйти', () => {
    const onClose = vi.fn();
    render(<RecordDock placement="full" onClose={onClose}><p>паспорт</p></RecordDock>);
    esc();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('нечего закрывать — Esc ничего не делает и не падает', () => {
    render(<RecordDock placement="right"><p>паспорт</p></RecordDock>);
    expect(() => esc()).not.toThrow();
  });

  it('Esc, уже обработанный вложенным слоем, док не перехватывает', () => {
    const onClose = vi.fn();
    render(<RecordDock placement="right" onClose={onClose}><p>паспорт</p></RecordDock>);
    // Вложенный редактор/палитра отменили правку и погасили событие.
    const e = new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true, cancelable: true });
    e.preventDefault();
    document.dispatchEvent(e);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('снятый док больше не слушает клавиатуру', () => {
    const onClose = vi.fn();
    const { unmount } = render(<RecordDock placement="right" onClose={onClose}><p>паспорт</p></RecordDock>);
    unmount();
    esc();
    expect(onClose).not.toHaveBeenCalled();
  });
});

// Аудит 08.11, находка P1: «Док: сверху 343 px прозрачного backdrop, ниже
// панель 515 px — пустая треть экрана, список обрывается без затемнения».
//
// Пропорции 2fr/3fr были заданы жёстко, поэтому короткий список оставлял над
// паспортом пустое поле — «дыру». Затемнять список нельзя: владелица 08.11
// решила, что список под паспортом живой (своя прокрутка, щелчок по другой
// записи). Значит убираем пустоту: доля списка — по его содержимому, но не
// больше 40 % высоты дока; остальное забирает паспорт.
describe('док снизу: пустой трети нет', () => {
  const css = readFileSync(`${process.cwd()}/src/styles/seidr.css`, 'utf8');
  const ruleOf = (sel: string) => {
    const start = css.indexOf(`\n${sel} {`);
    return start < 0 ? '' : css.slice(css.indexOf('{', start) + 1, css.indexOf('}', start));
  };

  it('положительный контроль: правило дока снизу найдено', () => {
    expect(ruleOf(".sk-dock[data-placement='bottom']")).not.toBe('');
  });

  it('доля списка — по содержимому, с потолком; остальное паспорту', () => {
    const rule = ruleOf(".sk-dock[data-placement='bottom']");
    expect(rule).toMatch(/fit-content\(/);
    expect(rule).not.toMatch(/2fr/);
  });

  it('список под паспортом не затемняется — он живой (решение владелицы 08.11)', () => {
    expect(ruleOf('.sk-dock__backdrop')).not.toMatch(/opacity|filter|background/);
  });
});
