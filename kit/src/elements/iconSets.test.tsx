// @vitest-environment jsdom
// SPRINT_UXR_S7B_ADMIN/S7B-22 — набор иконок со своим префиксом (например,
// официальные логотипы simple-icons у приложения) регистрируется под слагом
// «префикс:имя», как вшитый lucide, а не голым именем: голое имя GameIcon
// рисует как game-icons и показывает заглушку.
import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { GameIcon, hasGameIcon, registerGameIcons } from './GameIcon';

const SET = {
  prefix: 'test-brand',
  icons: { acme: { body: '<path fill="currentColor" d="M0 0h24v24H0z"/>' } },
  width: 24,
  height: 24,
};

describe('registerGameIcons: набор со своим префиксом', () => {
  it('имена доступны как «префикс:имя», голое имя — нет', () => {
    registerGameIcons(SET);
    expect(hasGameIcon('test-brand:acme')).toBe(true);
    expect(hasGameIcon('acme')).toBe(false);
  });
  it('рисуется svg, а не заглушка data-missing', () => {
    registerGameIcons(SET);
    const { container } = render(<GameIcon slug="test-brand:acme" label="Acme" />);
    expect(container.querySelector('svg')).not.toBeNull();
    expect(container.querySelector('[data-missing]')).toBeNull();
  });
});
