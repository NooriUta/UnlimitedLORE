import { describe, expect, it, vi } from 'vitest';
import { screen, fireEvent } from '@testing-library/react';
import { renderUi } from '../../test/render';
import { LoreLinkChips } from './LoreLinkChips';

describe('LoreLinkChips (render)', () => {
  it('показывает привязанные чипы, удаляет по ✕ и привязывает из выпадашки только непривязанные', () => {
    const onAdd = vi.fn();
    const onRemove = vi.fn();
    renderUi(<LoreLinkChips label="Модули" values={['LORE']} options={['LORE', 'MIMIR', 'HEIMDALL']} onAdd={onAdd} onRemove={onRemove} />);

    expect(screen.getByText('Модули')).toBeInTheDocument();
    expect(screen.getByText('LORE')).toBeInTheDocument();
    const select = screen.getByRole('combobox');
    const optionValues = Array.from((select as HTMLSelectElement).options).map(o => o.value);
    expect(optionValues).toEqual(['', 'MIMIR', 'HEIMDALL']);

    fireEvent.change(select, { target: { value: 'MIMIR' } });
    expect(onAdd).toHaveBeenCalledWith('MIMIR');
    fireEvent.click(screen.getByRole('button', { name: '✕' }));
    expect(onRemove).toHaveBeenCalledWith('LORE');
  });

  it('disabled: выпадашки нет, есть подсказка сохранить', () => {
    renderUi(<LoreLinkChips label="Модули" values={[]} options={['LORE']} onAdd={() => {}} onRemove={() => {}} disabled />);
    expect(screen.queryByRole('combobox')).toBeNull();
    expect(screen.getByText('сохраните, чтобы связать')).toBeInTheDocument();
  });
});
