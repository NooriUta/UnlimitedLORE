// @vitest-environment jsdom
// SPRINT_UXR_S7A_NEWS · метрики групп и подгрупп ленты. Владелица 11.11.2026: «если у нас
// группировка и подгруппировка идёт, все важные метрики должны быть посчитаны и отображены
// для этой группы: считает сервер, отображает kit».
//
// Форма чисел группы — заготовка контракта с «Сборкой LORE v2» (список а)–д) от 11.11):
// у группы и подгруппы тот же набор, что у дня. Ответ — снимок движка (общий с miniLORE),
// дополненный числами групп; клиент их только рисует.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import gameIcons from '@iconify-json/game-icons/icons.json';
import { KitLangProvider, registerGameIcons } from '@seidr/kit';
import { NewsFeed, parseNewsResponse, type NewsResponse, type NewsSource } from './index';

beforeAll(() => { registerGameIcons(gameIcons); });

const SNAPSHOT = resolve(process.cwd(), '../backend/src/test/resources/news-v2/contract-v2-fixture.json');
const tr = (rows: number) => ({ events: rows, elements: rows, rows });
/** Числа ведра по заготовке контракта: закрыто 3, задач заведено 1, к выкатке 2. */
const METRICS = {
  total: { events: 7, elements: 6 },
  by_kind: { closed: tr(3), created: tr(1), ready: tr(2), changed: tr(1) },
  by_type: { task: { ...tr(5), by_kind: { closed: tr(3), created: tr(1), ready: tr(1) } } },
  burn: { open_start: 10, open_end: 8, burn: 2 },
  agent_events: 4, agent_elements: 3,
  // С S7A-09 (#1261) сервер отдаёт и balance — клиент берёт его, а не пересчёт; числа согласованы с by_kind.
  balance: { closed: 3, created: 1 },
};

function withGroupMetrics(): NewsResponse {
  const s = parseNewsResponse(JSON.parse(readFileSync(SNAPSHOT, 'utf8')));
  const day = s.days![0];
  Object.assign(day.groups[0], METRICS);
  const g = s.groups.list[0];
  Object.assign(g, METRICS);
  g.sub = { axis: 'type', groups: [{ key: 'task', events: 5, elements: 5, multi: 0, ...METRICS, total: { events: 5, elements: 5 } }], total: { events: 5, elements: 5 }, multi_group_elements: 0 };
  return s;
}
const src = (data: NewsResponse): NewsSource => ({ kind: 'live', load: vi.fn(async () => data), setReadMark: vi.fn(async (at: string) => ({ state: 'ok', at })) });
/**
 * Первый день ленты. С S7A-09 (#1261) числа групп сервер отдаёт у КАЖДОГО дня, и ключ группы
 * (P2) повторяется в разных днях — проверки дня ищут только внутри своего дня.
 */
const firstDay = (s: NewsResponse) => within(screen.getByTestId(`news-day-${s.days![0].day}`));
/** Ответ «старого сервера»: у групп только прежние поля, без чисел S7A (форма до S7A-09). */
function oldServer(s: NewsResponse): NewsResponse {
  const pick = (o: object, keys: string[]) => Object.fromEntries(Object.entries(o).filter(([k]) => keys.includes(k)));
  for (const d of s.days ?? []) d.groups = d.groups.map(g => pick(g, ['key', 'events', 'elements', 'rows']) as typeof g);
  s.groups.list = s.groups.list.map(g => pick(g, ['key', 'events', 'elements', 'multi', 'agent_events', 'agent_elements', 'filter', 'sub']) as typeof g);
  return s;
}
async function mount(data: NewsResponse) {
  render(<KitLangProvider lang="ru"><NewsFeed source={src(data)} urlPrefix={null} timeZone="Europe/Moscow" /></KitLangProvider>);
  await screen.findByTestId('news-feed-days');
}

describe('S7A · метрики группы — те же, что у дня', () => {
  it('группа дня: баланс «закрыто против заведено», к выкатке, сгорание, итог', async () => {
    const s = withGroupMetrics();
    await mount(s);
    const key = s.days![0].groups[0].key;
    const f = firstDay(s).getByTestId(`news-gfigs-${key}`);
    expect(within(f).getByTestId(`news-gcube-${key}-kind-closed`).textContent).toBe('3 закрыто');
    expect(within(f).getByTestId(`news-gcube-${key}-kind-created`).textContent).toMatch(/^1 /);
    expect(within(f).getByTestId(`news-gcube-${key}-kind-ready`).textContent).toContain('2');
    expect(within(f).getByTestId(`news-gcube-${key}-burn`).textContent).toContain('+2');
    expect(within(f).getByTestId(`news-gcube-${key}-total`).textContent).toBe('7 · 6');
    expect(f.hasAttribute('data-compact')).toBe(true);
  });

  it('группа и подгруппа периода: колонка «Сводка» с числами сервера; у подгруппы — свой итог и агенты', async () => {
    const s = withGroupMetrics();
    await mount(s);
    const table = screen.getByTestId('news-groups');
    const heads = () => [...table.querySelectorAll('thead th')].map(x => x.textContent);
    expect(heads()).toContain('Сводка');
    const g = s.groups.list[0].key;
    expect(within(table).getByTestId(`news-gfig-${g}-total`).textContent).toBe('7 · 6');
    expect(within(table).getByTestId(`news-gfig-${g}-task-total`).textContent).toBe('5 · 5');
    expect(within(table).getByTestId(`news-gfig-${g}-task-kind-closed`).textContent).toBe('3 закрыто');
  });

  it('баланс — из поля сервера balance, а не пересчётом клиента (форма 11.11)', async () => {
    const s = withGroupMetrics();
    Object.assign(s.days![0].groups[0], { balance: { closed: 9, created: 4 } });
    await mount(s);
    const key = s.days![0].groups[0].key;
    expect(firstDay(s).getByTestId(`news-gcube-${key}-kind-closed`).textContent).toBe('9 закрыто');
    expect(firstDay(s).getByTestId(`news-gcube-${key}-kind-created`).textContent).toMatch(/^4 /);
  });

  it('старый сервер (чисел групп нет) — колонки «Сводка» нет и у групп дня пусто, а не нули', async () => {
    const s = oldServer(parseNewsResponse(JSON.parse(readFileSync(SNAPSHOT, 'utf8'))));
    await mount(s);
    expect([...screen.getByTestId('news-groups').querySelectorAll('thead th')].map(x => x.textContent)).not.toContain('Сводка');
    expect(screen.queryAllByTestId(/^news-gfigs-/)).toEqual([]);
  });
});
