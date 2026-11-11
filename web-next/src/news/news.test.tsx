// @vitest-environment jsdom
// SPRINT_UXR_S7A_NEWS/S7A-02 — экран новостей v2 в web-next: маршрут /news,
// лента kit (NewsFeed) и источник данных за флагом. Пока GET /lore/news/v2 не
// на стенде (сервер — после S2), экран работает на фикстуре по контракту и
// говорит об этом; переключение на живой API — одна строка (NEWS_LIVE).
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import gameIcons from '@iconify-json/game-icons/icons.json';
import { KitLangProvider, registerGameIcons } from '@seidr/kit';
import { NEWS_FIXTURE } from './feed';
import App, { routeOf } from '../App';
import { NEWS_LIVE, newsSource, pickNewsSource } from './source';

beforeAll(() => { registerGameIcons(gameIcons); });

describe('S7A-02 · маршрут /news', () => {
  it('routeOf: /news и /news/ — экран новостей; прочее — как было', () => {
    expect(routeOf('/news')).toBe('news');
    expect(routeOf('/news/')).toBe('news');
    expect(routeOf('/kit')).toBe('kit');
    expect(routeOf('/')).toBe('home');
  });

  it('App по /news рисует ленту kit (П25: вход в раздел новостей)', async () => {
    render(<KitLangProvider lang="ru"><App path="/news" /></KitLangProvider>);
    // Источник живой: в тесте сервера нет — лента честно покажет ошибку, но
    // экран новостей (заголовок, полоса) на месте.
    expect(await screen.findByRole('heading', { name: 'Новости' }, { timeout: 5000 })).toBeTruthy();
  });
});

describe('S7A-02 · источник: фикстура за флагом, живой API — одной строкой', () => {
  it('по умолчанию — живой источник (09.11: «новости к серверной части не подключены»), фикстуры нет', () => {
    expect(NEWS_LIVE).toBe(true);
    expect(newsSource.kind).toBe('live');
  });

  it('фикстура отдаёт ответ по контракту', async () => {
    const d = await pickNewsSource(false).load(new URLSearchParams());
    expect(d.events.length).toBe(NEWS_FIXTURE.events.length);
  });

  it('живой источник ходит в GET /lore/news/v2 с параметрами разреза', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(NEWS_FIXTURE), { status: 200 }));
    const live = pickNewsSource(true, fetchMock as unknown as typeof fetch);
    expect(live.kind).toBe('live');
    await live.load(new URLSearchParams('days=7&group_by=type'));
    expect(String((fetchMock.mock.calls[0] as unknown[])[0])).toBe('/lore/news/v2?days=7&group_by=type');
  });

  it('живой источник: 502 — ошибка с кодом, ответ без events — ошибка контракта', async () => {
    const bad = pickNewsSource(true, (async () => new Response(JSON.stringify({ code: 'LORE_UPSTREAM', message: 'down' }), { status: 502 })) as unknown as typeof fetch);
    await expect(bad.load(new URLSearchParams())).rejects.toMatchObject({ status: 502 });
    const noEvents = pickNewsSource(true, (async () => new Response(JSON.stringify({ meta: {} }), { status: 200 })) as unknown as typeof fetch);
    await expect(noEvents.load(new URLSearchParams())).rejects.toThrow(/events/);
  });

  it('черта «прочитано»: PUT /lore/news/v2/read-mark; 503 (схема после S2) — не исключение, а состояние', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ state: 'unavailable', at: null }), { status: 503 }));
    const live = pickNewsSource(true, fetchMock as unknown as typeof fetch);
    const st = await live.setReadMark('2026-11-07T14:42:00Z');
    expect(st.state).toBe('unavailable');
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/lore/news/v2/read-mark');
    expect(init.method).toBe('PUT');
    expect(JSON.parse(String(init.body))).toEqual({ at: '2026-11-07T14:42:00Z' });
  });
});
