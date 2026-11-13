// @vitest-environment jsdom
// MP2-14-PLACE-LEFT: место паспорта «слева» в контракте kit — док, граница и меню видов.
import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { RecordDock } from './RecordDock';
import { ViewMenu } from '../list/ViewMenu';

describe('MP2-14 · паспорт слева', () => {
  it('док слева: место отмечено, граница названа «слева»', () => {
    const { container } = render(<RecordDock placement="left" backdrop={<div>список</div>}><p>паспорт</p></RecordDock>);
    expect(container.querySelector('.sk-dock')!.getAttribute('data-placement')).toBe('left');
    expect(screen.getByRole('separator').getAttribute('aria-label')).toMatch(/слева/);
  });
  it('меню видов предлагает «панелью слева»', () => {
    render(<ViewMenu closed="below" modes={['below']} onClosed={() => {}} place="right" onPlace={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /Вид/ }));
    expect(screen.getByRole('radio', { name: 'панелью слева' })).toBeTruthy();
  });
});
