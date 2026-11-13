// SPRINT_UXR_S4_UI_SHELL_LISTS/S4-00a: выбор темы v2 читается из тех же мест,
// что у v1 (localStorage `lore-palette`/`lore-mode`, общая cookie `seer-prefs`),
// — иначе пользователь, переключивший тему в v1, открыл бы v2 в другой.
import { describe, expect, it } from 'vitest';
import { PALETTES, applyTheme, resolvePrefs as resolveRaw, themeAttrs, type PrefsSources } from './prefs';

const store = (m: Record<string, string>) => (k: string) => m[k] ?? null;
// Ключи хранения — от приложения (K-14). Здесь — как у LORE (общие с v1).
const LORE_KEYS = { palette: 'lore-palette', mode: 'lore-mode', legacy: 'lore-theme', density: 'lore-density' };
const resolvePrefs = (src: PrefsSources) => resolveRaw({ keys: LORE_KEYS, cookieName: 'seer-prefs', ...src });
const cookie = (v: object) => `a=1; seer-prefs=${encodeURIComponent(JSON.stringify(v))}; b=2`;

describe('resolvePrefs', () => {
  it('умолчание: amber-forest, тёмная, roomy (решение владелицы 08.11, S4-21)', () => {
    expect(resolvePrefs({})).toEqual({ palette: 'amber-forest', mode: 'dark', density: 'roomy' });
  });

  it('свой localStorage v1 важнее общей cookie', () => {
    const p = resolvePrefs({ local: store({ 'lore-palette': 'slate', 'lore-mode': 'light' }), cookie: cookie({ palette: 'lichen', theme: 'dark' }) });
    expect(p).toMatchObject({ palette: 'slate', mode: 'light' });
  });

  it('без localStorage — cookie платформы (тема входа и Verdandi)', () => {
    expect(resolvePrefs({ cookie: cookie({ palette: 'juniper', theme: 'light' }) })).toMatchObject({ palette: 'juniper', mode: 'light' });
  });

  it('старое имя `amber` и мусор не ломают выбор', () => {
    expect(resolvePrefs({ local: store({ 'lore-theme': 'amber' }) }).palette).toBe('amber-forest');
    expect(resolvePrefs({ local: store({ 'lore-palette': 'нет-такой' }), cookie: 'seer-prefs=%7Bbroken' }).palette).toBe('amber-forest');
  });

  it('плотность: своя настройка v2, неизвестное значение = roomy', () => {
    expect(resolvePrefs({ local: store({ 'lore-density': 'comfortable' }) }).density).toBe('comfortable');
    expect(resolvePrefs({ local: store({ 'lore-density': 'huge' }) }).density).toBe('roomy');
    expect(resolvePrefs({ local: store({ 'lore-density': 'compact' }) }).density).toBe('compact');
  });
});

describe('K-14 · ключи хранения — от приложения', () => {
  it('без ключей приложения kit читает свои нейтральные (kit-*), чужие lore-* не трогает', () => {
    expect(resolveRaw({ local: store({ 'kit-palette': 'slate', 'lore-mode': 'light' }) })).toMatchObject({ palette: 'slate', mode: 'dark' });
    expect(resolveRaw({ cookie: `kit-prefs=${encodeURIComponent(JSON.stringify({ palette: 'juniper' }))}` }).palette).toBe('juniper');
  });
});

describe('themeAttrs / applyTheme', () => {
  it('умолчания не ставят атрибутов-переопределений (работает :root)', () => {
    expect(themeAttrs({ palette: 'amber-forest', mode: 'dark', density: 'roomy' }))
      .toEqual({ 'data-theme': 'amber-forest', 'data-mode': null, 'data-density': null });
  });

  it('applyTheme ставит и снимает атрибуты на элементе', () => {
    const attrs = new Map<string, string>([['data-mode', 'light']]);
    const el = { setAttribute: (k: string, v: string) => void attrs.set(k, v), removeAttribute: (k: string) => void attrs.delete(k) };
    applyTheme(el, { palette: 'lichen', mode: 'dark', density: 'comfortable' });
    expect(Object.fromEntries(attrs)).toEqual({ 'data-theme': 'lichen', 'data-density': 'comfortable' });
  });

  it('список палитр — пять из v1 и приглушённая mono (S4-19, только v2)', () => {
    expect(PALETTES.map(p => p.id)).toEqual(['amber-forest', 'lichen', 'slate', 'juniper', 'warm-dark', 'mono']);
  });
});
