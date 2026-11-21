// @vitest-environment jsdom
// Dialog и ReasonDialog — центрированное окно (SPRINT_LORE_MODEL_AS_CONFIG/MC-06).
//
// Повод: экран «Модель» — «Применить…» и откат требуют «что и зачем», экран правки поля открывается
// окном по центру (на телефоне — во весь экран, правило в seidr.css по общему порогу узкого экрана).
// Sheet — панель сбоку; центрированного окна в kit не было.
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { KitLangProvider } from '../i18n';
import { Dialog, ReasonDialog } from './Dialog';

describe('Dialog', () => {
  it('закрыт — ничего не рисует', () => {
    render(<Dialog open={false} onClose={vi.fn()} title="Окно">тело</Dialog>);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('открыт — модальный диалог с именем по заголовку, тело и действия', () => {
    render(<KitLangProvider lang="ru"><Dialog open onClose={vi.fn()} title="Поле title" actions={<button type="button">В дифф</button>}>тело</Dialog></KitLangProvider>);
    const d = screen.getByRole('dialog', { name: 'Поле title' });
    expect(d.getAttribute('aria-modal')).toBe('true');
    expect(d.className).toContain('sk-dialog');
    expect(d.textContent).toContain('тело');
    expect(screen.getByRole('button', { name: 'В дифф' })).toBeTruthy();
  });

  it('Esc, «Закрыть» и подложка закрывают', () => {
    const onClose = vi.fn();
    render(<KitLangProvider lang="ru"><Dialog open onClose={onClose} title="Окно"><input aria-label="поле" /></Dialog></KitLangProvider>);
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    fireEvent.click(screen.getByRole('button', { name: 'Закрыть' }));
    fireEvent.click(document.querySelector('.sk-dialog-backdrop')!);
    expect(onClose).toHaveBeenCalledTimes(3);
  });

  it('size=wide даёт широкую раскладку', () => {
    render(<Dialog open onClose={vi.fn()} title="Окно" size="wide">x</Dialog>);
    expect(screen.getByRole('dialog').className).toContain('sk-dialog--wide');
  });
});

describe('ReasonDialog — подтверждение с обязательной причиной', () => {
  it('без причины «Подтвердить» недоступно; пробелы — не причина', () => {
    const onConfirm = vi.fn();
    render(<KitLangProvider lang="ru"><ReasonDialog open onClose={vi.fn()} title="Применить?" confirmLabel="Применить" onConfirm={onConfirm}>что будет</ReasonDialog></KitLangProvider>);
    const ok = screen.getByRole('button', { name: 'Применить' }) as HTMLButtonElement;
    expect(ok.disabled).toBe(true);
    fireEvent.change(screen.getByRole('textbox', { name: /Причина/ }), { target: { value: '   ' } });
    expect(ok.disabled).toBe(true);
    fireEvent.change(screen.getByRole('textbox', { name: /Причина/ }), { target: { value: '  подпись кода ' } });
    expect(ok.disabled).toBe(false);
    fireEvent.click(ok);
    expect(onConfirm).toHaveBeenCalledWith('подпись кода');
  });

  it('своя подпись поля причины; занято — кнопка недоступна; ошибка — role=alert', () => {
    render(<KitLangProvider lang="ru"><ReasonDialog open onClose={vi.fn()} title="Откат" confirmLabel="Откатить" reasonLabel="Что и зачем" busy error="409: модель изменилась" onConfirm={vi.fn()} /></KitLangProvider>);
    fireEvent.change(screen.getByRole('textbox', { name: 'Что и зачем' }), { target: { value: 'вернуть' } });
    expect((screen.getByRole('button', { name: 'Откатить' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByRole('alert').textContent).toContain('409');
  });

  it('«Отмена» закрывает; английская локаль', () => {
    const onClose = vi.fn();
    render(<KitLangProvider lang="en"><ReasonDialog open onClose={onClose} title="Apply?" confirmLabel="Apply" onConfirm={vi.fn()} /></KitLangProvider>);
    expect(screen.getByRole('textbox', { name: /Reason/ })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onClose).toHaveBeenCalled();
  });
});
