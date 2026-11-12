// @vitest-environment jsdom
// SPRINT_UXR_S4_UI_SHELL_LISTS/S4-TECH-NOTES — «Показывать технические сведения».
//
// Повод — владелица 11.11.2026: «пользователей пугают… непереваренные метрики…
// сделайте опциональным отображение через кнопку или ручку в настройках».
// Здесь — путь настройки: контракт S2 (/lore/me/settings, ключ show_tech),
// панель настроек, корень документа и общий выключатель kit, который читают
// блоки с тегом tech. ЧТО считать техническим — решает приложение (не kit).
import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { TechGate } from '@seidr/kit';
import { DEFAULT_SETTINGS, validateSettingsPatch, type UserSettings } from '../api/contracts/s2';
import { patchToServer, settingsFromServer } from '../api/liveS2';
import { applySettings } from './applySettings';
import { appliedShowTech } from './applied';
import { ShowTechFromSettings } from './ShowTech';
import { PersonalSettings } from './PersonalSettings';
import { MESSAGES } from '../i18n/messages';
import { ModelNotes } from '../record/ModelNotes';
import type { CookieJar } from '../storage/storage';

const ru = MESSAGES.ru;
const jar = (): CookieJar => { let c = ''; return { read: () => c, write: (x: string) => { c = x.split(';')[0]; } }; };
const S = (p: Partial<UserSettings> = {}): UserSettings => ({ ...DEFAULT_SETTINGS, ...p });

describe('S4-TECH-NOTES · настройка в профиле', () => {
  it('умолчание — выключено: обычный пользователь технического не видит', () => {
    expect(DEFAULT_SETTINGS.show_tech).toBe(false);
    expect(validateSettingsPatch({ show_tech: true })).toEqual([]);
    expect(validateSettingsPatch({ show_tech: 'yes' as unknown as boolean })).toEqual(['show_tech']);
  });

  it('ключ сервера — show_tech, в обе стороны', () => {
    expect(patchToServer({ show_tech: true })).toEqual({ show_tech: true });
    expect(settingsFromServer({ show_tech: true }).settings.show_tech).toBe(true);
    expect(settingsFromServer({}).settings.show_tech).toBe(false);
  });

  it('применяется атрибутом корня и читается оттуда же', () => {
    const el = document.createElement('div');
    applySettings(el, S({ show_tech: true }), jar());
    expect(el.getAttribute('data-show-tech')).toBe('on');
    expect(appliedShowTech(el)).toBe(true);
    applySettings(el, S(), jar());
    expect(el.hasAttribute('data-show-tech')).toBe(false);
    expect(appliedShowTech(el)).toBe(false);
  });

  it('строка в личных настройках меняет show_tech', () => {
    const onChange = vi.fn();
    render(<PersonalSettings lang="ru" state={{ status: 'ready', settings: S(), saving: false } as never} onChange={onChange} navTargetUrl={null} />);
    const grp = screen.getByRole('group', { name: ru['settings.showTech.label'] });
    fireEvent.click(grp.querySelector('button[aria-pressed="false"]')!);
    expect(onChange).toHaveBeenCalledWith({ show_tech: true });
  });
});

describe('S4-TECH-NOTES · общий выключатель следует за корнем', () => {
  it('включили настройку — tech-блоки показываются без кнопки, выключили — снова скрыты', async () => {
    const root = document.createElement('div');
    render(<ShowTechFromSettings root={root}><TechGate><p>код источника</p></TechGate></ShowTechFromSettings>);
    expect(screen.queryByText('код источника')).toBeNull();
    await act(async () => { root.setAttribute('data-show-tech', 'on'); await Promise.resolve(); });
    expect(screen.getByText('код источника')).toBeTruthy();
    await act(async () => { root.removeAttribute('data-show-tech'); await Promise.resolve(); });
    expect(screen.queryByText('код источника')).toBeNull();
  });
});

describe('S4-TECH-NOTES · оговорки модели — tech', () => {
  const notes = ['порядок разделов — умолчание приложения: модель недоступна (HTTP 503)'];

  it('по умолчанию оговорок не видно, на месте — кнопка «тех. модели» и сводка «⚠ N»', () => {
    render(<ModelNotes notes={notes} />);
    expect(screen.queryByText(notes[0])).toBeNull();
    expect(screen.queryByText(/оговор/i)).toBeNull();
    // Свёрнутое не молчит: число оговорок стоит у кнопки, подпись отличает
    // её от чипа «тех. данных» блока «Состояние данных».
    expect(screen.getByText('⚠ 1')).toBeTruthy();
    const btn = screen.getByRole('button', { name: /техническ/i });
    expect(btn.textContent).toBe('тех. модели');
    fireEvent.click(btn);
    expect(screen.getByText(/оговор/i)).toBeTruthy();
  });

  it('с настройкой — прежний шеврон «⚠ N» на своём месте', () => {
    const root = document.createElement('div');
    root.setAttribute('data-show-tech', 'on');
    render(<ShowTechFromSettings root={root}><ModelNotes notes={notes} /></ShowTechFromSettings>);
    expect(screen.getByText(/оговор/i)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /техническ/i })).toBeNull();
  });
});
