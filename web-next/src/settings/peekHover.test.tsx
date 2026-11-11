// @vitest-environment jsdom
// Выключатель карточек Peek по наведению (SPRINT_UXR_S10_SEIDR_KIT_2/S9-10, D-2026-LORE-PEEK-ONE-CARD, P1а:
// «с выключателем в настройках»; Wikipedia даёт такой же). Одна правда: настройка сервера → атрибут
// на корне → экраны читают атрибут (applied.ts), а не своё хранилище.
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { DEFAULT_SETTINGS, validateSettingsPatch } from '../api/contracts/s2';
import { applySettings } from './applySettings';
import { appliedPeekHover } from './applied';
import { PersonalSettings } from './PersonalSettings';

const host = () => {
  const attrs = new Map<string, string>();
  return {
    getAttribute: (n: string) => attrs.get(n) ?? null,
    setAttribute: (n: string, v: string) => { attrs.set(n, v); },
    removeAttribute: (n: string) => { attrs.delete(n); },
  };
};

describe('peek_hover', () => {
  it('по умолчанию включено, патч сервер примет', () => {
    expect(DEFAULT_SETTINGS.peek_hover).toBe(true);
    expect(validateSettingsPatch({ peek_hover: false })).toEqual([]);
  });
  it('выключено → data-peek-hover="off" на корне; включено — атрибута нет', () => {
    const h = host();
    applySettings(h as never, { ...DEFAULT_SETTINGS, peek_hover: false });
    expect(h.getAttribute('data-peek-hover')).toBe('off');
    applySettings(h as never, { ...DEFAULT_SETTINGS, peek_hover: true });
    expect(h.getAttribute('data-peek-hover')).toBeNull();
  });
  it('экраны читают применённое: нет атрибута — включено (молчание ≠ выключено)', () => {
    expect(appliedPeekHover({ getAttribute: () => null })).toBe(true);
    expect(appliedPeekHover({ getAttribute: n => (n === 'data-peek-hover' ? 'off' : null) })).toBe(false);
  });
  it('в панели настроек есть строка выключателя', () => {
    const ok = { status: 'ok' as const, settings: DEFAULT_SETTINGS, version: 1, saving: false };
    render(<PersonalSettings lang="ru" state={ok} onChange={() => {}} navTargetUrl={null} />);
    expect(screen.getAllByText('Карточки по наведению').length).toBeGreaterThan(0);
  });
});
