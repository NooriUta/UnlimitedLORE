// @vitest-environment jsdom
// [[task:SPRINT_LORE_ADMIN_POLISH/AP-APPEARANCE]] — админка «Оформление» по прототипу docs/prototypes/admin-appearance.html
// (решения владельца 25.11.2026): наши стили обязательные (замок), свои — опциональной загрузкой с проверкой сервером
// (недопустимое — отказ с причиной), на установку — умолчание и разрешённый набор палитр и пар шрифтов.
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import gameIcons from '@iconify-json/game-icons/icons.json';
import { KitLangProvider, registerGameIcons } from '@seidr/kit';
import { AppearanceScreen } from './AppearanceScreen';
import { installOf, ownCode, ownStylesOf } from './appearance';
import { ADMIN_SECTIONS } from './adminModule';
import { splitSettings } from './appSettings';

beforeAll(() => { registerGameIcons(gameIcons); });
beforeEach(() => { window.history.replaceState(null, '', '/'); });

const row = (dict_type: string, code: string, label_ru: string, extra: Record<string, unknown> = {}) => ({
  dict_type, code, label_ru, label_en: null, color: null, icon: null, sort_order: 0, is_active: true, is_extensible: true, ...extra,
});
const ROWS = [
  row('palette', 'amber-forest', 'янтарный лес'),
  row('palette', 'mono', 'приглушённая (mono)'),
  row('palette', 'own-corp', 'Корпоративный', { tokens_json: '{"root":{"--acc":"#3a8fd8","--bg0":"#0d1117"}}', sort_order: 100 }),
  row('palette', 'own-off', 'Выключенный', { tokens_json: '{"root":{"--acc":"#000000"}}', is_active: false, sort_order: 110 }),
  row('app_setting', 'appearance.palette_default', 'own-corp'),
  row('app_setting', 'appearance.palettes_allowed', 'amber-forest,slate,own-corp'),
];

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

function fake(check: unknown = { ok: true, errors: [], warnings: [], tokens: { root: { '--acc': '#e0a040' } } }) {
  return vi.fn(async (url: string, _init?: RequestInit) => {
    if (url.startsWith('/lore/slice/dictionary')) return json({ rows: ROWS });
    if (url.startsWith('/lore/dict/style-check')) return json(check);
    if (url.startsWith('/lore/dict/entry')) return json({ ok: true, outcome: 'created' });
    return json({});
  }) as unknown as typeof fetch;
}
const posts = (f: typeof fetch, path: string) =>
  ((f as unknown as ReturnType<typeof vi.fn>).mock.calls as [string, RequestInit | undefined][])
    .filter(([u, i]) => u.startsWith(path) && i?.method === 'POST')
    .map(([, i]) => JSON.parse(String(i!.body)) as Record<string, unknown>);

const mount = (f: typeof fetch) => render(<KitLangProvider lang="ru"><AppearanceScreen fetchImpl={f} /></KitLangProvider>);

describe('AP-APPEARANCE · данные экрана', () => {
  it('раздел «Оформление» есть в админке', () => {
    expect(ADMIN_SECTIONS).toContain('adm-appearance');
  });

  it('свои стили — из справочника palette (own-…), с токенами; набор установки — из app_setting', () => {
    const own = ownStylesOf(ROWS as never);
    expect(own.map(o => [o.code, o.active])).toEqual([['own-corp', true], ['own-off', false]]);
    expect(own[0].tokens.root['--acc']).toBe('#3a8fd8');
    const inst = installOf(ROWS as never, own);
    expect(inst.paletteDefault).toBe('own-corp');
    expect(inst.palettesAllowed).toEqual(['amber-forest', 'slate', 'own-corp']);
    expect(inst.fontsAllowed).toEqual(['pair', 'mono']);
  });

  it('код своего стиля — own- и латиница из названия', () => {
    expect(ownCode('Ночной янтарь', [])).toBe('own-nochnoy-yantar');
    expect(ownCode('Corp Blue!', ['own-corp-blue'])).toBe('own-corp-blue-2');
  });

  it('ключи appearance.* живут в «Оформлении», во «Флагах» их нет среди неопознанных', () => {
    expect(splitSettings(ROWS as never).unknown.map(u => u.code)).toEqual([]);
  });
});

describe('AP-APPEARANCE · вкладка «Стили»', () => {
  it('наши палитры и пары шрифтов — с замком; свои — со включателем; умолчание отмечено', async () => {
    mount(fake());
    await screen.findByTestId('ap-ours');
    const ours = screen.getByTestId('ap-ours');
    expect(within(ours).getAllByTestId('ap-lock')).toHaveLength(6 + 2);
    const own = screen.getByTestId('ap-own-list');
    expect(within(own).getByText('Корпоративный')).toBeTruthy();
    expect((within(own).getByRole('checkbox', { name: /Выключенный/ }) as HTMLInputElement).checked).toBe(false);
    expect(within(own).getByTestId('ap-default-own-corp')).toBeTruthy();
  });

  it('недопустимое — отказ с причинами словами сервера, «Добавить» недоступно', async () => {
    const f = fake({ ok: false, errors: ['--brand — неизвестная переменная', '@import или url(): внешние загрузки запрещены'], warnings: [] });
    mount(f);
    fireEvent.change(await screen.findByLabelText('Название стиля'), { target: { value: 'Чужой бренд' } });
    fireEvent.change(screen.getByLabelText('Токены стиля'), { target: { value: ':root { --brand: #f0a; }' } });
    fireEvent.click(screen.getByRole('button', { name: 'Проверить' }));
    expect(await screen.findByText('--brand — неизвестная переменная')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Добавить' }) as HTMLButtonElement).disabled).toBe(true);
    expect(posts(f, '/lore/dict/style-check')[0]).toEqual({ source: ':root { --brand: #f0a; }' });
    expect(posts(f, '/lore/dict/entry')).toEqual([]);
  });

  it('годный — добавляется статьёй palette own-… с исходником в tokens_json', async () => {
    const f = fake();
    mount(f);
    fireEvent.change(await screen.findByLabelText('Название стиля'), { target: { value: 'Ночной янтарь' } });
    fireEvent.change(screen.getByLabelText('Токены стиля'), { target: { value: ':root { --acc: #e0a040; }' } });
    fireEvent.click(screen.getByRole('button', { name: 'Проверить' }));
    await waitFor(() => expect((screen.getByRole('button', { name: 'Добавить' }) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByRole('button', { name: 'Добавить' }));
    await waitFor(() => expect(posts(f, '/lore/dict/entry')).toHaveLength(1));
    expect(posts(f, '/lore/dict/entry')[0]).toMatchObject({
      dict_type: 'palette', code: 'own-nochnoy-yantar', label_ru: 'Ночной янтарь', tokens_json: ':root { --acc: #e0a040; }', is_active: true,
    });
  });

  it('выключить свой стиль — is_active=false той же статьи', async () => {
    const f = fake();
    mount(f);
    fireEvent.click(within(await screen.findByTestId('ap-own-list')).getByRole('checkbox', { name: /Корпоративный/ }));
    await waitFor(() => expect(posts(f, '/lore/dict/entry')).toEqual([expect.objectContaining({ dict_type: 'palette', code: 'own-corp', is_active: false })]));
  });
});

describe('AP-APPEARANCE · вкладка «Шрифты и палитра» — на установку', () => {
  it('сохранение пишет умолчание и разрешённый набор палитр и пар шрифтов в app_setting', async () => {
    window.history.replaceState(null, '', '/?adm-app-tab=pick');
    const f = fake();
    mount(f);
    const allowed = await screen.findByTestId('ap-allowed-palettes');
    fireEvent.click(within(allowed).getByRole('checkbox', { name: /сланец|slate/ }));
    fireEvent.click(within(screen.getByTestId('ap-allowed-fonts')).getByRole('checkbox', { name: /mono/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить для установки' }));
    await waitFor(() => expect(posts(f, '/lore/dict/entry')).toHaveLength(4));
    const by = Object.fromEntries(posts(f, '/lore/dict/entry').map(b => [b.code, b.label_ru]));
    expect(by).toEqual({
      'appearance.palette_default': 'own-corp',
      'appearance.palettes_allowed': 'amber-forest,own-corp',
      'appearance.font_default': 'pair',
      'appearance.fonts_allowed': 'pair',
    });
  });

  it('умолчание нельзя снять из набора: его флажок недоступен', async () => {
    window.history.replaceState(null, '', '/?adm-app-tab=pick');
    mount(fake());
    const allowed = await screen.findByTestId('ap-allowed-palettes');
    expect((within(allowed).getByRole('checkbox', { name: /Корпоративный/ }) as HTMLInputElement).disabled).toBe(true);
  });
});
