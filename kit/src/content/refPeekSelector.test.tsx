// @vitest-environment jsdom
// Peek не только для ссылок в тексте (владелица 11.11.2026: «и к новостям тоже приделай peek»).
// Слой useRefPeek тот же — время, место, лист; меняется только то, ЧТО считать ссылкой:
// selector + data-ref / data-ref-type. Строка ленты не притворяется вики-ссылкой.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { useRefPeek, type MartRefPeek } from './RefPeekLayer';

const peek: MartRefPeek = { render: r => <div>карточка {r.type}:{r.id}</div>, title: r => r.id };

function Feed({ selector }: { selector?: string }) {
  const { handlers, layer } = useRefPeek(peek, selector ? { selector } : undefined);
  return (
    <div {...handlers}>
      <a className="row-link" href="/p/T-1" data-ref="SPRINT_X/T-1" data-ref-type="task">Задача</a>
      {layer}
    </div>
  );
}

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

describe('useRefPeek — свой селектор', () => {
  it('строка ленты (свой класс) открывает ту же карточку по наведению', () => {
    const { container } = render(<Feed selector=".row-link" />);
    fireEvent.mouseOver(container.querySelector('.row-link')!);
    act(() => { vi.advanceTimersByTime(450); });
    expect(screen.getByText('карточка task:SPRINT_X/T-1')).toBeTruthy();
  });
  it('без селектора — только вики-ссылки (.sk-wref), чужие ссылки карточку не открывают', () => {
    const { container } = render(<Feed />);
    fireEvent.mouseOver(container.querySelector('.row-link')!);
    act(() => { vi.advanceTimersByTime(450); });
    expect(screen.queryByText(/карточка/)).toBeNull();
  });
});
