// @vitest-environment jsdom
// S7A-10 (A-часть): пункты паритета SPEC-LORE-UXR-NEWS-PARITY, которые сверка 13.11
// нашла «частично» из-за отсутствия теста: П3 (заголовок дня прилипает), П13
// (скелетон загрузки), П23 (что строка говорит о связанном по виду записи).
// П6/7/15/18/25/28 — на решении владелицы (S7A-11), здесь не трогаются.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import gameIcons from '@iconify-json/game-icons/icons.json';
import { KitLangProvider, registerGameIcons } from '@seidr/kit';
import { NEWS_FIXTURE, NewsFeed, type NewsResponse, type NewsSource } from './index';

beforeAll(() => { registerGameIcons(gameIcons); });

const clone = (): NewsResponse => JSON.parse(JSON.stringify(NEWS_FIXTURE)) as NewsResponse;
const source = (load: NewsSource['load']): NewsSource => ({
  kind: 'live', load, setReadMark: vi.fn(async (at: string) => ({ state: 'ok' as const, at })),
});
const draw = (s: NewsSource) => render(
  <KitLangProvider lang="ru"><NewsFeed source={s} urlPrefix={null} timeZone="Europe/Moscow" /></KitLangProvider>,
);

describe('П3 · заголовок дня прилипает к верху', () => {
  it('день — секция с заголовком sk-news__dayh, а у класса в теме position: sticky; top: 0', async () => {
    draw(source(vi.fn(async () => clone())));
    await screen.findByTestId('news-feed-days');
    const head = document.querySelector('[data-testid^="news-day-"] > h3.sk-news__dayh');
    expect(head, 'заголовок дня — h3.sk-news__dayh внутри секции дня').not.toBeNull();
    const css = readFileSync(join(process.cwd(), '..', 'kit', 'src', 'styles', 'seidr.css'), 'utf8');
    const rule = /\.sk-news__dayh\s*\{([^}]*)\}/.exec(css)?.[1] ?? '';
    expect(rule).toMatch(/position:\s*sticky/);
    expect(rule).toMatch(/top:\s*0/);
  });
});

describe('П13 · пока ответа нет — скелетон, а не пустота и не «ничего не было»', () => {
  it('загрузка висит → скелетон с aria-busy, ни ленты, ни пустого состояния', async () => {
    draw(source(vi.fn(() => new Promise<NewsResponse>(() => {}))));
    const skel = await screen.findByRole('status');
    expect(skel.getAttribute('aria-busy')).toBe('true');
    expect(skel.getAttribute('data-state')).toBe('loading');
    expect(screen.queryByTestId('news-feed-days')).toBeNull();
  });
});

describe('П23 · что строка говорит о связанном — по виду записи', () => {
  it('задача — со спринтом, решение — с ADR, у релиза и спринта таких ссылок нет', async () => {
    const data = clone();
    draw(source(vi.fn(async () => data)));
    await screen.findByTestId('news-feed-days');
    const rows = (type: string) => [...document.querySelectorAll(`.sk-news__row[data-type="${type}"]`)];
    const taskWithSprint = data.events.find(e => e.type === 'task' && e.sprint);
    const decisionWithAdr = data.events.find(e => e.type === 'decision' && e.parent);
    expect(taskWithSprint, 'в выборке есть задача со спринтом').toBeTruthy();
    expect(rows('task').some(r => r.querySelector('[data-testid="news-ref-sprint"]'))).toBe(true);
    if (decisionWithAdr) expect(rows('decision').some(r => r.querySelector('[data-testid="news-ref-adr"]'))).toBe(true);
    for (const type of ['release', 'sprint']) {
      for (const r of rows(type)) {
        expect(r.querySelector('[data-testid="news-ref-sprint"], [data-testid="news-ref-adr"]'), `${type}: связанных ссылок нет`).toBeNull();
      }
    }
  });
});
