// @vitest-environment jsdom
// Свой стиль установки (SPRINT_LORE_ADMIN_POLISH/AP-APPEARANCE, решения 1а и 3б): токены ложатся инлайн-переменными
// на корень поверх базовой палитры; смена стиля или режима снимает прежние, ничего не оставляя.
import { describe, expect, it } from 'vitest';
import { applyOwnStyle, ownStyleVars } from './ownStyle';

const corp = { root: { '--acc': '#3a8fd8', '--bg0': '#0d1117' }, light: { '--bg0': '#fafafa' } };

describe('AP-APPEARANCE · свой стиль на корне', () => {
  it('светлый режим кладёт поправки light поверх root', () => {
    expect(ownStyleVars(corp, 'dark')).toEqual({ '--acc': '#3a8fd8', '--bg0': '#0d1117' });
    expect(ownStyleVars(corp, 'light')).toEqual({ '--acc': '#3a8fd8', '--bg0': '#fafafa' });
  });

  it('только переменные темы: чужое имя в стиль не попадает', () => {
    expect(ownStyleVars({ root: { '--acc': '#fff', color: 'red', '--x; y': '1' } }, 'dark')).toEqual({ '--acc': '#fff' });
  });

  it('применение и снятие: прежние переменные не остаются висеть', () => {
    const el = document.createElement('div');
    applyOwnStyle(el, corp, 'dark');
    expect(el.style.getPropertyValue('--acc')).toBe('#3a8fd8');
    expect(el.getAttribute('data-own-style')).toBe('--acc,--bg0');
    applyOwnStyle(el, { root: { '--t1': '#eee' } }, 'dark');
    expect(el.style.getPropertyValue('--acc')).toBe('');
    expect(el.style.getPropertyValue('--t1')).toBe('#eee');
    applyOwnStyle(el, null, 'dark');
    expect(el.style.getPropertyValue('--t1')).toBe('');
    expect(el.hasAttribute('data-own-style')).toBe(false);
  });
});
