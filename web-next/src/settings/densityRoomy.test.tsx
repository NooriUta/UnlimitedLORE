// @vitest-environment jsdom
// SPRINT_UXR_S4_UI_SHELL_LISTS/S4-21 (волна 1a): плотность roomy — по умолчанию (решение владелицы 08.11),
// compact и comfortable остаются выбором в личных настройках.
//
// Ловушка миграции: заглушка /lore/me/settings хранит ВЕСЬ снимок настроек, а
// не только тронутые ключи. Поэтому у каждого, кто хоть раз менял тему, в
// хранилище лежит density: 'compact' — прежнее умолчание, а не его выбор.
// Без миграции новое умолчание не увидел бы никто, включая владелицу.
// Снимок без метки схемы (до S4-21) с 'compact' → 'roomy'; после первой
// записи метка ставится, и явный выбор compact дальше уважается.
import { beforeAll, describe, expect, it } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import gameIcons from '@iconify-json/game-icons/icons.json';
import { createSafeStorage, registerGameIcons } from '@seidr/kit';
import { createLocalS2Client, SETTINGS_KEY } from '../api/me';
import { DEFAULT_SETTINGS, validateSettingsPatch } from '../api/contracts/s2';
import { applySettings } from './applySettings';
import { AccountMenu } from './AccountMenu';
import { MESSAGES } from '../i18n/messages';
import type { CookieJar } from '../storage/storage';

beforeAll(() => { registerGameIcons(gameIcons); });

const ru = MESSAGES.ru;
const mem = () => createSafeStorage(() => {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => { m.set(k, v); },
    removeItem: (k: string) => { m.delete(k); },
  } as unknown as Storage;
});
const jar = (): CookieJar => { let c = ''; return { read: () => c, write: (v: string) => { c = v.split(';')[0]; } }; };

describe('контракт: roomy — значение и умолчание', () => {
  it('умолчание — roomy, все три значения проходят проверку', () => {
    expect(DEFAULT_SETTINGS.density).toBe('roomy');
    for (const d of ['roomy', 'compact', 'comfortable'] as const) expect(validateSettingsPatch({ density: d })).toEqual([]);
    expect(validateSettingsPatch({ density: 'huge' as never })).toEqual(['density']);
  });

  it('roomy = :root kit — атрибута нет; compact — атрибут compact', () => {
    const el = document.createElement('div');
    applySettings(el, { ...DEFAULT_SETTINGS, density: 'compact' }, jar());
    expect(el.getAttribute('data-density')).toBe('compact');
    applySettings(el, { ...DEFAULT_SETTINGS }, jar());
    expect(el.hasAttribute('data-density')).toBe(false);
  });
});

describe('миграция сохранённого снимка (до S4-21)', () => {
  it('старый снимок без метки схемы с compact — читается как roomy, прочее сохраняется', async () => {
    const storage = mem();
    storage.set(SETTINGS_KEY, JSON.stringify({ settings: { ...DEFAULT_SETTINGS, density: 'compact', text_size: 'lg' }, version: 4 }));
    const r = await createLocalS2Client(storage).getSettings();
    expect(r.settings.density).toBe('roomy');
    expect(r.settings.text_size).toBe('lg');
    expect(r.version).toBe(4);
  });

  it('старый снимок с comfortable — это явный выбор, он остаётся', async () => {
    const storage = mem();
    storage.set(SETTINGS_KEY, JSON.stringify({ settings: { ...DEFAULT_SETTINGS, density: 'comfortable' }, version: 2 }));
    expect((await createLocalS2Client(storage).getSettings()).settings.density).toBe('comfortable');
  });

  it('после записи метка схемы стоит — явный compact больше не мигрирует', async () => {
    const storage = mem();
    storage.set(SETTINGS_KEY, JSON.stringify({ settings: { ...DEFAULT_SETTINGS, density: 'compact' }, version: 3 }));
    const c = createLocalS2Client(storage);
    await c.patchSettings({ patch: { density: 'compact' }, expected_version: 3 });
    expect((await createLocalS2Client(storage).getSettings()).settings.density).toBe('compact');
  });
});

describe('меню аватара: три плотности, roomy выбрана по умолчанию', () => {
  it('кнопка roomy есть и нажата; выбор compact ложится на корень', async () => {
    const root = document.createElement('div');
    render(<AccountMenu client={createLocalS2Client(mem())} root={root} lang="ru" jar={jar()} />);
    fireEvent.click(screen.getByRole('button', { name: /личные настройки/i }));
    const dlg = await screen.findByRole('dialog', { name: ru['settings.title'] });
    const g = await within(dlg).findByRole('group', { name: ru['settings.density.label'] });
    expect(within(g).getByRole('button', { name: ru['settings.density.roomy'] }).getAttribute('aria-pressed')).toBe('true');
    await act(async () => { fireEvent.click(within(g).getByRole('button', { name: ru['settings.density.compact'] })); });
    await waitFor(() => expect(root.getAttribute('data-density')).toBe('compact'));
  });
});
