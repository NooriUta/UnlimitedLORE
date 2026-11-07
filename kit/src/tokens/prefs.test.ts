// SPRINT_UXR_S4_UI_SHELL_LISTS/S4-00a: выбор темы v2 читается из тех же мест,
// что у v1 (localStorage `lore-palette`/`lore-mode`, общая cookie `seer-prefs`),
// — иначе пользователь, переключивший тему в v1, открыл бы v2 в другой.
import { describe, expect, it } from 'vitest';
import { PALETTES, applyTheme, resolvePrefs, themeAttrs } from './prefs';

const store = (m: Record<string, string>) => (k: string) => m[k] ?? null;
const cookie = (v: object) => `a=1; seer-prefs=${encodeURIComponent(JSON.stringify(v))}; b=2`;

describe('resolvePrefs', () => {
  it('умолчание: amber-forest, тёмная, компактная', () => {
    expect(resolvePrefs({})).toEqual({ palette: 'amber-forest', mode: 'dark', density: 'compact' });
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

  it('плотность: своя настройка v2, неизвестное значение = компактная', () => {
    expect(resolvePrefs({ local: store({ 'lore-density': 'comfortable' }) }).density).toBe('comfortable');
    expect(resolvePrefs({ local: store({ 'lore-density': 'huge' }) }).density).toBe('compact');
  });
});

describe('themeAttrs / applyTheme', () => {
  it('умолчания не ставят атрибутов-переопределений (работает :root)', () => {
    expect(themeAttrs({ palette: 'amber-forest', mode: 'dark', density: 'compact' }))
      .toEqual({ 'data-theme': 'amber-forest', 'data-mode': null, 'data-density': null });
  });

  it('applyTheme ставит и снимает атрибуты на элементе', () => {
    const attrs = new Map<string, string>([['data-mode', 'light']]);
    const el = { setAttribute: (k: string, v: string) => void attrs.set(k, v), removeAttribute: (k: string) => void attrs.delete(k) };
    applyTheme(el, { palette: 'lichen', mode: 'dark', density: 'comfortable' });
    expect(Object.fromEntries(attrs)).toEqual({ 'data-theme': 'lichen', 'data-density': 'comfortable' });
  });

  it('список палитр — те же пять, что у v1', () => {
    expect(PALETTES.map(p => p.id)).toEqual(['amber-forest', 'lichen', 'slate', 'juniper', 'warm-dark']);
  });
});
