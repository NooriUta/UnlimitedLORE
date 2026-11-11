// @vitest-environment jsdom
// SPRINT_UXR_S7B_ADMIN/S7B-31 п.4 (решение 4а) — параметры приложения из
// старой вкладки v1 «Настройки» (AL-38, chart-слой — решение 06.11.2026)
// переехали во «Флаги»: ключ volva.url, выбор слоя графиков echarts|volva,
// остальные известные ключи app_setting, неопознанные ключи и проверка Völva.
//
// Честно: ключ без записи — «не задано» (а не пустая строка); проверка Völva
// различает «не настроено» (503) · «графика нет в белом списке» (404) ·
// «нет доступа» (401/403) · сбой — разными словами.
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import gameIcons from '@iconify-json/game-icons/icons.json';
import { KitLangProvider, registerGameIcons } from '@seidr/kit';
import { AppSettings } from './AppSettingsBlock';
import { FlagsScreen } from './FlagsScreen';
import { KNOWN_SETTINGS, settingError, splitSettings, volvaVerdict } from './appSettings';
import { LoreHttpError } from '../api/loreSlice';

beforeAll(() => { registerGameIcons(gameIcons); });
beforeEach(() => { window.history.replaceState(null, '', '/'); });

const S = (code: string, label_ru: string, is_active = true) => ({
  dict_type: 'app_setting', code, label_ru, label_en: null, color: null, icon: null, sort_order: 0, is_active, is_extensible: false,
});
const ROWS = [S('charts.layer', 'volva'), S('legacy.key', 'x'), S('gone.key', 'y', false)];

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

interface FakeOpts { dict?: number; embed?: number; post?: number }
function fake(o: FakeOpts = {}) {
  return vi.fn(async (url: string, init?: RequestInit) => {
    if (init?.method === 'POST') return o.post ? json({ error: 'FORBIDDEN', detail: 'admin only' }, o.post) : json({ ok: true });
    if (url.startsWith('/lore/slice/dictionary')) return o.dict ? json({ error: 'DOWN', detail: 'down' }, o.dict) : json({ rows: ROWS });
    if (url.startsWith('/lore/embed/volva/')) {
      return o.embed
        ? json({ error: o.embed === 503 ? 'NOT_CONFIGURED' : 'X', detail: `d${o.embed}` }, o.embed)
        : json({ url: 'https://volva.example/embed/velocity?jwt=secret', expires_at: '2026-11-11T12:00:00Z' });
    }
    if (url.startsWith('/lore/admin/flags')) return json({ flags: [], version: {} });
    return json({});
  }) as unknown as typeof fetch;
}
const calls = (f: typeof fetch) => (f as unknown as ReturnType<typeof vi.fn>).mock.calls as [string, RequestInit | undefined][];

const mount = (f: typeof fetch) => render(<KitLangProvider lang="ru"><AppSettings fetchImpl={f} /></KitLangProvider>);

describe('S7B-31 · модель параметров приложения', () => {
  it('реестр известных ключей — тот же, что у v1 (AL-38)', () => {
    expect(KNOWN_SETTINGS.map(k => k.key)).toEqual(['volva.url', 'charts.layer', 'qg.actions_projects', 'md_images_enabled', 'md_image_max_mb']);
  });

  it('известный ключ без записи — null («не задано»); неопознанные — только активные', () => {
    const { known, unknown } = splitSettings(ROWS as never);
    expect(known.find(k => k.def.key === 'volva.url')!.value).toBeNull();
    expect(known.find(k => k.def.key === 'charts.layer')!.value).toBe('volva');
    expect(unknown.map(u => u.code)).toEqual(['legacy.key']);
  });

  it('проверка значения: адрес — только http(s), слой — echarts|volva, да/нет, число', () => {
    expect(settingError('volva.url', 'ftp://x')).toBe('url');
    expect(settingError('volva.url', 'https://volva.example')).toBeNull();
    expect(settingError('charts.layer', 'grafana')).toBe('choice');
    expect(settingError('charts.layer', 'echarts')).toBeNull();
    expect(settingError('md_images_enabled', 'yes')).toBe('bool');
    expect(settingError('md_image_max_mb', '-1')).toBe('number');
    // Пусто — законно: «снять значение», ключ вернётся к умолчанию.
    expect(settingError('volva.url', '')).toBeNull();
  });

  it('вердикт проверки Völva — по коду ответа', () => {
    expect(volvaVerdict(new LoreHttpError(503, 'NOT_CONFIGURED', 'no secret'))).toMatchObject({ kind: 'not_configured' });
    expect(volvaVerdict(new LoreHttpError(404, '', ''))).toMatchObject({ kind: 'unknown_chart' });
    expect(volvaVerdict(new LoreHttpError(403, '', ''))).toMatchObject({ kind: 'forbidden' });
    expect(volvaVerdict(new Error('net'))).toMatchObject({ kind: 'error', detail: 'net' });
  });
});

describe('S7B-31 · блок «Параметры приложения»', () => {
  it('известные ключи строками: не заданный — «не задано», заданный — значение', async () => {
    mount(fake());
    const url = await screen.findByTestId('adm-set-volva.url');
    expect(within(url).getByTestId('adm-set-value').textContent).toMatch(/не задано/);
    expect(within(screen.getByTestId('adm-set-charts.layer')).getByTestId('adm-set-value').textContent).toBe('volva');
  });

  it('chart-слой: выбор echarts|volva, «Сохранить» пишет app_setting в /lore/dict/entry', async () => {
    const f = fake();
    mount(f);
    const row = await screen.findByTestId('adm-set-charts.layer');
    fireEvent.click(within(row).getByRole('button', { name: 'Изменить' }));
    const sel = within(row).getByRole('combobox') as HTMLSelectElement;
    expect([...sel.options].map(o => o.value)).toEqual(['echarts', 'volva']);
    fireEvent.change(sel, { target: { value: 'echarts' } });
    fireEvent.click(within(row).getByRole('button', { name: 'Сохранить' }));
    await waitFor(() => expect(calls(f).some(c => c[1]?.method === 'POST')).toBe(true));
    const post = calls(f).find(c => c[1]?.method === 'POST')!;
    expect(post[0]).toBe('/lore/dict/entry');
    expect(JSON.parse(String(post[1]!.body))).toMatchObject({ dict_type: 'app_setting', code: 'charts.layer', label_ru: 'echarts', is_active: true });
  });

  it('неверный адрес Völva — сказано и не отправлено', async () => {
    const f = fake();
    mount(f);
    const row = await screen.findByTestId('adm-set-volva.url');
    fireEvent.click(within(row).getByRole('button', { name: 'Изменить' }));
    fireEvent.change(within(row).getByRole('textbox'), { target: { value: 'volva.local' } });
    fireEvent.click(within(row).getByRole('button', { name: 'Сохранить' }));
    expect(within(row).getByTestId('adm-set-invalid').textContent).toMatch(/http/);
    expect(calls(f).some(c => c[1]?.method === 'POST')).toBe(false);
  });

  it('отказ записи назван словами сервера', async () => {
    mount(fake({ post: 403 }));
    const row = await screen.findByTestId('adm-set-charts.layer');
    fireEvent.click(within(row).getByRole('button', { name: 'Изменить' }));
    fireEvent.click(within(row).getByRole('button', { name: 'Сохранить' }));
    expect((await screen.findByTestId('adm-set-error')).textContent).toMatch(/admin only/);
  });

  it('неопознанный ключ: «Удалить» — через дифф (снимется), soft-delete is_active=false', async () => {
    const f = fake();
    mount(f);
    const box = await screen.findByTestId('adm-set-unknown');
    fireEvent.click(within(box).getByRole('button', { name: 'Удалить' }));
    fireEvent.click(await within(box).findByRole('button', { name: /Применить/ }));
    await waitFor(() => expect(calls(f).some(c => c[1]?.method === 'POST')).toBe(true));
    expect(JSON.parse(String(calls(f).find(c => c[1]?.method === 'POST')![1]!.body))).toMatchObject({ code: 'legacy.key', is_active: false });
  });

  it('проверка Völva: 503 — «Не настроено», не «ошибка»', async () => {
    mount(fake({ embed: 503 }));
    fireEvent.click(await screen.findByRole('button', { name: 'Проверить интеграцию Völva' }));
    const v = await screen.findByTestId('adm-volva-verdict');
    expect(v.getAttribute('data-kind')).toBe('not_configured');
    expect(v.textContent).toMatch(/Не настроено/);
  });

  it('проверка Völva: успех — адрес выдан, JWT не показывается', async () => {
    mount(fake());
    fireEvent.click(await screen.findByRole('button', { name: 'Проверить интеграцию Völva' }));
    const v = await screen.findByTestId('adm-volva-verdict');
    expect(v.getAttribute('data-kind')).toBe('ok');
    expect(v.textContent).toContain('https://volva.example');
    expect(v.textContent).not.toContain('secret');
  });

  it('словарь не прочитан — сбой, а не «всё не задано»', async () => {
    mount(fake({ dict: 502 }));
    expect(await screen.findByRole('button', { name: 'Повторить' })).toBeTruthy();
    expect(screen.queryByTestId('adm-set-volva.url')).toBeNull();
  });

  it('во «Флагах» — блоком параметров приложения', async () => {
    render(<KitLangProvider lang="ru"><FlagsScreen fetchImpl={fake()} /></KitLangProvider>);
    expect(await screen.findByTestId('adm-set-charts.layer')).toBeTruthy();
  });
});
