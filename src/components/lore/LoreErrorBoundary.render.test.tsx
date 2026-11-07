import { describe, expect, it, vi } from 'vitest';
import { screen, fireEvent } from '@testing-library/react';
import { renderUi } from '../../test/render';
import { LoreErrorBoundary } from './LoreErrorBoundary';

let shouldThrow = true;
function Bomb() {
  if (shouldThrow) throw new Error('boom: слайс не разобран');
  return <span>экран жив</span>;
}

describe('LoreErrorBoundary (render)', () => {
  it('ловит падение рендера, показывает текст ошибки и восстанавливается по «Повторить»', () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    shouldThrow = true;
    renderUi(<LoreErrorBoundary label="Спринты упали"><Bomb /></LoreErrorBoundary>);
    expect(screen.getByText('Спринты упали')).toBeInTheDocument();
    expect(screen.getByText('boom: слайс не разобран')).toBeInTheDocument();

    shouldThrow = false;
    fireEvent.click(screen.getByRole('button'));
    expect(screen.getByText('экран жив')).toBeInTheDocument();
    err.mockRestore();
  });
});
