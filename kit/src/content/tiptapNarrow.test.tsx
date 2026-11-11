// @vitest-environment jsdom
// SPRINT_UXR_S4_UI_SHELL_LISTS/S4-MOBILE-EDGE п.А — правка MD на телефоне.
// Замер на живом v2 (360×800, pointer: coarse): панель 225×241 px — 19 кнопок
// в 5 рядов, поле .ProseMirror 207 px. Узко (≤720, useNarrow): одна строка
// главных кнопок + «ещё ▾», остальное — под «ещё»; ни одна функция не
// пропадает (правило владелицы). Широко — панель прежняя (положительный контроль).
import { describe, expect, it } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { TipTapField } from './index';
import { NARROW_QUERY } from '../core/narrow';

const ALL = [
  'отменить', 'повторить', 'жирный', 'курсив', 'зачёркнутый', 'код', 'ссылка',
  'заголовок 1', 'заголовок 2', 'заголовок 3',
  'маркированный список', 'нумерованный список', 'чек-лист', 'цитата', 'разделитель', 'формула',
  'вставить таблицу', 'markdown-источника',
];
const PRIMARY = ['отменить', 'жирный', 'курсив', 'ссылка', 'маркированный список'];

const names = (root: HTMLElement) => within(root).getAllByRole('button').map(b => b.getAttribute('aria-label') ?? '');
const has = (list: string[], word: string) => list.some(n => n.toLowerCase().includes(word.toLowerCase()));

async function mount(narrow: boolean | undefined) {
  const r = render(<TipTapField value="текст" onChange={() => {}} ariaLabel="Заметка" narrow={narrow} />);
  await waitFor(() => expect(screen.getByRole('toolbar')).toBeTruthy());
  return r;
}

describe('S4-MOBILE-EDGE п.А — панель TipTap узко', () => {
  it('широко — все кнопки сразу, кнопки «ещё» нет (положительный контроль)', async () => {
    await mount(false);
    const list = names(screen.getByRole('toolbar'));
    for (const w of ALL) expect(has(list, w), w).toBe(true);
    expect(screen.queryByRole('button', { name: /ещё/i })).toBeNull();
  });

  it('узко — видны только главные кнопки и «ещё ▾» (свёрнуто)', async () => {
    await mount(true);
    const list = names(screen.getByRole('toolbar'));
    expect(list.length).toBe(PRIMARY.length + 1);
    for (const w of PRIMARY) expect(has(list, w), w).toBe(true);
    const more = screen.getByRole('button', { name: /ещё/i });
    expect(more.getAttribute('aria-expanded')).toBe('false');
  });

  it('узко — «ещё» раскрывает остальные: ни одна функция не пропала', async () => {
    await mount(true);
    fireEvent.click(screen.getByRole('button', { name: /ещё/i }));
    expect(screen.getByRole('button', { name: /ещё/i }).getAttribute('aria-expanded')).toBe('true');
    const list = names(screen.getByRole('toolbar'));
    for (const w of ALL) expect(has(list, w), w).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: /ещё/i }));
    expect(names(screen.getByRole('toolbar')).length).toBe(PRIMARY.length + 1);
  });

  it('узко — кнопка из «ещё» действует (заголовок 2 ставит h2)', async () => {
    const { container } = await mount(true);
    fireEvent.click(screen.getByRole('button', { name: /ещё/i }));
    const h2 = within(screen.getByRole('toolbar')).getAllByRole('button').find(b => /заголовок 2/i.test(b.getAttribute('aria-label') ?? ''))!;
    act(() => { fireEvent.click(h2); });
    await waitFor(() => expect(container.querySelector('.ProseMirror h2')).toBeTruthy());
  });

  it('без явного narrow — по matchMedia(max-width: 720px)', async () => {
    const w = window as unknown as { matchMedia?: unknown };
    const orig = w.matchMedia;
    w.matchMedia = (q: string) => ({ matches: q === NARROW_QUERY, addEventListener() {}, removeEventListener() {} });
    try {
      await mount(undefined);
      expect(screen.getByRole('button', { name: /ещё/i })).toBeTruthy();
    } finally {
      w.matchMedia = orig;
    }
  });

});
