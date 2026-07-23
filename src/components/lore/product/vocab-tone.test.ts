import { describe, it, expect } from 'vitest';
import { ucStatusTone } from './vocab';

describe('PL-20 · тон статуса сценария', () => {
  it('in_rework предупреждает, а не выглядит нейтральным', () => {
    // Главный случай задачи: выпущенный сценарий, у которого снова открылись
    // задачи (D17). Нейтральный тон читался бы «ещё не начали», хотя всё
    // наоборот — сделали и переделываем. Ради этого различия статус и заведён.
    expect(ucStatusTone('in_rework')).toBe('warn');
    expect(ucStatusTone('in_rework')).not.toBe(ucStatusTone('proposed'));
  });

  it('выпущенный и в работе различимы', () => {
    expect(ucStatusTone('shipped')).toBe('ok');
    expect(ucStatusTone('active')).toBe('act');
  });

  it('неизвестное и пустое — нейтрально, без падения', () => {
    expect(ucStatusTone(null)).toBe('muted');
    expect(ucStatusTone('archived')).toBe('muted');
  });

  it('регистр не важен — статусы приходят из корпуса как есть', () => {
    expect(ucStatusTone('IN_REWORK')).toBe('warn');
  });
});
