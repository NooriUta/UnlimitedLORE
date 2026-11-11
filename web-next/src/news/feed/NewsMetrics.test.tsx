// @vitest-environment jsdom
// SPRINT_UXR_S7A_NEWS/S7A-03 — метрики-свёртки с дельтой к прошлому периоду и
// клик по числу → фильтр ленты. Сервер (f525c294) присылает metrics.counts,
// metrics.tasks (примеры ≤ 10), metrics.delta и filter-дескрипторы групп;
// клиент только рисует и превращает клик в параметр запроса (filter/els).
// Ни одного числа клиент не выводит сам (SPEC-LORE-UXR-NEWS-ALGORITHMS 1.3.0).
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import gameIcons from '@iconify-json/game-icons/icons.json';
import { registerGameIcons } from '@seidr/kit';
import { KitLangProvider } from '@seidr/kit';
import {
  DEFAULT_NEWS_QUERY, NEWS_FIXTURE, NewsFeed, buildNewsParams, metricDrill, readNewsQuery, writeNewsQuery,
  type NewsResponse, type NewsSource,
} from './index';

beforeAll(() => { registerGameIcons(gameIcons); });

function clone(): NewsResponse { return JSON.parse(JSON.stringify(NEWS_FIXTURE)) as NewsResponse; }

function src(data: NewsResponse = clone()): NewsSource & { calls: URLSearchParams[] } {
  const calls: URLSearchParams[] = [];
  return {
    kind: 'live',
    calls,
    load: vi.fn(async (p: URLSearchParams) => { calls.push(new URLSearchParams(p)); return data; }),
    setReadMark: vi.fn(async (at: string) => ({ state: 'ok', at })),
  };
}
const last = (s: { calls: URLSearchParams[] }) => s.calls[s.calls.length - 1];

async function mount(source: NewsSource, lang: 'ru' | 'en' = 'ru') {
  const r = render(
    <KitLangProvider lang={lang}>
      <NewsFeed source={source} urlPrefix={null} timeZone="Europe/Moscow" />
    </KitLangProvider>,
  );
  await screen.findByTestId('news-feed-days');
  // S7A-12: метрики периода свёрнуты под «все метрики» — одно действие от ленты.
  fireEvent.click(screen.getByTestId('news-strip-toggle'));
  return r;
}

describe('S7A-03 · модель: клик по числу → els', () => {
  it('metricDrill: примеры сервера → ключи «тип:id», итог — число метрики', () => {
    const d = metricDrill('shipped', 1, ['SPRINT_UXR_S4/S4-12']);
    expect(d).toEqual({ els: ['task:SPRINT_UXR_S4/S4-12'], drill: { metric: 'shipped', total: 1 } });
  });

  it('metricDrill: нуль или нет примеров — кликать нечего (null), а не пустой фильтр «всё»', () => {
    expect(metricDrill('shipped', 0, [])).toBeNull();
    expect(metricDrill('closed', 5, [])).toBeNull();
  });

  it('metricDrill: тип элемента задаётся (по умолчанию task)', () => {
    expect(metricDrill('x', 2, ['ADR-1'], 'adr')?.els).toEqual(['adr:ADR-1']);
  });

  it('разворот в URL: метрика и её итог переживают перезагрузку; по умолчанию параметра нет', () => {
    expect(writeNewsQuery(DEFAULT_NEWS_QUERY, 'n').nd).toBeNull();
    const q = { ...DEFAULT_NEWS_QUERY, els: ['task:A/B-1'], drill: { metric: 'waiting', total: 3 } };
    const w = writeNewsQuery(q, 'n');
    expect(w.nd).toBe('waiting:3');
    const sp = new URLSearchParams();
    for (const [k, v] of Object.entries(w)) if (v !== null) sp.set(k, v);
    const back = readNewsQuery(sp, 'n');
    expect(back.drill).toEqual({ metric: 'waiting', total: 3 });
    expect(back.els).toEqual(['task:A/B-1']);
  });

  it('разворот без els в URL не восстанавливается (иначе подпись врёт о фильтре)', () => {
    const back = readNewsQuery(new URLSearchParams('nd=waiting:3'), 'n');
    expect(back.drill).toBeNull();
  });

  it('drill не уходит на сервер — только els', () => {
    const p = buildNewsParams({ ...DEFAULT_NEWS_QUERY, els: ['task:A/B-1'], drill: { metric: 'waiting', total: 3 } }, { timeZone: 'UTC' });
    expect(p.get('els')).toBe('task:A/B-1');
    expect([...p.keys()].some(k => k.includes('drill'))).toBe(false);
  });
});

describe('S7A-03 · метрики периода: дельта к P⁻', () => {
  it('дельта событий И элементов — из metrics.delta, с границами прошлого периода в подсказке', async () => {
    await mount(src());
    const kpi = screen.getByTestId('news-kpi-events');
    const ds = within(kpi).getAllByTestId('news-delta');
    expect(ds.map(d => d.textContent)).toEqual(['+3 · 33,3 %', '+1 · 10 %']);
    expect(ds[0].getAttribute('title')).toContain('9');
    expect(ds[0].getAttribute('title')).toContain('2026');
  });

  it('проценты — только если сервер их прислал (pct=null → только знак числом)', async () => {
    await mount(src());
    const d = within(screen.getByTestId('news-kpi-shipped')).getByTestId('news-delta');
    expect(d.textContent).toBe('−2');
    expect(d.dataset.tone).toBe('dng');
  });

  it('свёртка по типам: пара из counts.by_type и дельта из delta.by_type; у типа без дельты — без выдумки', async () => {
    const data = clone();
    await mount(src(data));
    const box = screen.getByTestId('news-breakdown-type');
    const task = within(box).getByTestId('news-bd-type-task');
    const tp = data.metrics.counts.by_type.task;
    expect(task.textContent).toContain(`${tp.events} · ${tp.elements}`);
    expect(within(task).getByTestId('news-delta').textContent).toBe('+1 · 20 %');
    for (const k of Object.keys(data.metrics.counts.by_type).filter(k => !(k in data.metrics.delta.by_type))) {
      expect(within(within(box).getByTestId(`news-bd-type-${k}`)).queryByTestId('news-delta')).toBeNull();
    }
  });

  it('свёртка по событиям: пары из counts.by_kind', async () => {
    const data = clone();
    await mount(src(data));
    const box = screen.getByTestId('news-breakdown-kind');
    const closed = within(box).getByTestId('news-bd-kind-closed');
    expect(closed.textContent).toContain('2 · 1');
  });
});

describe('S7A-03 · клик по числу — фильтр ленты', () => {
  it('клик по типу в свёртке → фильтр type на сервер; повторный клик по активному снимает', async () => {
    const s = src();
    await mount(s);
    const btn = within(screen.getByTestId('news-bd-type-task')).getByRole('button');
    fireEvent.click(btn);
    await waitFor(() => expect(last(s).get('type')).toBe('task'));
    expect(within(screen.getByTestId('news-bd-type-task')).getByRole('button').getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(within(screen.getByTestId('news-bd-type-task')).getByRole('button'));
    await waitFor(() => expect(last(s).has('type')).toBe(false));
  });

  it('клик по событию в свёртке → фильтр kind', async () => {
    const s = src();
    await mount(s);
    fireEvent.click(within(screen.getByTestId('news-bd-kind-closed')).getByRole('button'));
    await waitFor(() => expect(last(s).get('kind')).toBe('closed'));
  });

  it('клик по «Доехало S» → els из примеров сервера; подпись фильтра называет метрику', async () => {
    const s = src();
    await mount(s);
    fireEvent.click(within(screen.getByTestId('news-kpi-shipped')).getByRole('button', { name: /1/ }));
    await waitFor(() => expect(last(s).get('els')).toBe('task:SPRINT_UXR_S4/S4-12'));
    const desc = screen.getByTestId('news-desc');
    expect(desc.textContent).toContain('Доехало S');
    expect(screen.queryByTestId('news-drill-partial')).toBeNull();
  });

  it('честно: примеров меньше числа (сервер шлёт ≤ 10) → «показано 1 из 3» жёлтым', async () => {
    const s = src();
    await mount(s);
    fireEvent.click(within(screen.getByTestId('news-kpi-waiting')).getByRole('button'));
    await waitFor(() => expect(last(s).get('els')).toBe('task:SPRINT_UXR_S7A_NEWS/S7A-02'));
    const warn = await screen.findByTestId('news-drill-partial');
    expect(warn.textContent).toContain('1');
    expect(warn.textContent).toContain('3');
    expect(warn.dataset.tone).toBe('wrn');
  });

  it('закрыто C — отдельное число с кликом по примерам', async () => {
    const s = src();
    await mount(s);
    const kpi = screen.getByTestId('news-kpi-closed');
    expect(kpi.textContent).toContain('5');
    fireEvent.click(within(kpi).getByRole('button'));
    await waitFor(() => expect(last(s).get('els')).toBe('task:SPRINT_UXR_S7A_NEWS/S7A-04'));
  });

  it('число без примеров не кликается (нечем сузить — не притворяемся фильтром)', async () => {
    const data = clone();
    if (data.metrics.tasks.available) data.metrics.tasks.all.examples.shipped = [];
    await mount(src(data));
    expect(within(screen.getByTestId('news-kpi-shipped')).queryByRole('button')).toBeNull();
  });

  it('сброс снимает и els, и подпись метрики', async () => {
    const s = src();
    await mount(s);
    fireEvent.click(within(screen.getByTestId('news-kpi-waiting')).getByRole('button'));
    await screen.findByTestId('news-drill-partial');
    fireEvent.click(within(screen.getByTestId('news-desc')).getByRole('button', { name: 'Сбросить' }));
    await waitFor(() => expect(last(s).has('els')).toBe(false));
    expect(screen.queryByTestId('news-drill-partial')).toBeNull();
  });

  it('сгорание по группе: «ждёт» и «доехало» кликаются по примерам группы', async () => {
    const data = clone();
    if (data.metrics.tasks.available) {
      const g = data.metrics.tasks.by_axis.project!.groups[0];
      g.total.examples.waiting = ['SPRINT_X/X-1'];
    }
    const s = src(data);
    await mount(s);
    const row = screen.getAllByTestId(/^news-burn-row-/)[0];
    fireEvent.click(within(row).getByTestId('news-burn-drill-waiting'));
    await waitFor(() => expect(last(s).get('els')).toBe('task:SPRINT_X/X-1'));
  });

  it('кнопки-числа ≥ 44px по классу и подписаны для читалки (en)', async () => {
    await mount(src(), 'en');
    const b = within(screen.getByTestId('news-kpi-shipped')).getByRole('button');
    expect(b.className).toContain('sk-news__num');
    expect(b.getAttribute('aria-label')).toMatch(/Shipped S/);
  });
});
