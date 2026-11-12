// @vitest-environment jsdom
// SPRINT_UXR_S4_UI_SHELL_LISTS/S4-02 — аватар и личные настройки на заглушках
// S2: чтение, ушко, текст, тема, плотность, клавиши, полоски, «что помнит».
// Хранение — по контракту SPEC-LORE-UXR-S2-CONTRACTS (/lore/me/settings,
// /lore/me/memory) через заглушку той же поверхности S2Client; бэкенд не нужен.
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { renderToString } from 'react-dom/server';
import gameIcons from '@iconify-json/game-icons/icons.json';
import { createSafeStorage, registerGameIcons } from '@seidr/kit';
import App from '../App';
import { createLocalS2Client, SETTINGS_KEY } from '../api/me';
import { DEFAULT_SETTINGS, type UserSettings } from '../api/contracts/s2';
import { S2ConflictError, S2HttpError, createS2Stub, type S2Client } from '../api/contracts/s2.stubs';
import { applySettings } from './applySettings';
import { AccountMenu } from './AccountMenu';
import { MESSAGES } from '../i18n/messages';
import type { CookieJar } from '../storage/storage';

beforeAll(() => {
  registerGameIcons(gameIcons);
});

function memBacking() {
  const m = new Map<string, string>();
  return () => ({
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => { m.set(k, v); },
    removeItem: (k: string) => { m.delete(k); },
  }) as unknown as Storage;
}

function jar(initial = ''): CookieJar {
  let cookie = initial;
  return {
    read: () => cookie,
    write: (c: string) => {
      const [pair] = c.split(';');
      const name = pair.split('=')[0];
      cookie = [...cookie.split('; ').filter(p => p && !p.startsWith(name + '=')), pair].join('; ');
    },
  };
}

const ru = MESSAGES.ru;

describe('S4-02 · заглушка /lore/me/settings хранит по контракту S2', () => {
  it('ключ хранилища — под lore.v2.* (разведение с v1, S3-08)', () => {
    expect(SETTINGS_KEY).toBe('lore.v2.me.settings');
  });

  it('без сохранённого — умолчания контракта поверх темы пользователя (seed), version 1', async () => {
    const c = createLocalS2Client(createSafeStorage(memBacking()), { seed: { palette: 'lichen', mode: 'light' } });
    const r = await c.getSettings();
    expect(r.version).toBe(1);
    expect(r.settings).toEqual({ ...DEFAULT_SETTINGS, palette: 'lichen', mode: 'light' });
    expect(r.defaults).toEqual(DEFAULT_SETTINGS);
  });

  it('PATCH пишет, повышает version и переживает «перезагрузку» (новый клиент на том же хранилище)', async () => {
    const storage = createSafeStorage(memBacking());
    const c1 = createLocalS2Client(storage);
    const r1 = await c1.patchSettings({ patch: { text_size: 'lg', stripes: false }, expected_version: 1 });
    expect(r1.version).toBe(2);
    expect(r1.settings.text_size).toBe('lg');
    expect(r1.updated_at).not.toBeNull();
    const c2 = createLocalS2Client(storage, { seed: { palette: 'slate' } });
    const r2 = await c2.getSettings();
    expect(r2.version).toBe(2);
    expect(r2.settings.text_size).toBe('lg');
    expect(r2.settings.stripes).toBe(false);
    // seed — только для первого раза: сохранённое главнее темы v1.
    expect(r2.settings.palette).toBe(DEFAULT_SETTINGS.palette);
  });

  it('устаревший expected_version — 409 с current (S2-09), запись не меняется', async () => {
    const c = createLocalS2Client(createSafeStorage(memBacking()));
    await c.patchSettings({ patch: { density: 'comfortable' }, expected_version: 1 });
    const err = await c.patchSettings({ patch: { density: 'compact' }, expected_version: 1 }).catch(e => e);
    expect(err).toBeInstanceOf(S2ConflictError);
    expect((err as S2ConflictError<{ version: number }>).body.current?.version).toBe(2);
    expect((await c.getSettings()).settings.density).toBe('comfortable');
  });

  it('незнакомый ключ или чужое значение — 400 BAD_PARAMS с перечнем ключей', async () => {
    const c = createLocalS2Client(createSafeStorage(memBacking()));
    // Пример чужого значения сменился: `xl` стал законным шагом шкалы
    // 09.11.2026 (S4-16, «у меня 4к и все мелкое»), и проверять им отказ
    // больше нельзя — тест проверял бы уже поддержанное значение.
    const err = await c.patchSettings({ patch: { text_size: 'huge' } as unknown as Partial<UserSettings>, expected_version: 1 }).catch(e => e);
    expect(err).toBeInstanceOf(S2HttpError);
    expect((err as S2HttpError).status).toBe(400);
    expect((err as S2HttpError).body.detail).toContain('text_size');
  });

  it('битое сохранённое — не падение: незнакомые ключи отбрасываются, остальное — умолчания', async () => {
    const storage = createSafeStorage(memBacking());
    storage.set(SETTINGS_KEY, JSON.stringify({ settings: { text_size: 'sm', future_key: 1, mode: 'neon' }, version: 7 }));
    const r = await createLocalS2Client(storage).getSettings();
    expect(r.version).toBe(7);
    expect(r.settings.text_size).toBe('sm');
    expect(r.settings.mode).toBe(DEFAULT_SETTINGS.mode);
    expect(r.settings).not.toHaveProperty('future_key');
  });

  it('остальная поверхность S2Client — от заглушки контракта (память, избранное)', async () => {
    const c = createLocalS2Client(createSafeStorage(memBacking()));
    const mem = await c.memory();
    expect(mem.access).toBe('self_and_own_agents');
    expect(mem.categories.map(x => x.kind)).toEqual(['frequent_views', 'frequent_slices', 'recent_records']);
  });
});

describe('S4-02 · applySettings — каждая настройка применяется к интерфейсу', () => {
  const S = (p: Partial<UserSettings> = {}): UserSettings => ({ ...DEFAULT_SETTINGS, ...p });

  it('тема: палитра (amber → amber-forest), режим, плотность — атрибуты корня как у kit', () => {
    const el = document.createElement('div');
    applySettings(el, S({ palette: 'lichen', mode: 'light', density: 'comfortable' }), jar());
    expect(el.getAttribute('data-theme')).toBe('lichen');
    expect(el.getAttribute('data-mode')).toBe('light');
    expect(el.getAttribute('data-density')).toBe('comfortable');
    applySettings(el, S(), jar());
    expect(el.getAttribute('data-theme')).toBe('amber-forest');
    expect(el.hasAttribute('data-mode')).toBe(false);
    expect(el.hasAttribute('data-density')).toBe(false);
  });

  it('текст и полоски — атрибуты kit (data-text-size, data-stripes)', () => {
    const el = document.createElement('div');
    applySettings(el, S({ text_size: 'lg', stripes: false }), jar());
    expect(el.getAttribute('data-text-size')).toBe('lg');
    expect(el.getAttribute('data-stripes')).toBe('off');
  });

  it('чтение, ушко, клавиши — атрибуты корня, которые читают экраны записи и слой клавиш', () => {
    const el = document.createElement('div');
    applySettings(el, S({ collapse_nav_on_read: true, right_column: 'closed', single_key_shortcuts: false }), jar());
    expect(el.getAttribute('data-read-nav')).toBe('collapse');
    expect(el.getAttribute('data-right-column')).toBe('closed');
    expect(el.getAttribute('data-single-keys')).toBe('off');
    applySettings(el, S(), jar());
    expect(el.hasAttribute('data-read-nav')).toBe(false);
    expect(el.hasAttribute('data-right-column')).toBe(false);
    expect(el.hasAttribute('data-single-keys')).toBe(false);
  });

  it('тема дублируется в общую cookie seer-prefs — v1 и тема входа видят тот же выбор', () => {
    const j = jar('seer-prefs=' + encodeURIComponent(JSON.stringify({ nav: 'v2' })));
    applySettings(document.createElement('div'), S({ palette: 'slate', mode: 'light' }), j, 'localhost');
    const m = j.read().match(/seer-prefs=([^;]*)/);
    expect(JSON.parse(decodeURIComponent(m![1]))).toEqual({ nav: 'v2', theme: 'light', palette: 'slate' });
  });
});

function client(storage = createSafeStorage(memBacking())): S2Client {
  return createLocalS2Client(storage);
}

async function openMenu() {
  fireEvent.click(screen.getByRole('button', { name: /личные настройки/i }));
  return screen.findByRole('dialog', { name: ru['settings.title'] });
}

describe('S4-02 · меню аватара — личные настройки из одного места', () => {
  it('все пункты задачи в меню: чтение, ушко, текст, тема, плотность, клавиши, полоски, навигация, «что помнит»', async () => {
    const root = document.createElement('div');
    render(<AccountMenu client={client()} root={root} lang="ru" jar={jar()} />);
    const dlg = await openMenu();
    await waitFor(() => expect(within(dlg).queryByText(ru['settings.loading'])).toBeNull());
    for (const k of [
      'settings.readNav.label', 'settings.rightColumn.label', 'settings.textSize.label', 'settings.mode.label',
      'settings.palette.label', 'settings.density.label', 'settings.keys.label', 'settings.stripes.label',
      'settings.nav.label', 'settings.memory.open',
    ] as const) {
      expect(within(dlg).getAllByText(ru[k]).length, k).toBeGreaterThan(0);
    }
  });

  it('выбор «крупнее» применяется к корню сразу и сохраняется через заглушку', async () => {
    const storage = createSafeStorage(memBacking());
    const root = document.createElement('div');
    render(<AccountMenu client={client(storage)} root={root} lang="ru" jar={jar()} />);
    const dlg = await openMenu();
    const grp = await within(dlg).findByRole('group', { name: ru['settings.textSize.label'] });
    fireEvent.click(within(grp).getByRole('button', { name: ru['settings.textSize.lg'] }));
    expect(root.getAttribute('data-text-size')).toBe('lg');
    await waitFor(() => expect(JSON.parse(storage.get(SETTINGS_KEY)!).settings.text_size).toBe('lg'));
    expect(within(grp).getByRole('button', { name: ru['settings.textSize.lg'] }).getAttribute('aria-pressed')).toBe('true');
  });

  it('тема, плотность, полоски, клавиши, чтение, ушко — каждая меняется из меню и ложится на корень', async () => {
    const root = document.createElement('div');
    render(<AccountMenu client={client()} root={root} lang="ru" jar={jar()} />);
    const dlg = await openMenu();
    const pick = async (group: keyof typeof ru, option: keyof typeof ru) => {
      const g = await within(dlg).findByRole('group', { name: ru[group] });
      await act(async () => { fireEvent.click(within(g).getByRole('button', { name: ru[option] })); });
    };
    await pick('settings.mode.label', 'settings.mode.light');
    await pick('settings.density.label', 'settings.density.comfortable');
    await pick('settings.stripes.label', 'settings.off');
    await pick('settings.keys.label', 'settings.off');
    await pick('settings.readNav.label', 'settings.readNav.collapse');
    await pick('settings.rightColumn.label', 'settings.rightColumn.closed');
    expect(root.getAttribute('data-mode')).toBe('light');
    expect(root.getAttribute('data-density')).toBe('comfortable');
    expect(root.getAttribute('data-stripes')).toBe('off');
    expect(root.getAttribute('data-single-keys')).toBe('off');
    expect(root.getAttribute('data-read-nav')).toBe('collapse');
    expect(root.getAttribute('data-right-column')).toBe('closed');
  });

  it('палитра — из палитр kit, выбранная помечена', async () => {
    const root = document.createElement('div');
    render(<AccountMenu client={client()} root={root} lang="ru" jar={jar()} />);
    const dlg = await openMenu();
    const g = await within(dlg).findByRole('group', { name: ru['settings.palette.label'] });
    const btns = within(g).getAllByRole('button');
    expect(btns.length).toBe(6); // пять из v1 и mono (S4-19)
    await act(async () => { fireEvent.click(within(g).getByRole('button', { name: 'juniper' })); });
    expect(root.getAttribute('data-theme')).toBe('juniper');
  });

  it('сохранение не удалось — откат и честная ошибка, а не тихая «успешная» смена', async () => {
    const base = client();
    const failing: S2Client = { ...base, patchSettings: async () => { throw new S2HttpError(503, { error: 'LORE_DISABLED', detail: 'боком' }); } };
    const root = document.createElement('div');
    render(<AccountMenu client={failing} root={root} lang="ru" jar={jar()} />);
    const dlg = await openMenu();
    const g = await within(dlg).findByRole('group', { name: ru['settings.density.label'] });
    await act(async () => { fireEvent.click(within(g).getByRole('button', { name: ru['settings.density.comfortable'] })); });
    await waitFor(() => expect(within(dlg).getByRole('alert').textContent).toContain(ru['settings.saveFailed']));
    expect(root.hasAttribute('data-density')).toBe(false);
    // Откат — к умолчанию roomy (S4-21).
    expect(within(g).getByRole('button', { name: ru['settings.density.roomy'] }).getAttribute('aria-pressed')).toBe('true');
  });

  it('409 (настройки поменяла другая вкладка) — перечитали current и повторили поверх него', async () => {
    const storage = createSafeStorage(memBacking());
    const root = document.createElement('div');
    render(<AccountMenu client={client(storage)} root={root} lang="ru" jar={jar()} />);
    const dlg = await openMenu();
    const g = await within(dlg).findByRole('group', { name: ru['settings.stripes.label'] });
    // Другая вкладка успела записать версию 2.
    await createLocalS2Client(storage).patchSettings({ patch: { text_size: 'sm' }, expected_version: 1 });
    await act(async () => { fireEvent.click(within(g).getByRole('button', { name: ru['settings.off'] })); });
    await waitFor(() => expect(JSON.parse(storage.get(SETTINGS_KEY)!).version).toBe(3));
    const saved = JSON.parse(storage.get(SETTINGS_KEY)!).settings;
    expect(saved.stripes).toBe(false);
    expect(saved.text_size).toBe('sm');
    expect(within(dlg).queryByRole('alert')).toBeNull();
  });

  it('настройки не прочитались (401) — честная ошибка в меню, не «умолчания как будто сохранены»', async () => {
    const anon = createS2Stub({ caller: { kind: 'anonymous' } });
    render(<AccountMenu client={anon} root={document.createElement('div')} lang="ru" jar={jar()} />);
    const dlg = await openMenu();
    expect((await within(dlg).findByRole('alert')).textContent).toContain(ru['settings.loadFailed']);
    expect(within(dlg).queryByRole('group', { name: ru['settings.textSize.label'] })).toBeNull();
  });

  it('заголовок «Личные настройки» — один: у самого листа, внутри панели он не дублируется', async () => {
    render(<AccountMenu client={client()} root={document.createElement('div')} lang="ru" jar={jar()} />);
    const dlg = await openMenu();
    await waitFor(() => expect(within(dlg).queryByText(ru['settings.loading'])).toBeNull());
    // h2 шапки листа (Sheet) — единственный заголовок с этим именем: свой h3
    // у панели убран, иначе надпись шла дважды подряд.
    expect(within(dlg).getAllByRole('heading', { name: ru['settings.title'] })).toHaveLength(1);
    expect(dlg.querySelector('.settings-title')).toBeNull();
  });
});

describe('S4-02 · «что LORE помнит обо мне»', () => {
  it('категории с пунктами; «забыть» убирает пункт; «стереть всё» — проверенный ноль', async () => {
    render(<AccountMenu client={client()} root={document.createElement('div')} lang="ru" jar={jar()} />);
    const dlg = await openMenu();
    fireEvent.click(await within(dlg).findByRole('button', { name: ru['settings.memory.open'] }));
    const mem = await within(dlg).findByRole('region', { name: ru['settings.memory.title'] });
    expect(await within(mem).findByText('Блокеры')).toBeTruthy();
    await act(async () => { fireEvent.click(within(mem).getByRole('button', { name: `${ru['settings.memory.forget']}: Блокеры` })); });
    await waitFor(() => expect(within(mem).queryByText('Блокеры')).toBeNull());
    await act(async () => { fireEvent.click(within(mem).getByRole('button', { name: ru['settings.memory.forgetAll'] })); });
    await waitFor(() => expect(within(mem).getAllByText(ru['settings.memory.empty']).length).toBe(3));
  });

  it('«не запоминать» — пустота подписана как «не запоминаю», а не «ничего не открывали»', async () => {
    render(<AccountMenu client={client()} root={document.createElement('div')} lang="ru" jar={jar()} />);
    const dlg = await openMenu();
    fireEvent.click(await within(dlg).findByRole('button', { name: ru['settings.memory.open'] }));
    const mem = await within(dlg).findByRole('region', { name: ru['settings.memory.title'] });
    const g = await within(mem).findByRole('group', { name: ru['settings.memory.remembering'] });
    await act(async () => { fireEvent.click(within(g).getByRole('button', { name: ru['settings.memory.off'] })); });
    expect(await within(mem).findByText(ru['settings.memory.notRemembering'])).toBeTruthy();
  });

  it('чужая память (403) — «нет прав», а не пустой список', async () => {
    const foreign = createS2Stub({ memoryOwner: 'someone-else' });
    render(<AccountMenu client={foreign} root={document.createElement('div')} lang="ru" jar={jar()} />);
    const dlg = await openMenu();
    fireEvent.click(await within(dlg).findByRole('button', { name: ru['settings.memory.open'] }));
    const mem = await within(dlg).findByRole('region', { name: ru['settings.memory.title'] });
    expect(await within(mem).findByText('Нет прав')).toBeTruthy();
  });
});

describe('S4-02 · аватар живёт в оболочке v2', () => {
  it('в шапке v2 — кнопка аватара, личные настройки за ней, а не простынёй на экране', () => {
    const html = renderToString(<App />);
    expect(html).toContain('sk-avatar');
    expect(html).toContain('aria-haspopup="dialog"');
    expect(html).not.toContain('data-nav-switch="v2"');
  });
});

describe('S3-18 · выход из меню аватара', () => {
  it('кнопка «Выйти» есть, когда приложению есть чем выходить, и зовёт onLogout', async () => {
    const onLogout = vi.fn();
    render(<AccountMenu client={client()} root={document.createElement('div')} lang="ru" jar={jar()} name="volva" onLogout={onLogout} />);
    const dlg = await openMenu();
    fireEvent.click(within(dlg).getByRole('button', { name: 'Выйти' }));
    expect(onLogout).toHaveBeenCalledTimes(1);
  });

  it('вход выключен (нет onLogout) — кнопки выхода нет: не обещаем того, чего нет', async () => {
    render(<AccountMenu client={client()} root={document.createElement('div')} lang="ru" jar={jar()} />);
    const dlg = await openMenu();
    expect(within(dlg).queryByRole('button', { name: 'Выйти' })).toBeNull();
  });
});

// S4-11: пункт «Горячие клавиши» в меню аккаунта — ВСЕГДА, и на телефоне
// (владелица 11.11: «а вдруг клавиатуру подсоединить, например к планшету»).
describe('S4-11 · пункт «Горячие клавиши» в меню аккаунта', () => {
  it('пункт есть и открывает панель клавиш', async () => {
    const { KeymapHost, closeKeymapPanel } = await import('@seidr/kit');
    render(<><AccountMenu client={client()} root={document.createElement('div')} lang="ru" jar={jar()} /><KeymapHost /></>);
    const dlg = await openMenu();
    fireEvent.click(within(dlg).getByRole('button', { name: /Горячие клавиши/ }));
    expect(await screen.findByRole('dialog', { name: 'Горячие клавиши' })).toBeTruthy();
    act(() => { closeKeymapPanel(); });
  });
});
