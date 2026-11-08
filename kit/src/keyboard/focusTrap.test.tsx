// @vitest-environment jsdom
// SPRINT_UXR_S4_UI_SHELL_LISTS/S4-11 — фокус во всплывающих окнах: внутрь при
// открытии, Tab не уходит наружу, Esc закрывает, фокус возвращается на
// кнопку-открыватель. Общий хук для Sheet, статус-поповера и окон приложений.
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { useRef, useState } from 'react';
import { useFocusTrap } from './focusTrap';

function Popup({ onEscape }: { onEscape?: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>открыть</button>
      <button type="button">снаружи</button>
      {open && <Inner onClose={() => { setOpen(false); onEscape?.(); }} />}
    </>
  );
}

function Inner({ onClose }: { onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const onKeyDown = useFocusTrap(ref, { onEscape: onClose });
  return (
    <div ref={ref} role="dialog" aria-label="окно" tabIndex={-1} onKeyDown={onKeyDown}>
      <button type="button">первая</button>
      <button type="button" disabled>выключена</button>
      <button type="button">последняя</button>
    </div>
  );
}

describe('useFocusTrap', () => {
  it('при открытии фокус — на первом фокусируемом внутри', () => {
    render(<Popup />);
    fireEvent.click(screen.getByText('открыть'));
    expect(document.activeElement).toBe(screen.getByText('первая'));
  });

  it('Tab с последнего — на первый, Shift+Tab с первого — на последний', () => {
    render(<Popup />);
    const opener = screen.getByText('открыть');
    opener.focus();
    fireEvent.click(opener);
    const first = screen.getByText('первая');
    const last = screen.getByText('последняя');
    fireEvent.keyDown(first, { key: 'Tab', code: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(last);
    fireEvent.keyDown(last, { key: 'Tab', code: 'Tab' });
    expect(document.activeElement).toBe(first);
  });

  it('Esc закрывает и возвращает фокус на открыватель', () => {
    const onEscape = vi.fn();
    render(<Popup onEscape={onEscape} />);
    const opener = screen.getByText('открыть');
    opener.focus();
    fireEvent.click(opener);
    fireEvent.keyDown(screen.getByText('первая'), { key: 'Escape', code: 'Escape' });
    expect(onEscape).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(opener);
  });
});
