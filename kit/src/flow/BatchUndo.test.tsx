// @vitest-environment jsdom
// Пачка как объект: «Отменить · 9 с» (SPRINT_UXR_S10_SEIDR_KIT_2/K2-BATCH-UNDO).
//
// Повод — слова владелицы 09.11.2026: «задачи по элементам новым [во] второй
// спринт разделом новым… по админ».
//
// Что в kit БЫЛО: отмена ОДНОГО перехода статуса (`core/useStatusChange.ts`).
// Чего не было: окна отмены с видимым остатком, отмены ПАЧКИ и названного
// частичного отказа. Это не «подкрутить существующее» — другой объект:
// операция с идентификатором.
//
// Зачем: одно нажатие меняет сразу несколько записей. Отмена по одному значит,
// что после ошибки надо вспомнить, что именно применилось, и снять по очереди —
// то есть отмены фактически нет.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { BatchUndo, type BatchResult } from './BatchUndo';

const T0 = Date.UTC(2026, 10, 10, 12, 0, 0);

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(T0); });
afterEach(() => { vi.useRealTimers(); });

const batch = (over: Partial<BatchResult> = {}): BatchResult => ({
  id: 'op-1',
  applied: 3,
  total: 3,
  undoUntil: T0 + 10_000,
  ...over,
});

const undo = () => screen.getByTestId('kit-batch-undo');
/** Протикать N мс так, как это делает браузер (с перерисовкой). */
const tick = (ms: number) => act(() => { vi.advanceTimersByTime(ms); });

describe('K2-BATCH-UNDO · окно отмены с видимым остатком', () => {
  it('положительный контроль: кнопка отмены есть и показывает остаток', () => {
    render(<BatchUndo batch={batch()} onUndo={() => {}} />);
    expect(undo().textContent).toMatch(/10/);
  });

  it('остаток уменьшается — без цифры человек не знает, успеет ли', () => {
    render(<BatchUndo batch={batch()} onUndo={() => {}} />);
    tick(3000);
    expect(undo().textContent).toMatch(/7/);
  });

  it('окно закрылось — кнопки НЕТ, а не осталась неработающей', () => {
    render(<BatchUndo batch={batch()} onUndo={() => {}} />);
    tick(10_500);
    expect(screen.queryByTestId('kit-batch-undo')).toBeNull();
  });

  it('и сказано, что окно закрылось: след операции не исчезает молча', () => {
    render(<BatchUndo batch={batch()} onUndo={() => {}} />);
    tick(10_500);
    expect(screen.getByTestId('kit-batch-expired').textContent?.trim()).not.toBe('');
  });

  it('отмены не предлагали вовсе — это НЕ «окно закрылось», и текст другой', () => {
    render(<BatchUndo batch={batch({ undoUntil: null })} onUndo={() => {}} />);
    expect(screen.queryByTestId('kit-batch-undo')).toBeNull();
    expect(screen.queryByTestId('kit-batch-expired')).toBeNull();
    expect(screen.getByTestId('kit-batch-noundo').textContent?.trim()).not.toBe('');
  });
});

describe('K2-BATCH-UNDO · отмена возвращает ВСЮ пачку', () => {
  it('нажатие отдаёт приложению идентификатор операции, а не строку', () => {
    const onUndo = vi.fn();
    render(<BatchUndo batch={batch()} onUndo={onUndo} />);
    fireEvent.click(undo());
    expect(onUndo).toHaveBeenCalledWith('op-1');
  });

  it('идёт отмена — кнопка занята и повторно не стреляет', () => {
    const onUndo = vi.fn();
    render(<BatchUndo batch={batch()} onUndo={onUndo} undoing />);
    fireEvent.click(undo());
    expect(onUndo).not.toHaveBeenCalled();
    expect(undo().getAttribute('aria-disabled')).toBe('true');
  });

  it('отмена не удалась — отказ НАЗВАН, а не тишина', () => {
    render(<BatchUndo batch={batch()} onUndo={() => {}} undoError="окно отмены уже закрылось на сервере" />);
    expect(screen.getByTestId('kit-batch-undofail').textContent).toContain('окно отмены уже закрылось');
  });

  it('отмена прошла — сказано, что пачка отменена, и кнопки больше нет', () => {
    render(<BatchUndo batch={batch()} onUndo={() => {}} undone />);
    expect(screen.queryByTestId('kit-batch-undo')).toBeNull();
    expect(screen.getByTestId('kit-batch-undone').textContent?.trim()).not.toBe('');
  });
});

describe('K2-BATCH-UNDO · частичный отказ назван', () => {
  const partial = () => batch({
    applied: 2,
    total: 3,
    failed: [{ id: 'x', text: 'третья строка', reason: 'источник отказал: 409' }],
  });

  it('«применилось 2 из 3» — числом, а не «успешно»', () => {
    render(<BatchUndo batch={partial()} onUndo={() => {}} />);
    const said = screen.getByTestId('kit-batch-summary').textContent ?? '';
    expect(said).toMatch(/2/);
    expect(said).toMatch(/3/);
  });

  it('что именно не применилось и почему — на экране', () => {
    render(<BatchUndo batch={partial()} onUndo={() => {}} />);
    expect(screen.getByText(/третья строка/)).toBeTruthy();
    expect(screen.getByText(/409/)).toBeTruthy();
  });

  it('частичный отказ помечает всю пачку: молчаливое «успешно» — худший исход', () => {
    render(<BatchUndo batch={partial()} onUndo={() => {}} />);
    expect(screen.getByTestId('kit-batch').getAttribute('data-outcome')).toBe('partial');
  });

  it('всё применилось — отметка другая, и список отказов пуст', () => {
    render(<BatchUndo batch={batch()} onUndo={() => {}} />);
    expect(screen.getByTestId('kit-batch').getAttribute('data-outcome')).toBe('applied');
    expect(screen.queryByTestId('kit-batch-failed')).toBeNull();
  });

  it('не применилось ничего — это третий исход, а не «частично»', () => {
    render(<BatchUndo batch={batch({ applied: 0, total: 3, failed: [{ id: 'y', text: 'строка', reason: 'нет прав' }] })} onUndo={() => {}} />);
    expect(screen.getByTestId('kit-batch').getAttribute('data-outcome')).toBe('none');
  });
});

describe('K2-BATCH-UNDO · граница K-14 и часы', () => {
  it('в элементе нет предметных имён: что за изменения — знает приложение', async () => {
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const src = readFileSync(join(process.cwd(), 'src/flow/BatchUndo.tsx'), 'utf8');
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    for (const word of ['проект', 'роль', 'keycloak', 'forgejo', 'агент', 'спринт', 'человек']) {
      expect(code.toLowerCase(), `в коде пачки встречается «${word}»`).not.toContain(word);
    }
  });

  it('срок приходит СТРОКОЙ ISO — тоже понимается, часы не выдумываются', () => {
    render(<BatchUndo batch={batch({ undoUntil: new Date(T0 + 5000).toISOString() })} onUndo={() => {}} />);
    expect(undo().textContent).toMatch(/5/);
  });

  it('срок в прошлом (ответ пришёл с задержкой) — окно сразу закрыто, а не «−3 с»', () => {
    render(<BatchUndo batch={batch({ undoUntil: T0 - 3000 })} onUndo={() => {}} />);
    expect(screen.queryByTestId('kit-batch-undo')).toBeNull();
    expect(screen.getByTestId('kit-batch-expired')).toBeTruthy();
  });

  it('непонятный срок — не ноль и не «сейчас»: сказано, что срока не поняли', () => {
    render(<BatchUndo batch={batch({ undoUntil: 'не дата' })} onUndo={() => {}} />);
    expect(screen.queryByTestId('kit-batch-undo')).toBeNull();
    expect(screen.getByTestId('kit-batch-badtime').textContent?.trim()).not.toBe('');
  });
});
