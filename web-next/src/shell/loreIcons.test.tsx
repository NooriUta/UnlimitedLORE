// @vitest-environment jsdom
// K-14: канон «План» / «Знание» и глиф milestone — у LORE, а рисуются так же офлайн.
import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { GameIcon, hasGameIcon, registerGameIcons } from '@seidr/kit';
import { LORE_ICON_CANON, LORE_LUCIDE_ICONS } from './loreIcons';

describe('иконки разделов LORE', () => {
  it('выбор владелицы 08.11: План — lucide:milestone, Знание — lucide:book-open', () => {
    expect(LORE_ICON_CANON).toEqual({ plan: 'lucide:milestone', knowledge: 'lucide:book-open' });
  });
  it('после регистрации обе иконки есть и рисуются, а не заглушкой', () => {
    registerGameIcons(LORE_LUCIDE_ICONS);
    for (const v of Object.values(LORE_ICON_CANON)) expect(hasGameIcon(v), v).toBe(true);
    const { container } = render(<GameIcon slug="lucide:milestone" />);
    expect(container.querySelector('svg')).not.toBeNull();
    expect(container.querySelector('[data-missing]')).toBeNull();
  });
});
