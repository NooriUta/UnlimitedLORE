// @vitest-environment jsdom
// [[task:SPRINT_LORE_ADMIN_POLISH/AP-APPEARANCE]] — человек выбирает пару шрифтов и палитру НЕЗАВИСИМО и только внутри
// набора установки (решение владельца 25.11.2026, 2в); свой стиль установки ложится переменными поверх палитры.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToString } from 'react-dom/server';
import { DEFAULT_SETTINGS, validateSettingsPatch } from '../api/contracts/s2';
import { patchToServer, settingsFromServer } from '../api/liveS2';
import { applySettings } from './applySettings';
import { fetchPalettes } from './palettesSource';
import { setOwnStyles } from './ownStyles';
import { PersonalSettings } from './PersonalSettings';
import type { CookieJar } from '../storage/storage';

const jar = (): CookieJar => { let c = ''; return { read: () => c, write: (v: string) => { c = v.split(';')[0]; } }; };
const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });

// Форма документа — настоящий снимок сервера (shared/fixtures/model.json, CT-KIT-FIXTURES); заменён только раздел
// palettes: снимок снят до AP-APPEARANCE, и полей builtin/tokens/allowed/fonts в нём ещё нет (их форму задаёт
// LoreModelTest.palettesCarryOwnStylesAndInstallSet на стороне сервера).
const SNAPSHOT = JSON.parse(readFileSync(join(__dirname, '..', '..', '..', 'shared', 'fixtures', 'model.json'), 'utf8')) as Record<string, unknown>;
const MODEL = {
  ...SNAPSHOT,
  palettes: {
    source: 'settings:palette', default: 'own-corp', allowed: ['slate', 'mono', 'own-corp'],
    entries: [
      { code: 'amber-forest', title: 'янтарный лес', order: 10, in_dictionary: true, builtin: true },
      { code: 'slate', title: 'сланец', order: 30, in_dictionary: true, builtin: true },
      { code: 'mono', title: 'приглушённая (mono)', order: 60, in_dictionary: true, builtin: true },
      { code: 'own-corp', title: 'Корпоративный', order: 100, in_dictionary: true, builtin: false,
        tokens: { root: { '--acc': '#3a8fd8' }, light: { '--bg0': '#fafafa' } } },
    ],
    fonts: { entries: ['pair', 'mono'], default: 'pair', allowed: ['pair', 'mono'] },
  },
};

beforeEach(() => { setOwnStyles({}); });

describe('AP-APPEARANCE · контракт личных настроек', () => {
  it('пара шрифтов — личная настройка, умолчание pair; сервер знает её под тем же именем', () => {
    expect(DEFAULT_SETTINGS.font_pair).toBe('pair');
    expect(validateSettingsPatch({ font_pair: 'mono' })).toEqual([]);
    expect(validateSettingsPatch({ font_pair: 'comic' as never })).toEqual(['font_pair']);
    expect(patchToServer({ font_pair: 'mono' })).toEqual({ font_pair: 'mono' });
    expect(settingsFromServer({ font_pair: 'mono', palette: 'own-corp' }).settings).toMatchObject({ font_pair: 'mono', palette: 'own-corp' });
  });
});

describe('AP-APPEARANCE · палитры и шрифты из модели — только набор установки', () => {
  it('в выборе — только разрешённые, свой стиль с образцом-акцентом; пары шрифтов — набором', async () => {
    const p = await fetchPalettes({ fetchImpl: vi.fn(async () => json(MODEL)) as unknown as typeof fetch });
    expect(p.options.map(o => o.value)).toEqual(['slate', 'mono', 'own-corp']);
    expect(p.options.find(o => o.value === 'own-corp')!.swatch).toBe('#3a8fd8');
    expect(p.default).toBe('own-corp');
    expect(p.fonts).toEqual(['pair', 'mono']);
  });

  it('панель «Вид»: палитра и пара шрифтов — две независимые строки, варианты только из набора', async () => {
    const palettes = await fetchPalettes({ fetchImpl: vi.fn(async () => json(MODEL)) as unknown as typeof fetch });
    const state = { status: 'ok' as const, settings: { ...DEFAULT_SETTINGS, palette: 'slate', font_pair: 'mono' as const }, version: 1, saving: false };
    const html = renderToString(<PersonalSettings lang="ru" state={state} onChange={() => {}} navTargetUrl={null} palettes={palettes} />);
    expect(html).toContain('Корпоративный');
    expect(html).not.toContain('янтарный лес');
    expect(html).toContain('data-setting="font_pair"');
    expect(html).toContain('Заголовки и текст — Unbounded и Manrope');
  });
});

describe('AP-APPEARANCE · применение к корню', () => {
  it('пара mono — data-font; pair — атрибута нет', () => {
    const el = document.createElement('div');
    applySettings(el, { ...DEFAULT_SETTINGS, font_pair: 'mono' }, jar());
    expect(el.getAttribute('data-font')).toBe('mono');
    applySettings(el, { ...DEFAULT_SETTINGS }, jar());
    expect(el.hasAttribute('data-font')).toBe(false);
  });

  it('свой стиль — база amber forest и его переменные; смена на нашу палитру снимает их', () => {
    setOwnStyles({ 'own-corp': { root: { '--acc': '#3a8fd8' }, light: { '--bg0': '#fafafa' } } });
    const el = document.createElement('div');
    applySettings(el, { ...DEFAULT_SETTINGS, palette: 'own-corp', mode: 'light' }, jar());
    expect(el.getAttribute('data-theme')).toBe('amber-forest');
    expect(el.style.getPropertyValue('--acc')).toBe('#3a8fd8');
    expect(el.style.getPropertyValue('--bg0')).toBe('#fafafa');
    applySettings(el, { ...DEFAULT_SETTINGS, palette: 'slate' }, jar());
    expect(el.getAttribute('data-theme')).toBe('slate');
    expect(el.style.getPropertyValue('--acc')).toBe('');
  });
});
