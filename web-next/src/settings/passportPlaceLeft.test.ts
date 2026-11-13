// MP2-14-PLACE-LEFT: «влево» — такое же место, как остальные: из настройки и из адреса.
import { describe, expect, it } from 'vitest';
import { appliedPassportPlace } from './applied';
import { settingsFromServer } from '../api/liveS2';

describe('MP2-14 · место «слева» в настройке', () => {
  it('применённая настройка left читается как left', () => {
    const at = (v: string | null) => ({ getAttribute: (n: string) => (n === 'data-passport-place' ? v : null) });
    expect(appliedPassportPlace(at('left'))).toBe('left');
    expect(appliedPassportPlace(at('мусор'))).toBeUndefined();
  });
  it('сервер хранит left — клиент не подменяет умолчанием', () => {
    const r = settingsFromServer({ passport_place: 'left' });
    expect(r.settings.passport_place).toBe('left');
  });
});
