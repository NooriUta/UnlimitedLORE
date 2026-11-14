// @vitest-environment jsdom
// S4-18 (решение владелицы 14.11.2026): «подтверждение до записи — личной настройкой». По умолчанию
// выключено (статус в 2 касания + 8 с «Вернуть»); включённая — kit спрашивает «A → B?» до записи.
// Одна правда, как у peek_hover: настройка сервера → атрибут корня → экраны читают applied.ts.
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { DEFAULT_SETTINGS, validateSettingsPatch } from '../api/contracts/s2';
import { applySettings } from './applySettings';
import { appliedStatusConfirm } from './applied';
import { PersonalSettings } from './PersonalSettings';
import { v2Config } from '../shell/v2Config';

const host = () => {
  const attrs = new Map<string, string>();
  return {
    getAttribute: (n: string) => attrs.get(n) ?? null,
    setAttribute: (n: string, v: string) => { attrs.set(n, v); },
    removeAttribute: (n: string) => { attrs.delete(n); },
  };
};

describe('status_confirm (S4-18)', () => {
  it('по умолчанию выключено; патч сервер примет', () => {
    expect(DEFAULT_SETTINGS.status_confirm).toBe(false);
    expect(validateSettingsPatch({ status_confirm: true })).toEqual([]);
  });
  it('включено → data-status-confirm="on"; выключено — атрибута нет', () => {
    const h = host();
    applySettings(h as never, { ...DEFAULT_SETTINGS, status_confirm: true });
    expect(h.getAttribute('data-status-confirm')).toBe('on');
    applySettings(h as never, { ...DEFAULT_SETTINGS, status_confirm: false });
    expect(h.getAttribute('data-status-confirm')).toBeNull();
  });
  it('экраны читают применённое: нет атрибута — не спрашивать', () => {
    expect(appliedStatusConfirm({ getAttribute: () => null })).toBe(false);
    expect(appliedStatusConfirm({ getAttribute: n => (n === 'data-status-confirm' ? 'on' : null) })).toBe(true);
  });
  it('конфиг оболочки передаёт настройку в kit (statuses.confirmChange), «Вернуть» включён всегда', () => {
    document.documentElement.setAttribute('data-status-confirm', 'on');
    try {
      const c = v2Config('ru');
      expect(c.statuses.confirmChange).toBe(true);
      expect(c.statuses.undo).toBe(true);
    } finally {
      document.documentElement.removeAttribute('data-status-confirm');
    }
    expect(v2Config('ru').statuses.confirmChange).toBe(false);
  });
  it('в панели настроек есть строка выключателя', () => {
    const ok = { status: 'ok' as const, settings: DEFAULT_SETTINGS, version: 1, saving: false };
    render(<PersonalSettings lang="ru" state={ok} onChange={() => {}} navTargetUrl={null} />);
    expect(screen.getAllByText('Подтверждать смену статуса').length).toBeGreaterThan(0);
  });
});
