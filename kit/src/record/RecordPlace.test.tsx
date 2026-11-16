// @vitest-environment jsdom
// Смена места паспорта (MP2-11) — в kit (SPRINT_UXR_S14_KIT5/K5-PASSPORT-FROM-MODEL, шаг 4:
// экран «список + паспорт» переезжает в kit по частям). Раньше жила в web-next без своего теста.
//
// Владелица 13–14.11: ⤢ — одним нажатием во весь экран и обратно, в место входа; меню мест —
// своя кнопка ☰; «если в полный экран выходили справа, то и возвращаться должно справа».
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { KitLangProvider } from '../i18n';
import { RecordPlace } from './RecordPlace';

const wrap = (n: React.ReactNode) => render(<KitLangProvider lang="ru">{n}</KitLangProvider>);

describe('RecordPlace', () => {
  it('⤢ из панели — во весь экран', () => {
    const onPlace = vi.fn();
    wrap(<RecordPlace value="right" onPlace={onPlace} />);
    fireEvent.click(screen.getByRole('button', { name: 'Во весь экран' }));
    expect(onPlace).toHaveBeenCalledWith('full');
  });

  it('⤢ из полного экрана — обратно в место входа (снизу), а не всегда вправо', () => {
    const onPlace = vi.fn();
    wrap(<RecordPlace value="full" back="bottom" onPlace={onPlace} />);
    const btn = screen.getByRole('button', { name: 'Вернуть на место' });
    expect(btn.getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(btn);
    expect(onPlace).toHaveBeenCalledWith('bottom');
  });

  it('места входа нет — возврат справа', () => {
    const onPlace = vi.fn();
    wrap(<RecordPlace value="full" onPlace={onPlace} />);
    fireEvent.click(screen.getByRole('button', { name: 'Вернуть на место' }));
    expect(onPlace).toHaveBeenCalledWith('right');
  });

  it('☰ — меню мест kit с отметкой текущего; выбор закрывает меню', () => {
    const onPlace = vi.fn();
    wrap(<RecordPlace value="bottom" onPlace={onPlace} />);
    fireEvent.click(screen.getByRole('button', { name: 'Где открыт' }));
    const items = screen.getAllByRole('menuitemradio');
    expect(items.map(i => i.textContent)).toEqual(['панелью слева', 'панелью справа', 'снизу', 'на весь экран']);
    expect(items.find(i => i.getAttribute('aria-checked') === 'true')?.textContent).toBe('снизу');
    fireEvent.click(items[1]);
    expect(onPlace).toHaveBeenCalledWith('right');
    expect(screen.queryByRole('menuitemradio')).toBeNull();
  });
});
