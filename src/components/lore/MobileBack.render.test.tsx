import { describe, expect, it, vi } from 'vitest';
import { screen, fireEvent } from '@testing-library/react';
import { renderUi } from '../../test/render';
import { MobileBack } from './MobileBack';

describe('MobileBack (render)', () => {
  it('кнопка «назад» с переводом из локали и своей подписью', () => {
    const onBack = vi.fn();
    const { rerender } = renderUi(<MobileBack onBack={onBack} />);
    const btn = screen.getByRole('button');
    expect(btn.textContent).toMatch(/^← \S/);
    fireEvent.click(btn);
    expect(onBack).toHaveBeenCalledTimes(1);

    rerender(<MobileBack onBack={onBack} label="к списку" />);
    expect(screen.getByRole('button')).toHaveTextContent('← к списку');
  });
});
