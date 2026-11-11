// @vitest-environment jsdom
// SPRINT_UXR_S7A_NEWS/S7A-09 — цифры дня считает сервер, клиент только рисует.
//
// Снимок — ПОЛНЫЙ ответ движка на фикстуре §10.4, его пишет и сверяет
// backend NewsV2DaysContractTest (backend/src/test/resources/news-v2/
// contract-v2-fixture.json). Тот же файл читает miniLORE: одна фикстура —
// одни числа у обоих клиентов.
//
// Раньше заголовок дня (итог, разбивка по видам и типам, «закрыто против
// заведено») и счёт группы внутри дня веб насчитывал сам по пришедшим строкам.
// Проверка «нарисовано то, что прислано» поэтому идёт на ответе, у которого
// строк ленты НЕТ ни одной лишней, а часть убрана: свой счёт клиента сразу
// разойдётся с серверным.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import gameIcons from '@iconify-json/game-icons/icons.json';
import { KitLangProvider, registerGameIcons } from '@seidr/kit';
import { NewsFeed, parseNewsResponse, type NewsResponse, type NewsSource } from './index';

beforeAll(() => { registerGameIcons(gameIcons); });

// vitest запускается из web-next (под jsdom import.meta.url — не file:).
const SNAPSHOT = resolve(process.cwd(), '../backend/src/test/resources/news-v2/contract-v2-fixture.json');
const snapshot = (): NewsResponse => parseNewsResponse(JSON.parse(readFileSync(SNAPSHOT, 'utf8')));

function src(data: NewsResponse): NewsSource {
  return { kind: 'live', load: vi.fn(async () => data), setReadMark: vi.fn(async (at: string) => ({ state: 'ok', at })) };
}

async function mount(data: NewsResponse) {
  render(
    <KitLangProvider lang="ru">
      <NewsFeed source={src(data)} urlPrefix={null} timeZone="Europe/Moscow" />
    </KitLangProvider>,
  );
  await screen.findByTestId('news-feed-days');
}

describe('S7A-09: снимок ответа сервера — общий для веба и miniLORE', () => {
  it('снимок разбирается и несёт свёртки дня', () => {
    const s = snapshot();
    expect(s.days?.length).toBeGreaterThan(0);
    for (const d of s.days!) {
      expect(Object.values(d.by_kind).reduce((a, x) => a + x.rows, 0)).toBe(d.rows);
    }
  });

  it('заголовок дня рисует числа days[], даже когда строк ленты пришло меньше', async () => {
    const s = snapshot();
    // Самый свежий день — он раскрыт по умолчанию, и строк у него больше одной.
    const day = s.days![0];
    expect(day.rows).toBeGreaterThan(1);
    // Оставляем у дня одну строку: свой счёт клиента дал бы 1, сервер говорит иначе.
    let kept = false;
    s.events = s.events.filter(e => {
      if (e.day_local !== day.day) return true;
      if (kept) return false;
      kept = true;
      return true;
    });
    await mount(s);
    const el = screen.getByTestId(`news-day-${day.day}`);
    expect(within(el).getByTestId('news-day-total').textContent).toBe(`${day.total.events} · ${day.total.elements}`);
    expect(within(el).getByTestId('news-cube-delta').textContent).toBe(`Δ ${day.total.elements}`);
    const types = within(el).getByTestId('news-day-types').textContent;
    const shown = Object.values(day.by_type).map(t => t.rows).join('');
    expect(types).toBe(shown);
    // группа дня — счёт сервера, а не длина пришедшего списка
    const g = day.groups.find(x => kept && s.events.some(e => e.day_local === day.day && (e.projects ?? ['(no-project)']).includes(x.key)))!;
    const bucket = within(el).getByTestId(`news-bucket-${g.key}`);
    expect(bucket.querySelector('.sk-news__bn')!.textContent).toBe(String(g.rows));
  });

  it('«закрыто против заведено» — из свёрток по видам и типам', async () => {
    const s = snapshot();
    // Из раскрытых по умолчанию (два свежих) — день, где есть что считать.
    const day = s.days!.slice(0, 2).find(d => (d.by_kind.closed?.rows ?? 0) > 0 || (d.by_type.task?.by_kind.created?.rows ?? 0) > 0)
      ?? s.days![0];
    s.events = s.events.filter(e => e.day_local !== day.day || e.kind !== 'closed');
    await mount(s);
    const el = screen.getByTestId(`news-day-${day.day}`);
    const closed = day.by_kind.closed?.rows ?? 0;
    const created = day.by_type.task?.by_kind.created?.rows ?? 0;
    expect(within(el).getByTestId('news-cube-kind-closed').textContent).toMatch(new RegExp(`^${closed} `));
    expect(within(el).getByTestId('news-cube-kind-created').textContent).toMatch(new RegExp(`^${created} `));
  });
});
