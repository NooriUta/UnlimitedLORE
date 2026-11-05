import { describe, expect, it } from 'vitest';
import { frameThemeCss, readFrameTheme, FRAME_THEME_FALLBACK } from './sandboxFrameTheme';

/**
 * SPRINT_LORE_ADMIN_HOUSEKEEPING/AH-10 (хвосты) · цвета внутри песочницы — из темы.
 *
 * iframe не наследует CSS-переменные хоста, поэтому стили в srcdoc были
 * прибиты hex-ами тёмной темы (#cdd0d4 текст, #333 рамки). В светлой теме
 * светло-серый текст на белом не читается. Теперь значения токенов читаются
 * у хоста и передаются внутрь уже вычисленными.
 */
const raw = import.meta.glob('./SandboxedHtmlFrame.tsx', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;

describe('песочница HTML берёт цвета из темы', () => {
  it('в исходнике рамки нет прибитых hex-цветов', () => {
    const s = Object.values(raw)[0] ?? '';
    expect(s).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
  });

  it('frameThemeCss подставляет переданные значения', () => {
    const cssText = frameThemeCss({ text: 'rgb(30, 26, 18)', link: 'rgb(1, 2, 3)', codeBg: 'rgb(4, 5, 6)', border: 'rgb(7, 8, 9)', fontSize: '12px', font: 'Manrope' });
    expect(cssText).toContain('color:rgb(30, 26, 18)');
    expect(cssText).toContain('a{color:rgb(1, 2, 3)');
    expect(cssText).toContain('background:rgb(4, 5, 6)');
    expect(cssText).toContain('border:1px solid rgb(7, 8, 9)');
    expect(cssText).toContain('font-size:12px');
    expect(cssText).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
  });

  it('readFrameTheme читает токены хоста; пустой токен — системный цвет, не hex', () => {
    const values: Record<string, string> = { '--t1': ' rgb(30, 26, 18) ', '--acc': '', '--bg2': 'rgb(255, 255, 255)', '--bd': 'rgb(212, 204, 184)', '--fs-base': '12px', '--font': '' };
    const theme = readFrameTheme(name => values[name] ?? '');
    expect(theme.text).toBe('rgb(30, 26, 18)');
    expect(theme.link).toBe(FRAME_THEME_FALLBACK.link);
    expect(theme.codeBg).toBe('rgb(255, 255, 255)');
    expect(theme.border).toBe('rgb(212, 204, 184)');
    expect(theme.fontSize).toBe('12px');
    expect(theme.font).toBe(FRAME_THEME_FALLBACK.font);
    expect(Object.values(FRAME_THEME_FALLBACK).join(' ')).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
  });
});
