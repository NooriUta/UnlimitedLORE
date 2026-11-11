// @vitest-environment jsdom
// Ползунок размера шрифта в личных настройках — сквозь всю цепочку
// (SPRINT_UXR_S4_UI_SHELL_LISTS/S4-21, решение S4-16).
//
// Владелица 11.11.2026 про S4-21: «я жду ползунка для шрифтов». Корень — не в
// ползунке: он есть в kit (TextScaleSlider, решение 10.11 «вообще ползунок с
// сохранением множителя поставьте в настройках»), и сервер хранит `text_scale`
// (LoreMePrefs). Его не подключило приложение: в контракте личных настроек не
// было поля, в «Личных настройках» не было ползунка, к экрану он не применялся.
// «Написано ≠ подключено» — проверяем всю цепочку.
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import gameIcons from '@iconify-json/game-icons/icons.json';
import { registerGameIcons } from '@seidr/kit';
import { DEFAULT_SETTINGS, validateSettingsPatch } from '../api/contracts/s2';
import { patchToServer, settingsFromServer } from '../api/liveS2';
import { applySettings } from './applySettings';
import { PersonalSettings } from './PersonalSettings';

beforeAll(() => { registerGameIcons(gameIcons); });

describe('S4-21 · множитель шрифта — контракт и сервер', () => {
  it('умолчание — 1 («выбора не было»)', () => {
    expect(DEFAULT_SETTINGS.text_scale).toBe(1);
  });

  it('сервер → v2: text_scale читается числом; патч уходит под тем же именем', () => {
    expect(settingsFromServer({ text_scale: 1.25 }).settings.text_scale).toBe(1.25);
    expect(patchToServer({ text_scale: 1.3 })).toEqual({ text_scale: 1.3 });
  });

  it('патч с числом проходит проверку, строка — нет', () => {
    expect(validateSettingsPatch({ text_scale: 1.2 })).toEqual([]);
    expect(validateSettingsPatch({ text_scale: 'big' as unknown as number })).toEqual(['text_scale']);
  });
});

describe('S4-21 · множитель шрифта — экран', () => {
  it('применяется к корню: --fs-k и data-text-scale; 1 — свойство снято', () => {
    const root = document.createElement('div');
    applySettings(root, { ...DEFAULT_SETTINGS, text_scale: 1.25 });
    expect(root.style.getPropertyValue('--fs-k')).toBe('1.25');
    expect(root.getAttribute('data-text-scale')).toBe('1.25');
    applySettings(root, { ...DEFAULT_SETTINGS, text_scale: 1 });
    expect(root.style.getPropertyValue('--fs-k')).toBe('');
  });

  it('в «Личных настройках» есть ползунок; движение уходит изменением text_scale', () => {
    const onChange = vi.fn();
    render(<PersonalSettings lang="ru" state={{ status: 'ok', settings: { ...DEFAULT_SETTINGS }, version: 1, saving: false }} onChange={onChange} onRetry={() => {}} />);
    const slider = screen.getByTestId('kit-text-scale').querySelector('input[type="range"]') as HTMLInputElement;
    expect(slider).toBeTruthy();
    fireEvent.change(slider, { target: { value: '1.2' } });
    expect(onChange).toHaveBeenLastCalledWith({ text_scale: 1.2 });
  });
});
