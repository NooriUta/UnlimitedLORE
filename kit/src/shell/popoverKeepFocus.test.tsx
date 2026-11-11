// @vitest-environment jsdom
// Подсказка при наборе (SPRINT_UXR_S10_SEIDR_KIT_2/MD-WINDOW, ADR-LORE-050): мини-окно ссылки
// открывается ПОСРЕДИ набора текста. Обычный поповер уводит фокус внутрь — для меню это
// правильно, а здесь оборвал бы набор: следующая буква ушла бы в поповер, а не в текст.
// takeFocus={false}: фокус остаётся у поля, а Esc и щелчок вне по-прежнему закрывают.
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { Popover } from './Popover';

function Field({ takeFocus, onClose = () => {} }: { takeFocus?: boolean; onClose?: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <textarea aria-label="поле" onChange={() => setOpen(true)} />
      {open && (
        <Popover onClose={() => { onClose(); setOpen(false); }} takeFocus={takeFocus} walk="focusable">
          <button type="button">пункт</button>
        </Popover>
      )}
      <p>снаружи</p>
    </div>
  );
}

describe('Popover takeFocus', () => {
  it('по умолчанию фокус уходит внутрь (меню — как было)', () => {
    render(<Field />);
    const f = screen.getByLabelText('поле');
    f.focus();
    fireEvent.change(f, { target: { value: '@' } });
    expect(document.activeElement).toBe(screen.getByText('пункт'));
  });

  it('takeFocus={false} — фокус остаётся в поле, набор не обрывается', () => {
    render(<Field takeFocus={false} />);
    const f = screen.getByLabelText('поле');
    f.focus();
    fireEvent.change(f, { target: { value: '@' } });
    expect(screen.getByText('пункт')).toBeTruthy();
    expect(document.activeElement).toBe(f);
  });

  it('takeFocus={false} — щелчок вне по-прежнему закрывает', () => {
    const onClose = vi.fn();
    render(<Field takeFocus={false} onClose={onClose} />);
    const f = screen.getByLabelText('поле');
    f.focus();
    fireEvent.change(f, { target: { value: '@' } });
    fireEvent.mouseDown(screen.getByText('снаружи'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
