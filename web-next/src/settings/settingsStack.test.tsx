// @vitest-environment jsdom
// Личные настройки на крупном шрифте (SPRINT_UXR_POLISH_UAT_1113/PU-08). Владелица 13.11: «при больших
// шрифтах настройки разъезжаются… описание сделать либо подсказкой, либо вверху над виджетами кнопок…
// кроме мелких вкл выкл»; выбор через miniLORE 13.11 — «описание над кнопками».
//  · строки с сегментом из 3+ вариантов — описание и подпись НАД кнопками (layout stack);
//  · вкл/выкл (2 варианта) — в строке, как были;
//  · оговорка «палитры без статьи — показан код» — только с включёнными тех. сведениями (S4-TECH-NOTES).
import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { DEFAULT_SETTINGS } from '../api/contracts/s2';
import { PersonalSettings } from './PersonalSettings';

const ok = (over = {}) => ({ status: 'ok' as const, settings: { ...DEFAULT_SETTINGS, ...over }, version: 1, saving: false });
const palettes = { default: null, fromModel: false, options: [{ value: 'amber-forest', label: 'amber-forest', swatch: null }], notes: ['Палитры без статьи в справочнике — показан код: amber-forest'] };
const row = (c: HTMLElement, s: string) => c.querySelector(`[data-setting="${s}"]`)!;

describe('PU-08 · настройки на крупном шрифте', () => {
  it('«Вид графа» и «Где открывать запись» — описание над кнопками', () => {
    const { container } = render(<PersonalSettings lang="ru" state={ok()} onChange={() => {}} navTargetUrl={null} palettes={palettes} />);
    for (const s of ['graph_view', 'passport_place', 'text_size']) {
      expect(row(container, s).getAttribute('data-layout'), s).toBe('stack');
    }
  });
  it('вкл/выкл остаются в строке', () => {
    const { container } = render(<PersonalSettings lang="ru" state={ok()} onChange={() => {}} navTargetUrl={null} palettes={palettes} />);
    for (const s of ['stripes', 'peek_hover', 'show_tech']) {
      expect(row(container, s).getAttribute('data-layout'), s).not.toBe('stack');
    }
  });
  it('оговорка о палитрах — только с тех. сведениями', () => {
    const off = render(<PersonalSettings lang="ru" state={ok({ show_tech: false })} onChange={() => {}} navTargetUrl={null} palettes={palettes} />);
    expect(off.container.querySelector('[data-testid="settings-palette-notes"]')).toBeNull();
    off.unmount();
    const on = render(<PersonalSettings lang="ru" state={ok({ show_tech: true })} onChange={() => {}} navTargetUrl={null} palettes={palettes} />);
    expect(on.container.querySelector('[data-testid="settings-palette-notes"]')).toBeTruthy();
  });
});
