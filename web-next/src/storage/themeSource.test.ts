// S4-00a × S3-08: тема v2 читает выбор v1 через storage/, а не напрямую.
import { describe, expect, it, vi } from 'vitest';
import { themeSource } from './themeSource';

describe('themeSource', () => {
  it('читает ключ v1 из localStorage', () => {
    const get = vi.fn((k: string) => (k === 'lore-palette' ? 'lichen' : null));
    vi.stubGlobal('localStorage', { getItem: get });
    expect(themeSource().local('lore-palette')).toBe('lichen');
    vi.unstubAllGlobals();
  });

  it('недоступный localStorage (приватный режим) — null, а не исключение', () => {
    vi.stubGlobal('localStorage', { getItem: () => { throw new Error('SecurityError'); } });
    expect(themeSource().local('lore-mode')).toBeNull();
    vi.unstubAllGlobals();
  });
});
