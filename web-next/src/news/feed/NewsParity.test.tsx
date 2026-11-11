// @vitest-environment jsdom
// SPRINT_UXR_S7A_NEWS/S7A-08 — паритет ленты v2 с v1 по 30 пунктам
// (spec:SPEC-LORE-UXR-NEWS-PARITY). Номер пункта — в названии теста («Пn»).
//
// Решения владелицы 10.11.2026:
//   • п.10 «ещё N задач» — снят (его заменила свёртка S7A-01);
//   • п.24 — ссылкой делать всё, у чего есть паспорт, ВКЛЮЧАЯ людей;
//   • п.27 — время: переключатель «Местное / UTC».
//
// Пункты, которые проверяются не рендером (сервер, раскладка), названы здесь
// же — со ссылкой на тест, который их держит; сторож внизу требует, чтобы ни
// один из 30 не остался без теста.
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import gameIcons from '@iconify-json/game-icons/icons.json';
import { registerGameIcons } from '@seidr/kit';
import { KitLangProvider } from '@seidr/kit';
import { NEWS_FIXTURE, NewsFeed, newsDict, type NewsEvent, type NewsResponse, type NewsSource } from './index';

beforeAll(() => { registerGameIcons(gameIcons); });

const clone = (): NewsResponse => JSON.parse(JSON.stringify(NEWS_FIXTURE)) as NewsResponse;

function src(data: NewsResponse = clone()): NewsSource & { calls: URLSearchParams[] } {
  const calls: URLSearchParams[] = [];
  return {
    kind: 'live',
    calls,
    load: vi.fn(async (p: URLSearchParams) => { calls.push(new URLSearchParams(p)); return data; }),
    setReadMark: vi.fn(async (at: string) => ({ state: 'ok', at })),
  };
}

async function mount(source: NewsSource, props: Partial<Parameters<typeof NewsFeed>[0]> = {}) {
  const r = render(
    <KitLangProvider lang="ru">
      <NewsFeed source={source} urlPrefix={null} timeZone="Europe/Moscow" {...props} />
    </KitLangProvider>,
  );
  await screen.findByTestId('news-feed-days');
  return r;
}

const day = (d: string) => screen.getByTestId(`news-day-${d}`);
const row = (key: string) => screen.getAllByTestId(`news-row-${key}`)[0];

/** Событие поверх фикстуры: тот же вид, что присылает сервер. */
function withEvent(p: Partial<NewsEvent> & Pick<NewsEvent, 'type' | 'el' | 'kind' | 'day_local'>): NewsResponse {
  const d = clone();
  const base = d.events[1];
  d.events.splice(1, 0, {
    ...base, title: null, time_local: null, at_utc: null, time_known: false, mult: 1, sprint: null,
    milestones: [], groups_n: 1, author: 'unknown', who: null, from: null, to: null, parent: null,
    series: null, future: false, unread: false,
    ...p,
    key: `${p.type}:${p.el}|${p.kind}|${p.day_local}`,
    el_key: `${p.type}:${p.el}`,
  });
  return d;
}

describe('S7A-08 · паритет v1 → v2: рендер', () => {
  it('П6: в заголовке дня — разбивка по типам и по событиям; в режиме «по типам» разбивка по типам не дублируется', async () => {
    await mount(src());
    const types = within(day('2026-11-07')).getByTestId('news-day-types');
    expect(types.querySelectorAll('svg, [data-icon]').length).toBeGreaterThan(0);
    expect(types.textContent).toMatch(/\d/);
    expect(within(day('2026-11-07')).getByTestId('news-cube-kind-closed')).toBeTruthy();
  });

  it('П6: разрез «по типам» — заголовок дня без повторной разбивки по типам', async () => {
    const d = clone();
    d.groups.axis = 'type';
    await mount(src(d));
    expect(within(day('2026-11-07')).queryByTestId('news-day-types')).toBeNull();
  });

  it.each([[3, 'suc'], [-2, 'dng'], [0, 't3']] as const)('П7: сгорание %s — цвет по знаку (%s)', async (burn, tone) => {
    const d = clone();
    if (!d.metrics.tasks.available) throw new Error('фикстура: сгорание посчитано');
    d.metrics.tasks.all.burn = burn;
    await mount(src(d));
    expect(screen.getByTestId('news-strip-burn').getAttribute('data-tone')).toBe(tone);
  });

  it('П8: Δ дня — число уникальных элементов из ответа сервера', async () => {
    await mount(src());
    expect(within(day('2026-11-07')).getByTestId('news-cube-delta').textContent).toBe('Δ 5');
  });

  it('П22: событие без проекта — в группе «без проекта»; проект — последним сегментом слага', async () => {
    await mount(src(withEvent({ type: 'adr', el: 'ADR-NOPROJ', kind: 'changed', day_local: '2026-11-07', projects: [] })));
    const none = within(day('2026-11-07')).getByTestId('news-bucket-(no-project)');
    expect(none.textContent).toMatch(/без проекта/);
    expect(within(none).getByTestId('news-row-adr:ADR-NOPROJ|changed|2026-11-07')).toBeTruthy();
    const proj = row('task:SPRINT_UXR_S7A_NEWS/S7A-02|ready|2026-11-07').querySelector('.sk-news__proj');
    expect(proj?.textContent).toBe('UnlimitedLORE');
  });

  it('П23: заголовка нет — строка называется кодом записи', async () => {
    await mount(src(withEvent({ type: 'adr', el: 'ADR-NO-TITLE', kind: 'changed', day_local: '2026-11-07', title: null })));
    expect(row('adr:ADR-NO-TITLE|changed|2026-11-07').querySelector('.sk-news__rtitle')?.textContent).toBe('ADR-NO-TITLE');
  });

  it('П27: время — переключатель «Местное / UTC»; выбор уходит поясом запроса', async () => {
    const s = src();
    await mount(s);
    expect(s.calls[s.calls.length - 1].get('tz')).toBe('Europe/Moscow');
    const local = within(row('task:SPRINT_UXR_S7A_NEWS/S7A-02|ready|2026-11-07')).getByTestId('news-time-local');
    expect(local.getAttribute('title')).toMatch(/Europe\/Moscow/);
    fireEvent.click(screen.getByTestId('news-filters-btn'));
    fireEvent.click(screen.getByRole('radio', { name: /UTC/ }));
    await waitFor(() => expect(s.calls[s.calls.length - 1].get('tz')).toBe('UTC'));
  });

  it('П30: словарь ленты — ключи ru и en совпадают, пустых подписей нет', () => {
    const ru = newsDict('ru'), en = newsDict('en');
    expect(Object.keys(en).sort()).toEqual(Object.keys(ru).sort());
    for (const [k, v] of [...Object.entries(ru), ...Object.entries(en)]) expect(v.trim(), k).not.toBe('');
  });
});

describe('S7A-08 · П24: ссылкой — всё, у чего есть паспорт, включая людей', () => {
  const refHrefOf = (type: string, id: string) => `/r/${type}/${encodeURIComponent(id)}`;

  it('автор-человек — ссылка на его карточку', async () => {
    await mount(src(withEvent({ type: 'adr', el: 'ADR-W', kind: 'changed', day_local: '2026-11-07', author: 'human', who: 'sub-anna' })),
      { refHrefOf });
    const who = within(row('adr:ADR-W|changed|2026-11-07')).getByTestId('news-who');
    expect(who.tagName).toBe('A');
    expect(who.getAttribute('href')).toBe('/r/person/sub-anna');
    expect(who.textContent).toBe('sub-anna');
  });

  it('автор-агент — ссылка своего вида', async () => {
    await mount(src(withEvent({ type: 'adr', el: 'ADR-A', kind: 'changed', day_local: '2026-11-07', author: 'agent', who: 'mcp-lore' })),
      { refHrefOf });
    expect(within(row('adr:ADR-A|changed|2026-11-07')).getByTestId('news-who').getAttribute('href')).toBe('/r/agent/mcp-lore');
  });

  it('спринт задачи и ADR решения — ссылки на их записи', async () => {
    await mount(src(), { refHrefOf });
    const task = row('task:SPRINT_UXR_S7A_NEWS/S7A-02|ready|2026-11-07');
    expect(within(task).getByTestId('news-ref-sprint').getAttribute('href')).toBe('/r/sprint/SPRINT_UXR_S7A_NEWS');
    const dec = row('decision:D-2026-UXR-NEWS-V2-RULES|created|2026-11-07');
    expect(within(dec).getByTestId('news-ref-adr').getAttribute('href')).toBe('/r/adr/ADR-LORE-045');
  });

  it('веха и компонент — типы ленты со своей иконкой и подписью; строка ведёт на запись', async () => {
    const d = withEvent({ type: 'milestone', el: 'M-UXR-MVP', kind: 'changed', day_local: '2026-11-07', title: 'MVP', milestones: ['M-UXR-MVP'] });
    d.events.splice(1, 0, { ...d.events[1], type: 'component', el: 'FORSETI', title: 'Forseti', key: 'component:FORSETI|changed|2026-11-07', el_key: 'component:FORSETI' });
    await mount(src(d), { hrefOf: e => `/rec/${e.type}/${e.el}` });
    const ms = row('milestone:M-UXR-MVP|changed|2026-11-07');
    expect(ms.querySelector('[aria-label="веха"]')).not.toBeNull();
    expect(within(ms).getAllByRole('link')[0].getAttribute('href')).toBe('/rec/milestone/M-UXR-MVP');
    const comp = row('component:FORSETI|changed|2026-11-07');
    expect(comp.querySelector('[aria-label="компонент"]')).not.toBeNull();
  });

  it('открыть негде (приложение не дало адрес) — текст, а не ссылка-пустышка', async () => {
    await mount(src(withEvent({ type: 'adr', el: 'ADR-W', kind: 'changed', day_local: '2026-11-07', author: 'human', who: 'sub-anna' })));
    const who = within(row('adr:ADR-W|changed|2026-11-07')).getByTestId('news-who');
    expect(who.tagName).not.toBe('A');
    expect(within(row('task:SPRINT_UXR_S7A_NEWS/S7A-02|ready|2026-11-07')).getByTestId('news-ref-sprint').tagName).not.toBe('A');
  });

  it('автор неизвестен — ничего не выдумываем: ни имени, ни ссылки', async () => {
    await mount(src(), { refHrefOf });
    expect(within(row('task:SPRINT_UXR_S7A_NEWS/S7A-02|ready|2026-11-07')).queryByTestId('news-who')).toBeNull();
  });
});

/**
 * Сторож: у каждого из 30 пунктов есть тест. Рендерные пункты — по метке «Пn» в
 * тестах ленты; серверные и раскладка — по имени теста в своём файле.
 */
describe('S7A-08 · сторож: ни один из 30 пунктов без теста', () => {
  const ROOT = join(__dirname, '..', '..', '..', '..');
  const ELSEWHERE: Record<number, [file: string, test: string]> = {
    14: ['backend/src/test/java/studio/seer/heimdall/lore/news/NewsV2EngineFixtureTest.java', 'limitCutsTheFeedAndTruncatedTellsTheTruth'],
    15: ['backend/src/test/java/studio/seer/heimdall/lore/LoreNewsV2CollectorTest.java', 'periodDefaultsToSevenLocalDaysEndingNow'],
    19: ['backend/src/test/java/studio/seer/heimdall/lore/news/NewsV2EngineFixtureTest.java', 'prepareDropsChangedOnCreatedDayAndDedupsByDay'],
    20: ['backend/src/test/java/studio/seer/heimdall/lore/LoreNewsV2CollectorTest.java', 'historyRowsBecomeTaskChainsAndSprintReleaseLinks'],
    28: ['web-next/e2e/news-layout.spec.ts', 'нет горизонтальной прокрутки страницы'],
  };
  /** Снято владелицей 10.11.2026 — тест не нужен, решение записано в спеке. */
  const DROPPED = new Set([10]);

  it('каждый пункт 1–30: тест есть или пункт снят', () => {
    const files = [
      ...readdirSync(__dirname).filter(f => /\.test\.tsx?$/.test(f)).map(f => join(__dirname, f)),
      join(ROOT, 'web-next', 'src', 'news', 'news.test.tsx'),
    ];
    const text = files.map(f => readFileSync(f, 'utf8')).join('\n');
    const missing: number[] = [];
    for (let n = 1; n <= 30; n++) {
      if (DROPPED.has(n)) continue;
      const other = ELSEWHERE[n];
      if (other) {
        if (!readFileSync(join(ROOT, other[0]), 'utf8').includes(other[1])) missing.push(n);
        continue;
      }
      if (!new RegExp(`П${n}(?!\\d)`).test(text)) missing.push(n);
    }
    expect(missing).toEqual([]);
  });
});
