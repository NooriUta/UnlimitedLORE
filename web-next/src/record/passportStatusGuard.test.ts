// S4-18 (приёмка препрода 14.11.2026, S3-18): в паспорте «Готово к деплою» → «UAT» сменилось сразу —
// без подтверждения и без «Отменить». По задаче «Отменить» — по умолчанию, подтверждение —
// личной настройкой. В оболочке (v2Config) и таблице задач так и было; паспорт собирал статусы
// своим loreStatuses() без этих флагов.
import { describe, expect, it } from 'vitest';
import { loreStatuses } from './loreRecord';

describe('S4-18 · паспорт: «Отменить» по умолчанию, подтверждение — настройкой', () => {
  it('статусы паспорта несут undo и правило подтверждения, как оболочка', () => {
    const s = loreStatuses('ru');
    expect(s.undo).toBe(true);
    expect(typeof s.confirmChange).toBe('boolean');
    expect(s.selfApprove).toBe(false);
  });
});
