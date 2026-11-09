// @vitest-environment jsdom
// Щелчок по строке в разделе без паспорта получает ОТВЕТ, а не пустоту
// (SPRINT_UXR_S4_UI_SHELL_LISTS/S4-V2-SECTIONS).
//
// Фасад записи отдаёт четыре типа (sprint, task, adr, spec), а разделов
// одиннадцать. До этой правки карта паспортов была ПОЛНОЙ по экранам, то есть
// обещала паспорт каждому: открыв строку в «Технологиях», человек получил бы
// пустой паспорт и решил бы, что данные потерялись.
//
// Проверяется сквозное поведение — от щелчка по строке до слов на экране, а не
// содержимое карты: карту можно поправить и забыть про экран (урок сторожа
// `wired.test.ts`: «написано и покрыто тестами» ≠ «дошло до человека»).
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import gameIcons from '@iconify-json/game-icons/icons.json';
import { registerGameIcons, type UrlWindow } from '@seidr/kit';
import { ListScreen } from './ListScreen';

beforeAll(() => { registerGameIcons(gameIcons); });

const json = (body: unknown) =>
  new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });

/** Выдача среза технологий — форма из живого запроса. */
const TECH_ROWS = {
  rows: [{
    spec_id: 'SPEC-TECH-REACT', tech_name: 'React', version: '19.1.0',
    checked_at: '2026-11-01T00:00:00Z', component_id: 'FORSETI',
  }],
  truncated: false,
};

/** Окно со своей историей: раздел пишет состояние в него, а не в глобальное. */
function fakeWin(search = ''): UrlWindow {
  const w = {
    location: { pathname: '/', search, hash: '' },
    history: {
      pushState: (_s: unknown, _t: unknown, url: unknown) => apply(String(url)),
      replaceState: (_s: unknown, _t: unknown, url: unknown) => apply(String(url)),
    },
  };
  function apply(url: string) {
    w.location.search = url.includes('?') ? url.replace(/^[^?]*/, '').replace(/#.*$/, '') : '';
  }
  return w as unknown as UrlWindow;
}

const net = (body: unknown) => vi.fn(async () => json(body)) as unknown as typeof fetch;

describe('раздел без паспорта: отказ назван словами', () => {
  it('положительный контроль: список технологий нарисовался', async () => {
    render(<ListScreen screen="tech" fetchImpl={net(TECH_ROWS)} urlState={fakeWin()} />);
    expect(await screen.findByText('React', {}, { timeout: 8000 })).toBeTruthy();
  });

  it('щелчок по строке говорит, что паспорта у типа нет, и называет раздел и код', async () => {
    render(<ListScreen screen="tech" fetchImpl={net(TECH_ROWS)} urlState={fakeWin()} />);
    const row = await screen.findByText('React', {}, { timeout: 8000 });
    await act(async () => { fireEvent.click(row); });

    const said = await waitFor(() => {
      const t = document.body.textContent ?? '';
      expect(t).toMatch(/паспорт/i);
      return t;
    }, { timeout: 8000 });

    // Назван раздел — чтобы было видно, О ЧЁМ речь…
    expect(said).toContain('Технологии');
    // …и код записи: по нему её можно найти другим путём.
    expect(said).toContain('SPEC-TECH-REACT');
    // Отказ — это состояние, а не ошибка: он объявлен как status.
    expect(document.querySelector('[role="status"]')).toBeTruthy();
  });

  it('сказано и то, что РАБОТАЕТ: иначе отказ читается как «раздел не готов»', async () => {
    render(<ListScreen screen="tech" fetchImpl={net(TECH_ROWS)} urlState={fakeWin()} />);
    const row = await screen.findByText('React', {}, { timeout: 8000 });
    await act(async () => { fireEvent.click(row); });
    await waitFor(() => expect(document.body.textContent ?? '').toMatch(/список|фильтр/i), { timeout: 8000 });
  });

  it('из отказа можно вернуться к списку одной кнопкой', async () => {
    render(<ListScreen screen="tech" fetchImpl={net(TECH_ROWS)} urlState={fakeWin()} />);
    const row = await screen.findByText('React', {}, { timeout: 8000 });
    await act(async () => { fireEvent.click(row); });
    const back = await screen.findByRole('button', { name: /верн/i }, { timeout: 8000 });
    await act(async () => { fireEvent.click(back); });
    await waitFor(() => expect(document.body.textContent ?? '').not.toMatch(/паспорт/i), { timeout: 8000 });
  });
});
