// SPRINT_UXR_S0_SAFETY/S0-07 — тап-цели тулбара TipTap рендером, а не поиском строк.
//
// Раньше tap-targets.test.ts требовал в исходнике TipTapField.tsx строку
// `className="lore-tap"` и отсутствие `minWidth: 22`. Вынос кнопки в отдельный
// файл ронял тест, а кнопка без класса рядом с той же строкой в другом месте
// проходила. Теперь проверяется то, что получает пользователь: каждая кнопка
// тулбара несёт класс общего правила тап-целей и не прибита инлайном к 22px
// (инлайн min-width перебивает класс).
import { describe, expect, it } from 'vitest';
import { screen, within } from '@testing-library/react';
import i18n from '../../i18n';
import { renderUi } from '../../test/render';
import TipTapField from './TipTapField';

describe('TipTapField · тулбар подключён к правилу тап-целей (render)', () => {
  it('каждая кнопка тулбара — .lore-tap, min-width не прибит к 22px', async () => {
    renderUi(<TipTapField value="текст" onChange={() => {}} ariaLabel="поле" />);
    const bold = await screen.findByRole('button', { name: i18n.t('lore.tiptap.bold') });
    const toolbar = bold.parentElement!.closest('div')!;
    const buttons = within(toolbar.parentElement ?? toolbar).getAllByRole('button');
    expect(buttons.length).toBeGreaterThan(5);
    for (const b of buttons) {
      expect(b, b.getAttribute('aria-label') ?? b.textContent ?? '').toHaveClass('lore-tap');
      expect(b.style.minWidth).not.toBe('22px');
    }
  });

  it('в режиме только-чтения тулбара нет', async () => {
    renderUi(<TipTapField value="текст" onChange={() => {}} editable={false} ariaLabel="поле" />);
    // дать редактору смонтироваться
    await new Promise(r => setTimeout(r, 0));
    expect(screen.queryByRole('button', { name: i18n.t('lore.tiptap.bold') })).toBeNull();
  });
});
