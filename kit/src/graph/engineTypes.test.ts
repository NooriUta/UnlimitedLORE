// @vitest-environment jsdom
// GC-03 · цвет для холста и WebGL: токен темы → значение. Найдено на живой
// сборке 11.11.2026: «var(--suc, var(--t3))» (так отдаёт toCssColor) не
// разбирался из-за вложенной скобки, холст получал негодный цвет и рисовал узлы
// чёрными; а токена --bg в kit нет вовсе (есть --bg0…--bg3).
import { afterEach, describe, expect, it } from 'vitest';
import { FALLBACK, neighborsOf, resolveColor } from './engineTypes';

afterEach(() => document.documentElement.removeAttribute('style'));

describe('GC-03 · resolveColor', () => {
  it('токен, var(токен) и var(токен, var(запасной)) — значение токена', () => {
    document.documentElement.style.setProperty('--suc', 'green');
    const el = document.documentElement;
    expect(resolveColor(el, '--suc')).toBe('green');
    expect(resolveColor(el, 'var(--suc)')).toBe('green');
    expect(resolveColor(el, 'var(--suc, var(--t3))')).toBe('green');
  });
  it('токена нет — берётся запасной из var(…), а если и его нет — подложка', () => {
    document.documentElement.style.setProperty('--t3', 'silver');
    const el = document.documentElement;
    expect(resolveColor(el, 'var(--nope, var(--t3))')).toBe('silver');
    expect(resolveColor(el, '--nope')).toBe(FALLBACK);
  });
  it('готовое значение проходит как есть', () => {
    expect(resolveColor(document.documentElement, 'transparent')).toBe('transparent');
  });
  it('соседи — с самим узлом', () => {
    expect([...neighborsOf('a', [{ from: 'a', to: 'b', rel: 'R' }, { from: 'c', to: 'a', rel: 'R' }, { from: 'c', to: 'd', rel: 'R' }])].sort())
      .toEqual(['a', 'b', 'c']);
  });
});
