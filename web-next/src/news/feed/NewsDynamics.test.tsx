// @vitest-environment jsdom
// SPRINT_UXR_S7A_NEWS/S7A-11 — блок «Динамика» новостей: неделя к неделе / месяц к месяцу.
// Числа считает сервер (GET /lore/news/v2/dynamics, S7A-09) — клиент только рисует:
// значение, Δ и % (если прислан), мини-ряд с подсказками, честные состояния.
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import gameIcons from '@iconify-json/game-icons/icons.json';
import { KitLangProvider, registerGameIcons } from '@seidr/kit';
import {
  DEFAULT_NEWS_QUERY, NEWS_DYNAMICS_FIXTURE, NEWS_FIXTURE, NewsDynamicsPanel, NewsFeed, NewsHttpError,
  dynamicsParams, parseDynamicsResponse, type NewsDynamicsResponse, type NewsQuery, type NewsResponse, type NewsSource,
} from './index';

beforeAll(() => { registerGameIcons(gameIcons); });

function clone<T>(x: T): T { return JSON.parse(JSON.stringify(x)) as T; }

function src(dyn: NewsDynamicsResponse | Error = clone(NEWS_DYNAMICS_FIXTURE)): NewsSource & { dcalls: URLSearchParams[] } {
  const dcalls: URLSearchParams[] = [];
  return {
    kind: 'live',
    dcalls,
    load: vi.fn(async () => clone(NEWS_FIXTURE) as NewsResponse),
    setReadMark: vi.fn(async (at: string) => ({ state: 'ok', at })),
    loadDynamics: vi.fn(async (p: URLSearchParams) => {
      dcalls.push(new URLSearchParams(p));
      if (dyn instanceof Error) throw dyn;
      return dyn;
    }),
  };
}

function mountPanel(source: NewsSource, query: NewsQuery = DEFAULT_NEWS_QUERY, lang: 'ru' | 'en' = 'ru') {
  return render(
    <KitLangProvider lang={lang}>
      <NewsDynamicsPanel source={source} query={query} urlPrefix={null} />
    </KitLangProvider>,
  );
}

describe('S7A-11 · параметры запроса динамики', () => {
  it('фильтры ленты и скоуп уходят тем же параметром, период — week/month', () => {
    const q: NewsQuery = { ...DEFAULT_NEWS_QUERY, filters: { project: ['lore'], type: ['task'], who: ['Мара'] }, els: ['task:S/T-1'] };
    const p = dynamicsParams(q, 'month', { component: 'lore-news' });
    expect(p.get('period')).toBe('month');
    expect(p.get('project')).toBe('lore');
    expect(p.get('type')).toBe('task');
    expect(p.get('component')).toBe('lore-news');
    // Фильтры события тоже уходят: сервер называет их неприменимыми, а не клиент молча снимает.
    expect(p.get('who')).toBe('Мара');
    expect(p.get('els')).toBe('task:S/T-1');
    expect(p.get('days')).toBeNull();
    expect(p.get('group_by')).toBeNull();
  });

  it('разбор: ответ без метрик — ошибка формы, а не пустая динамика', () => {
    expect(() => parseDynamicsResponse({ buckets: [], meta: {} })).toThrow();
    expect(parseDynamicsResponse(clone(NEWS_DYNAMICS_FIXTURE)).metrics).toHaveLength(5);
  });
});

describe('S7A-11 · блок «Динамика»', () => {
  it('пять показателей в порядке владелицы, число, Δ и % к прошлой неделе', async () => {
    mountPanel(src());
    const cards = await screen.findAllByTestId(/^news-dyn-card-/);
    expect(cards.map(c => c.getAttribute('data-testid'))).toEqual([
      'news-dyn-card-tasks_closed', 'news-dyn-card-tasks_created', 'news-dyn-card-sprints_closed',
      'news-dyn-card-releases', 'news-dyn-card-accepted',
    ]);
    const closed = screen.getByTestId('news-dyn-card-tasks_closed');
    expect(within(closed).getByTestId('news-dyn-value').textContent).toBe('12');
    expect(within(closed).getByTestId('news-dyn-delta').textContent).toBe('+4 · +50 %');
    expect(within(closed).getByTestId('news-dyn-delta').getAttribute('title')).toMatch(/неделе.*8/);
    expect(screen.getByTestId('news-dynamics').textContent).toMatch(/неделя к неделе/);
  });

  it('прошлый период 0 — процента нет, только Δ', async () => {
    mountPanel(src());
    const rel = await screen.findByTestId('news-dyn-card-releases');
    expect(within(rel).getByTestId('news-dyn-delta').textContent).toBe('+2');
  });

  it('мини-ряд по периодам: значение каждого — в подсказке, текущий помечен «идёт»', async () => {
    mountPanel(src());
    const closed = await screen.findByTestId('news-dyn-card-tasks_closed');
    const bars = within(closed).getAllByTestId(/^news-dyn-bar-/);
    expect(bars).toHaveLength(12);
    const last = bars[11];
    expect(last.getAttribute('title')).toMatch(/W46/);
    expect(last.getAttribute('title')).toMatch(/12/);
    expect(last.getAttribute('title')).toMatch(/идёт/);
    expect(last.getAttribute('data-current')).toBe('true');
  });

  it('«не смогли посчитать» с причиной — не ноль; честный ноль — «0»', async () => {
    const d = clone(NEWS_DYNAMICS_FIXTURE);
    d.metrics[1] = { id: 'tasks_created', state: 'unavailable', reason: 'tasks: timeout', forbidden: false, value: null, series: null };
    d.metrics[2] = { ...d.metrics[2], value: 0, previous: 0, delta: 0, pct: null, series: Array(12).fill(0) };
    mountPanel(src(d));
    const created = await screen.findByTestId('news-dyn-card-tasks_created');
    expect(created.getAttribute('data-state')).toBe('unavailable');
    expect(created.textContent).toMatch(/не смогли посчитать/);
    expect(created.textContent).toMatch(/tasks: timeout/);
    expect(within(created).queryByTestId('news-dyn-value')).toBeNull();
    const sprints = screen.getByTestId('news-dyn-card-sprints_closed');
    expect(within(sprints).getByTestId('news-dyn-value').textContent).toBe('0');
    expect(within(sprints).getByTestId('news-dyn-delta').textContent).toBe('0');
  });

  it('метрика вне фильтра типа — так и сказано, без числа', async () => {
    const d = clone(NEWS_DYNAMICS_FIXTURE);
    d.metrics[3] = { id: 'releases', state: 'filtered_out', value: null, series: null };
    mountPanel(src(d));
    const rel = await screen.findByTestId('news-dyn-card-releases');
    expect(rel.getAttribute('data-state')).toBe('filtered_out');
    expect(rel.textContent).toMatch(/фильтр/i);
    expect(within(rel).queryByTestId('news-dyn-value')).toBeNull();
  });

  it('исключённое названо числом, неприменимые фильтры названы', async () => {
    const d = clone(NEWS_DYNAMICS_FIXTURE);
    d.meta.ignored_filters = ['who'];
    mountPanel(src(d));
    const closed = await screen.findByTestId('news-dyn-card-tasks_closed');
    expect(within(closed).getByTestId('news-dyn-excluded').textContent).toMatch(/задним числом.*3/);
    expect(screen.getByTestId('news-dyn-ignored').textContent).toMatch(/Кто/);
  });

  it('переключатель Неделя / Месяц — новый запрос с period=month', async () => {
    const s = src();
    mountPanel(s);
    await screen.findAllByTestId(/^news-dyn-card-/);
    expect(s.dcalls[0].get('period')).toBe('week');
    fireEvent.click(screen.getByRole('radio', { name: 'Месяц' }));
    await waitFor(() => expect(s.dcalls[s.dcalls.length - 1].get('period')).toBe('month'));
  });

  it('фильтр ленты применяется к динамике', async () => {
    const s = src();
    mountPanel(s, { ...DEFAULT_NEWS_QUERY, filters: { project: ['lore'] } });
    await screen.findAllByTestId(/^news-dyn-card-/);
    expect(s.dcalls[0].get('project')).toBe('lore');
  });

  it('загрузка — скелет; отказ по правам — «нет прав», а не пусто', async () => {
    const s = src(new NewsHttpError(403, 'FORBIDDEN', '403 нет прав'));
    mountPanel(s);
    expect(screen.getByTestId('news-dynamics').querySelector('[aria-busy="true"], .sk-skeleton')).not.toBeNull();
    await waitFor(() => expect(screen.getByTestId('news-dynamics').textContent).toMatch(/прав/i));
    expect(screen.queryAllByTestId(/^news-dyn-card-/)).toHaveLength(0);
  });

  it('источник без динамики (фикстура без неё) — «не смогли посчитать», не пусто', async () => {
    const s = src();
    delete (s as Partial<NewsSource>).loadDynamics;
    mountPanel(s);
    await waitFor(() => expect(screen.getByTestId('news-dynamics').textContent).toMatch(/не смогли посчитать/));
  });

  it('на экране новостей — в «все метрики», первым блоком', async () => {
    const s = src();
    render(
      <KitLangProvider lang="ru">
        <NewsFeed source={s} urlPrefix={null} timeZone="Europe/Moscow" />
      </KitLangProvider>,
    );
    await screen.findByTestId('news-feed-days');
    expect(s.loadDynamics).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId('news-strip-toggle'));
    const more = screen.getByTestId('news-more');
    await within(more).findAllByTestId(/^news-dyn-card-/);
    expect(more.firstElementChild?.getAttribute('data-testid')).toBe('news-dynamics');
  });

  it('en: подписи на английском', async () => {
    mountPanel(src(), DEFAULT_NEWS_QUERY, 'en');
    await screen.findAllByTestId(/^news-dyn-card-/);
    expect(screen.getByTestId('news-dynamics').textContent).toMatch(/week over week/);
    expect(screen.getByRole('radio', { name: 'Month' })).toBeTruthy();
  });
});
