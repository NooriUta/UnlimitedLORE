// @vitest-environment jsdom
// SPRINT_UXR_S13_KIT4/K4-NEWS-ROW-COLUMNS — строка ленты по столбцам (прототип docs/prototypes/k4-news-row-columns.html,
// согласован владелицей 21.11.2026 на телефоне и десктопе). Её слова: «левая часть путает; выровнять по столбикам;
// кнопку копировать убрать — можно с иконки первой копировать; со второго левого шильдика подписи — в подсказку;
// слово «новое» не писать на каждой строке — линией; непрочитанное вверх, прочитанное в конце; справа выровнять
// переходы статусов с множителем и без»; телефон — «места переноса времени выровнены».
import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { act, render, screen, within } from '@testing-library/react';
import gameIcons from '@iconify-json/game-icons/icons.json';
import { KitLangProvider, registerGameIcons } from '@seidr/kit';
import { NEWS_FIXTURE, NewsFeed, type NewsResponse, type NewsSource } from './index';
import { KIT_CSS } from '../../test/kitPaths';

beforeAll(() => { registerGameIcons(gameIcons); });

const css = readFileSync(KIT_CSS, 'utf8');
/** Тело правила CSS по точному селектору (первое вхождение). */
const rule = (sel: string, from = css) => {
  const i = from.indexOf(`${sel} {`);
  return i < 0 ? '' : from.slice(i, from.indexOf('}', i));
};

const COLS = ['type', 'kind', 'title', 'code', 'time', 'where', 'who', 'status', 'times'];

function clone(): NewsResponse { return JSON.parse(JSON.stringify(NEWS_FIXTURE)) as NewsResponse; }
function src(data: NewsResponse): NewsSource {
  return { kind: 'live', load: async () => data, setReadMark: async (at: string) => ({ state: 'ok', at }) } as NewsSource;
}
async function mount(data = clone()) {
  await act(async () => {
    render(<KitLangProvider lang="ru"><NewsFeed source={src(data)} urlPrefix={null} timeZone="Europe/Moscow" /></KitLangProvider>);
  });
  await screen.findByTestId('news-feed-days');
}
const rows = () => screen.getAllByTestId(/^news-row-/).filter(r => r.tagName === 'LI');

describe('K4-NEWS-ROW-COLUMNS · строка ленты по столбцам', () => {
  it('сетка: у строки ленты один шаблон столбцов (переменная), на телефоне правый столбец 84px', () => {
    expect(rule('.sk-news__row')).toMatch(/display:\s*grid/);
    expect(rule('.sk-news__row')).toMatch(/grid-template-columns:\s*var\(--news-cols\)/);
    expect(rule('.sk-news__rows')).toMatch(/--news-cols:/);
    const phone = css.slice(css.indexOf('K4-NEWS-ROW-COLUMNS · телефон'));
    expect(phone).toMatch(/grid-template-columns:[^;]*84px/);
    expect(phone).toMatch(/grid-template-areas:/);
  });

  it('каждая строка — девять ячеек в одном порядке: тип · что · запись · код · время · место · кто · статус · раз', async () => {
    await mount();
    const rs = rows();
    expect(rs.length).toBeGreaterThan(0);
    for (const r of rs) {
      const cols = [...r.children].map(c => (c as HTMLElement).dataset.col);
      expect(cols, r.dataset.testid).toEqual(COLS);
    }
  });

  it('отдельной кнопки копии нет: копирует первая иконка (тип), подсказка «скопировать код»', async () => {
    await mount();
    for (const r of rows()) {
      const copies = r.querySelectorAll('[data-testid="news-copy"]');
      expect(copies.length).toBe(1);
      expect(copies[0].closest('[data-col]')?.getAttribute('data-col')).toBe('type');
      expect(copies[0].getAttribute('title')).toMatch(/Скопировать код/);
    }
    expect(document.querySelector('.sk-news__copy')).toBeNull();
  });

  it('вид события — значок без слова; слово — в подсказке', async () => {
    await mount();
    for (const r of rows()) {
      const k = r.querySelector('[data-kind-tag]') as HTMLElement;
      expect(k.textContent?.trim(), r.dataset.testid).toBe('');
      expect(k.getAttribute('title')).toBeTruthy();
    }
  });

  it('«новое» на строке не пишется; непрочитанное сверху, затем одна линия «дальше — прочитанное»', async () => {
    const d = clone();
    const day = '2026-11-07';
    const sameDay = d.events.filter(e => e.day_local === day);
    expect(sameDay.length).toBeGreaterThan(2);
    // Один проект у всех событий дня — одна группа; непрочитанное — последним в выдаче: лента ставит его наверх.
    sameDay.forEach((e, i) => { e.projects = ['NooriUta/UnlimitedLORE']; e.unread = i === sameDay.length - 1; });
    await mount(d);
    expect(document.body.textContent).not.toMatch(/\bновое\b/i);
    const dayEl = screen.getByTestId(`news-day-${day}`);
    const items = [...dayEl.querySelectorAll('.sk-news__rows > li')] as HTMLElement[];
    expect(items[0].dataset.unread, 'непрочитанное — первой строкой группы').toBe('true');
    const seps = within(dayEl).getAllByTestId('news-read-sep');
    expect(seps).toHaveLength(1);
    expect(seps[0].getAttribute('role')).toBe('separator');
    expect(seps[0].textContent).toMatch(/дальше — прочитанное/);
    expect(items.indexOf(seps[0].closest('li') as HTMLElement), 'линия — сразу после непрочитанного').toBe(1);
  });

  it('статус и «раз» — свои ячейки: у строки без перехода и без ×N ячейки есть, но пустые', async () => {
    await mount();
    const r = rows().find(x => !x.querySelector('[data-testid="news-status"]') && !x.querySelector('[data-testid="news-mult"]'))!;
    expect(r).toBeTruthy();
    expect((r.querySelector('[data-col="status"]') as HTMLElement).textContent).toBe('');
    expect((r.querySelector('[data-col="times"]') as HTMLElement).textContent).toBe('');
  });
});
