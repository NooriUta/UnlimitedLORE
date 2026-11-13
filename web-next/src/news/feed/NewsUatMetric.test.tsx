// @vitest-environment jsdom
// Замечание владелицы 13.11.2026: «в новостях не учитывается в метриках uat что бы было легче
// производить сверку». UAT (🧪, приёмка человеком) раньше растворялся в «Ждёт выкатки Y».
// Теперь сервер присылает uat_t0/uat_t1, примеры examples.uat, uat_end по дням и entered_uat,
// а метрики рисуют отдельное число с кликом по примерам, колонку в группах и в днях.
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import gameIcons from '@iconify-json/game-icons/icons.json';
import { registerGameIcons, KitLangProvider } from '@seidr/kit';
import { NEWS_FIXTURE, NewsFeed, type NewsResponse, type NewsSource } from './index';

beforeAll(() => { registerGameIcons(gameIcons); });

function data(): NewsResponse {
  const d = JSON.parse(JSON.stringify(NEWS_FIXTURE)) as NewsResponse;
  if (!d.metrics.tasks.available) throw new Error('fixture: tasks unavailable');
  const t = d.metrics.tasks;
  t.all.uat_t0 = 1; t.all.uat_t1 = 2;
  t.all.examples.uat = ['SPRINT_LORE_WORK_ANY_KIND/UAT-STATUS', 'SPRINT_X/T-1'];
  t.entered_uat = 1;
  t.days.forEach((x, i) => { x.uat_end = i === t.days.length - 1 ? 2 : 1; });
  const g = t.by_axis.project?.groups[0];
  if (g) { g.total.uat_t1 = 2; g.total.examples.uat = ['SPRINT_X/T-1']; }
  return d;
}

function src(d: NewsResponse) {
  const calls: URLSearchParams[] = [];
  const s: NewsSource = {
    kind: 'live',
    load: vi.fn(async (p: URLSearchParams) => { calls.push(new URLSearchParams(p)); return d; }),
    setReadMark: vi.fn(async (at: string) => ({ state: 'ok' as const, at })),
  };
  return { s, calls };
}

async function mount(s: NewsSource, lang: 'ru' | 'en' = 'ru') {
  render(<KitLangProvider lang={lang}><NewsFeed source={s} urlPrefix={null} timeZone="Europe/Moscow" /></KitLangProvider>);
  await screen.findByTestId('news-feed-days');
  fireEvent.click(screen.getByTestId('news-strip-toggle'));
}

describe('новости: UAT отдельной метрикой', () => {
  it('KPI «На приёмке UAT: t0 → t1» и клик сужает ленту до примеров', async () => {
    const { s, calls } = src(data());
    await mount(s);
    const kpi = screen.getByTestId('news-kpi-uat');
    expect(kpi.textContent).toContain('1 → 2');
    expect(kpi.textContent).toContain('UAT');
    expect(kpi.textContent).toContain('вошло за период: 1');
    fireEvent.click(within(kpi).getByRole('button'));
    await waitFor(() => expect(calls[calls.length - 1].get('els'))
      .toBe('task:SPRINT_LORE_WORK_ANY_KIND/UAT-STATUS,task:SPRINT_X/T-1'));
  });

  it('колонка UAT в группах сгорания и в днях', async () => {
    const { s } = src(data());
    await mount(s);
    expect(screen.getAllByTestId('news-burn-drill-uat').length).toBeGreaterThan(0);
    const days = screen.getByTestId('news-burn-days');
    expect(within(days).getAllByRole('columnheader').map(h => h.textContent)).toContain('UAT');
  });

  it('английская подпись', async () => {
    const { s } = src(data());
    await mount(s, 'en');
    expect(screen.getByTestId('news-kpi-uat').textContent).toContain('In UAT');
  });
});
