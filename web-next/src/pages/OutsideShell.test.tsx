// @vitest-environment jsdom
// Аудит навигации 08.11.2026, находка P0: «/kit/passport?place=full
// открывается без шапки и левого меню… ⤢ из дока оставляет оболочку на месте —
// то есть проблема не в режиме, а в том, что демо-страница сама живёт вне
// оболочки». Предложение владелицы оттуда же: «демо-страницу оставить витриной
// с явной подписью "демо, вне приложения" и ссылкой "вернуться в LORE"».
//
// Это тот же принцип, что держит весь интерфейс: состояние, о котором человеку
// не сказали, он принимает за обычное. Страница без шапки и меню выглядит как
// сломавшийся LORE, а не как витрина, — пока на ней не написано, что это
// витрина.
//
// Страниц вне оболочки больше одной: кроме витрин /kit и /kit/passport так же
// открываются паспорт задачи и паспорт спринта по прямому адресу
// (App.tsx: «пока отдельные страницы по URL, вне оболочки»). Метка нужна всем
// трём, и текст у витрины и у настоящей записи разный: витрина — демо,
// паспорт — просто открыт вне оболочки.
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { OutsideShell } from './OutsideShell';

describe('метка «вне оболочки»', () => {
  it('положительный контроль: метка отрисована и видна чтению', () => {
    const { container } = render(<OutsideShell kind="demo" />);
    expect(container.querySelector('[data-outside-shell]')).toBeTruthy();
    expect(screen.getByRole('note')).toBeTruthy();
  });

  it('витрина честно называет себя демо вне приложения', () => {
    render(<OutsideShell kind="demo" />);
    expect(screen.getByRole('note').textContent).toMatch(/демо/i);
    expect(screen.getByRole('note').textContent).toMatch(/вне приложения/i);
  });

  it('паспорт по прямому адресу не называется демо — он просто вне оболочки', () => {
    render(<OutsideShell kind="standalone" />);
    const text = screen.getByRole('note').textContent ?? '';
    expect(text).toMatch(/вне оболочки/i);
    expect(text).not.toMatch(/демо/i);
  });

  it('называет, чего именно здесь нет: меню, поиска, команд', () => {
    render(<OutsideShell kind="demo" />);
    const text = screen.getByRole('note').textContent ?? '';
    for (const what of [/меню/i, /поиск/i, /команд/i]) expect(text).toMatch(what);
  });

  it('возврат — ССЫЛКА на LORE, а не кнопка: открыть в новой вкладке, скопировать адрес', () => {
    render(<OutsideShell kind="demo" />);
    const back = screen.getByRole('link', { name: /вернуться в LORE/i });
    expect(back.getAttribute('href')).toBe('/');
    expect(back.tagName).toBe('A');
  });

  it('адрес возврата можно задать — например, в раздел, из которого пришли', () => {
    render(<OutsideShell kind="standalone" back="/?sec=sprint" />);
    expect(screen.getByRole('link', { name: /вернуться в LORE/i }).getAttribute('href')).toBe('/?sec=sprint');
  });
});
