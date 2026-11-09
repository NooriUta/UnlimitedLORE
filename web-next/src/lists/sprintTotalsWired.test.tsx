// @vitest-environment jsdom
// Итоги спринта доходят ДО ЭКРАНА: оценка Σ дн и «факт не заполнено»
// (SPRINT_UXR_S4_UI_SHELL_LISTS/S4-09, просьба владелицы 09.11.2026).
//
// Проверка сквозная намеренно — от ответа среза до слов в строке. Урок дня
// (сторож `wired.test.ts`): «посчитано и покрыто тестами» ≠ «видно человеку».
// Разбор ответа проверен в `sprints/sprints.test.tsx`; здесь — что числа
// действительно рисуются, и рисуются честно.
//
// Главное, что здесь закрепляется: КОЛОНКА ФАКТА НЕ ПОКАЗЫВАЕТ НОЛЬ. В корпусе
// LORE `actual_days` не заполнен ни у одной задачи (0 из 1372 по двадцати
// крупнейшим спринтам), поэтому обычная числовая колонка печатала бы ноль, и он
// читался бы как «сделали за 0 дней».
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import gameIcons from '@iconify-json/game-icons/icons.json';
import { registerGameIcons, type UrlWindow } from '@seidr/kit';
import { ListScreen } from '../pages/ListScreen';

beforeAll(() => { registerGameIcons(gameIcons); });

const json = (body: unknown) =>
  new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });

/** Строка слайса спринтов — форма из живой выдачи. */
const SPRINT_ROWS = {
  rows: [{
    sprint_id: 'SPRINT_A', name: 'Спринт А', status_raw: '🔄 IN PROGRESS',
    git_projects: ['AIDA/UnlimitedLORE'], components: ['FORSETI'], release_ids: [],
    milestone_ids: [], priority: 1, valid_from: '2026-11-09T00:00:00Z',
  }],
  truncated: false,
};

/** Итоги: оценка есть у 9 из 14, факт — ни у кого (как в корпусе). */
const TOTALS_ROWS = {
  rows: [{
    sprint_id: 'SPRINT_A', state: 'ok',
    tasks_total: { value: 14, known: 14, of: 14, done: 5 },
    effort_days_total: { value: 12.5, known: 9, of: 14 },
    actual_days_total: { value: null, known: 0, of: 14 },
  }],
  truncated: false,
};

function fakeWin(): UrlWindow {
  const w = {
    location: { pathname: '/', search: '', hash: '' },
    history: { pushState: () => {}, replaceState: () => {} },
  };
  return w as unknown as UrlWindow;
}

/** Сеть, различающая срезы по пути: итоги догружаются вторым запросом. */
function net() {
  const paths: string[] = [];
  const fn = vi.fn(async (input: RequestInfo | URL) => {
    const url = new URL(String(input), 'http://lore.test');
    paths.push(url.pathname);
    if (url.pathname.endsWith('/sprint_totals')) return json(TOTALS_ROWS);
    return json(SPRINT_ROWS);
  });
  return { fetchImpl: fn as unknown as typeof fetch, paths };
}

describe('итоги спринта на экране списка', () => {
  it('положительный контроль: список спринтов нарисовался', async () => {
    const n = net();
    render(<ListScreen screen="sprints" fetchImpl={n.fetchImpl} urlState={fakeWin()} />);
    expect(await screen.findByText('Спринт А', {}, { timeout: 8000 })).toBeTruthy();
  });

  it('итоги берутся из sprint_totals, а не из пачки задач с телами', async () => {
    const n = net();
    render(<ListScreen screen="sprints" fetchImpl={n.fetchImpl} urlState={fakeWin()} />);
    await screen.findByText('Спринт А', {}, { timeout: 8000 });
    await waitFor(() => expect(n.paths.some(p => p.endsWith('/sprint_totals'))).toBe(true), { timeout: 8000 });
    // Прежний источник нёс note_md — 3,6 МБ на двадцать спринтов ради трёх чисел.
    expect(n.paths.some(p => p.endsWith('/tasks_of_sprints_batch'))).toBe(false);
  });

  it('оценка видна числом, и рядом сказано «у 9 из 14» — охват не спрятан', async () => {
    const n = net();
    render(<ListScreen screen="sprints" fetchImpl={n.fetchImpl} urlState={fakeWin()} />);
    await screen.findByText('Спринт А', {}, { timeout: 8000 });
    await waitFor(() => {
      const text = document.body.textContent ?? '';
      expect(text).toMatch(/12,5/);
      expect(text).toMatch(/9 из 14/);
    }, { timeout: 8000 });
  });

  it('факт НЕ показан нулём: сказано «не заполнено»', async () => {
    const n = net();
    render(<ListScreen screen="sprints" fetchImpl={n.fetchImpl} urlState={fakeWin()} />);
    await screen.findByText('Спринт А', {}, { timeout: 8000 });
    await waitFor(() => {
      expect(document.querySelector('[data-sum="empty"]')).toBeTruthy();
      expect(document.body.textContent ?? '').toMatch(/не заполнено/i);
    }, { timeout: 8000 });
  });

  it('задач x/y приходит оттуда же — одно число из одного места', async () => {
    const n = net();
    render(<ListScreen screen="sprints" fetchImpl={n.fetchImpl} urlState={fakeWin()} />);
    await screen.findByText('Спринт А', {}, { timeout: 8000 });
    await waitFor(() => expect(document.body.textContent ?? '').toMatch(/5\/14/), { timeout: 8000 });
  });

  it('заголовки колонок — слова, а не ключи вида «sum:effort_total»', async () => {
    const n = net();
    render(<ListScreen screen="sprints" fetchImpl={n.fetchImpl} urlState={fakeWin()} />);
    await screen.findByText('Спринт А', {}, { timeout: 8000 });
    const text = document.body.textContent ?? '';
    expect(text).not.toMatch(/sum:/);
    expect(text).toMatch(/Оценка, дн/);
  });
});
