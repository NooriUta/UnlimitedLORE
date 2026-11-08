// @vitest-environment jsdom
// Аудит навигации 08.11.2026, находка P0: «Esc в палитре — диалог остаётся
// видимым (display:flex, opacity:1, 640×111) — и при Esc на document, и при
// Esc в поле. Закрыть можно только кликом мимо».
//
// Разбор. Esc был привязан к ПОЛЮ ВВОДА (onKeyDown у input). Пока фокус в поле,
// это работает; но фокус в поле держится не всегда — щелчок по строке выдачи,
// по заголовку диалога, по подложке уводит его, и тогда Esc проваливается в
// страницу. Проверка аудита шла событием на document — то есть ровно тот
// случай, когда клавиша не работала.
//
// Что закрепляем: палитра слушает Esc на документе, пока открыта, — независимо
// от того, где фокус. Поле ввода продолжает гасить событие (stopPropagation),
// чтобы Esc не уехал дальше — в док под палитрой.
import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { createSafeStorage } from '../resilience/safeStorage';
import type { KitCtx } from '../core/contract';
import { CommandPalette } from './Palette';
import { createRecentList } from './paletteModel';
import { fixtureConfig, fixtureData } from './fixtures.test-helper';

const ctx: KitCtx = {
  data: fixtureData(), config: fixtureConfig(), href: id => `#rec=${id}`, esc: s => s, md: s => s,
};

function setup() {
  const recent = createRecentList(createSafeStorage(() => null));
  const onClose = vi.fn();
  function Harness() {
    const [open, setOpen] = useState(true);
    return (
      <CommandPalette
        open={open}
        mode="all"
        onClose={() => { onClose(); setOpen(false); }}
        ctx={ctx}
        recent={recent}
      />
    );
  }
  render(<Harness />);
  return { onClose };
}

const escOn = (t: Document | HTMLElement) =>
  act(() => { fireEvent.keyDown(t, { key: 'Escape', code: 'Escape' }); });

describe('Esc в палитре — находка P0 аудита 08.11', () => {
  it('положительный контроль: палитра открыта', () => {
    setup();
    expect(screen.getByRole('dialog')).toBeTruthy();
  });

  it('Esc на документе закрывает палитру (так её и проверяли)', () => {
    const { onClose } = setup();
    escOn(document);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('Esc в поле ввода тоже закрывает — и ровно один раз', () => {
    const { onClose } = setup();
    escOn(screen.getByRole('combobox') as HTMLElement);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('Esc из поля не уезжает дальше в страницу: док под палитрой его не увидит', () => {
    const seenByPage = vi.fn();
    document.addEventListener('keydown', seenByPage);
    try {
      setup();
      fireEvent.keyDown(screen.getByRole('combobox'), { key: 'Escape', code: 'Escape' });
      expect(seenByPage).not.toHaveBeenCalled();
    } finally {
      document.removeEventListener('keydown', seenByPage);
    }
  });

  it('закрытая палитра клавиатуру не слушает', () => {
    const recent = createRecentList(createSafeStorage(() => null));
    const onClose = vi.fn();
    render(<CommandPalette open={false} mode="all" onClose={onClose} ctx={ctx} recent={recent} />);
    escOn(document);
    expect(onClose).not.toHaveBeenCalled();
  });
});
