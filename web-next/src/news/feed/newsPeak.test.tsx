// @vitest-environment jsdom
// SPRINT_UXR_S9_SCALE_OPT/S9-11 — новости на объёме.
//
// Замер третьего круга критики: в пиковый день 484 события. Лента v2 уже
// раскладывает день по разрезу (проект / компонент / автор) и сворачивает
// группы, но ВНУТРИ группы рисовала все строки подряд. Правило то же, что у
// списков и таблицы задач: не больше LIST_BUDGET.perGroup строк в группе,
// спрятанное названо числом, «ещё N» кликабельно и добавляет следующий шаг.
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import gameIcons from '@iconify-json/game-icons/icons.json';
import { registerGameIcons } from '@seidr/kit';
import { KitLangProvider } from '@seidr/kit';
import { LIST_BUDGET } from '@seidr/kit';
import { NEWS_FIXTURE, NewsFeed, type NewsEvent, type NewsResponse, type NewsSource } from './index';

beforeAll(() => { registerGameIcons(gameIcons); });

const PER = LIST_BUDGET.perGroup;
const DAY = '2026-11-07';

function peak(n: number, axis: 'project' | 'day'): NewsResponse {
  const base = NEWS_FIXTURE.events[1];
  const data = JSON.parse(JSON.stringify(NEWS_FIXTURE)) as NewsResponse;
  data.events = Array.from({ length: n }, (_, i): NewsEvent => ({
    ...base, key: `task:P/T-${i}|changed|${DAY}`, el_key: `task:P/T-${i}`, el: `P/T-${i}`, title: `Событие ${i}`,
    day_local: DAY, projects: ['AIDA/UnlimitedLORE'], unread: false,
  }));
  data.groups = { ...data.groups, axis };
  data.meta = { ...data.meta, read_mark: undefined } as NewsResponse['meta'];
  return data;
}

const source = (data: NewsResponse): NewsSource => ({
  kind: 'live',
  load: vi.fn(async () => data),
  setReadMark: vi.fn(async (at: string) => ({ state: 'ok' as const, at })),
});

async function mount(data: NewsResponse) {
  render(
    <KitLangProvider lang="ru">
      <NewsFeed source={source(data)} urlPrefix={null} timeZone="Europe/Moscow" />
    </KitLangProvider>,
  );
  await screen.findByTestId('news-feed-days');
  return within(screen.getByTestId(`news-day-${DAY}`));
}

const rows = (scope: ReturnType<typeof within>) => scope.queryAllByTestId(/^news-row-/).length;

describe('S9-11 · пиковый день в ленте новостей', () => {
  it('в группе дня не больше perGroup строк, спрятанное названо числом', async () => {
    const day = await mount(peak(120, 'project'));
    expect(rows(day)).toBe(PER);
    expect(day.getByText(`Показаны ${PER} из 120`)).toBeTruthy();
    expect(day.getByRole('button', { name: `ещё ${120 - PER}` })).toBeTruthy();
  });

  it('«ещё N» кликабельно и добавляет следующий шаг, пока не покажет всё', async () => {
    const day = await mount(peak(120, 'project'));
    fireEvent.click(day.getByRole('button', { name: `ещё ${120 - PER}` }));
    expect(rows(day)).toBe(2 * PER);
    fireEvent.click(day.getByRole('button', { name: `ещё ${120 - 2 * PER}` }));
    expect(rows(day)).toBe(120);
    expect(day.queryByRole('button', { name: /^ещё \d+$/ })).toBeNull();
    expect(day.queryByText(/^Показаны \d+ из \d+$/)).toBeNull();
  });

  it('разрез «по дню» (без групп) тоже не рисует весь день разом', async () => {
    const day = await mount(peak(120, 'day'));
    expect(rows(day)).toBe(PER);
    expect(day.getByText(`Показаны ${PER} из 120`)).toBeTruthy();
  });

  it('положительный контроль: день не больше потолка — ни оговорки, ни кнопки', async () => {
    const day = await mount(peak(PER, 'project'));
    expect(rows(day)).toBe(PER);
    expect(day.queryByRole('button', { name: /^ещё \d+$/ })).toBeNull();
  });
});
