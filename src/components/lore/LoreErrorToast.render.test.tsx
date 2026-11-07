import { describe, expect, it, vi } from 'vitest';
import { screen, fireEvent } from '@testing-library/react';
import { renderUi, renderedNodes } from '../../test/render';
import { LoreErrorToast } from './LoreErrorToast';

describe('LoreErrorToast (render)', () => {
  it('нет текста — ничего не рисует; есть — alert с текстом и закрытием', () => {
    const onClose = vi.fn();
    const { container, rerender } = renderUi(<LoreErrorToast text={null} onClose={onClose} />);
    expect(renderedNodes(container)).toHaveLength(0);

    rerender(<LoreErrorToast text="409 Conflict" onClose={onClose} />);
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('409 Conflict');
    fireEvent.click(screen.getByRole('button'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('закрывается сам через 10 секунд', () => {
    vi.useFakeTimers();
    try {
      const onClose = vi.fn();
      renderUi(<LoreErrorToast text="500" onClose={onClose} />);
      vi.advanceTimersByTime(9999);
      expect(onClose).not.toHaveBeenCalled();
      vi.advanceTimersByTime(1);
      expect(onClose).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
});
