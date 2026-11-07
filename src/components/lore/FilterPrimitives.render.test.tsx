import { describe, expect, it, vi } from 'vitest';
import { useState } from 'react';
import { screen, fireEvent } from '@testing-library/react';
import { renderUi } from '../../test/render';
import { Chip, FilterBar } from './FilterPrimitives';

function Harness({ onClear }: { onClear: () => void }) {
  const [open, setOpen] = useState(false);
  const [pressed, setPressed] = useState(false);
  return (
    <FilterBar tier="local" label="Фильтры" activeCount={pressed ? 1 : 0} summaryTags={[]}
      onClear={onClear} open={open} onToggleOpen={() => setOpen(o => !o)}>
      <Chip label="open" pressed={pressed} onClick={() => setPressed(p => !p)} count={3} />
      <Chip label="dropped" pressed={false} onClick={() => {}} count={0} />
    </FilterBar>
  );
}

describe('FilterBar + Chip (render)', () => {
  it('полоса раскрывается целиком, чип переключает aria-pressed, нулевой фасет выключен', () => {
    const onClear = vi.fn();
    renderUi(<Harness onClear={onClear} />);
    const band = screen.getByRole('button', { expanded: false });
    expect(screen.queryByText('open')).toBeNull();

    fireEvent.click(band);
    expect(band).toHaveAttribute('aria-expanded', 'true');
    const chip = screen.getByRole('button', { name: /open/ });
    expect(chip).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('button', { name: /dropped/ })).toBeDisabled();

    fireEvent.click(chip);
    expect(chip).toHaveAttribute('aria-pressed', 'true');
    expect(band).toHaveTextContent('1');
  });
});
