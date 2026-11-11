// @vitest-environment jsdom
// Место показа записи — личная настройка (SPRINT_UXR_S4_UI_SHELL_LISTS/S4-24,
// пересечение с S4-17: «одна настройка на обе панели, не две»).
//
// Сервер настройку УЖЕ хранит (LoreMePrefs: passport_place auto|right|bottom|
// full), а клиент её не знал: выбрать «снизу» было негде. Одна правда:
// настройка сервера → атрибут на корне → экран читает применённое (applied.ts).
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { DEFAULT_SETTINGS, validateSettingsPatch } from '../api/contracts/s2';
import { applySettings } from './applySettings';
import { appliedPassportPlace } from './applied';
import { PersonalSettings } from './PersonalSettings';

const host = () => {
  const attrs = new Map<string, string>();
  return {
    getAttribute: (n: string) => attrs.get(n) ?? null,
    setAttribute: (n: string, v: string) => { attrs.set(n, v); },
    removeAttribute: (n: string) => { attrs.delete(n); },
  };
};

describe('S4-24 · passport_place', () => {
  it('auto по умолчанию; четыре значения сервера; чужое — отказ', () => {
    expect(DEFAULT_SETTINGS.passport_place).toBe('auto');
    for (const v of ['auto', 'right', 'bottom', 'full'] as const) expect(validateSettingsPatch({ passport_place: v })).toEqual([]);
    expect(validateSettingsPatch({ passport_place: 'left' as never })).toEqual(['passport_place']);
  });

  it('выбор ложится атрибутом на корень; auto — атрибута нет', () => {
    const h = host();
    applySettings(h as never, { ...DEFAULT_SETTINGS, passport_place: 'bottom' });
    expect(h.getAttribute('data-passport-place')).toBe('bottom');
    applySettings(h as never, { ...DEFAULT_SETTINGS, passport_place: 'auto' });
    expect(h.getAttribute('data-passport-place')).toBeNull();
  });

  it('применённое читается; не выбирал или мусор — undefined (решает экран)', () => {
    const at = (v: string | null) => ({ getAttribute: (n: string) => (n === 'data-passport-place' ? v : null) });
    expect(appliedPassportPlace(at(null))).toBeUndefined();
    expect(appliedPassportPlace(at('bottom'))).toBe('bottom');
    expect(appliedPassportPlace(at('right'))).toBe('right');
    expect(appliedPassportPlace(at('full'))).toBe('full');
    expect(appliedPassportPlace(at('left'))).toBeUndefined();
  });

  it('в панели настроек есть строка «Где открывать запись» с вариантами', () => {
    const ok = { status: 'ok' as const, settings: DEFAULT_SETTINGS, version: 1, saving: false };
    render(<PersonalSettings lang="ru" state={ok} onChange={() => {}} navTargetUrl={null} />);
    expect(screen.getAllByText('Где открывать запись').length).toBeGreaterThan(0);
    for (const label of ['Справа', 'Снизу', 'Во весь экран']) {
      expect(screen.getAllByText(label).length, label).toBeGreaterThan(0);
    }
  });
});
