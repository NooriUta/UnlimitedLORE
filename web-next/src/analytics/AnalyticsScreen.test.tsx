// @vitest-environment jsdom
// K4-CHARTS, первая поставка: раздел «Аналитика» — вкладки «Прогресс», «Поток», «Моя сводка»; блоки-графики kit.
import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { KitLangProvider } from '@seidr/kit';
import { AnalyticsScreen, ANALYTICS_SLICES } from './AnalyticsScreen';

const NOW = Date.parse('2026-11-16T12:00:00Z');
const DATA: Record<string, unknown> = {
  sprint_done_dates: { rows: [{ sprint_id: 'S1', done_date: '2026-11-10' }] },
  task_created_dates: { rows: [{ task_uid: 'S1/A', valid_from: '2026-11-02' }, { task_uid: 'S1/B', valid_from: '2026-11-03' }] },
  task_done_dates: { rows: [{ task_uid: 'S1/A', valid_from: '2026-11-09' }] },
};
const ui = (load: (s: string) => Promise<unknown>) => render(<KitLangProvider lang="ru"><AnalyticsScreen load={load} now={NOW} /></KitLangProvider>);
const blocks = () => [...document.querySelectorAll('[data-block]')].map(b => b.getAttribute('data-block'));

describe('Аналитика v2', () => {
  it('грузит срезы v1 и показывает «Прогресс»: Velocity и Burnup', async () => {
    const asked: string[] = [];
    ui(async s => { asked.push(s); return DATA[s]; });
    await waitFor(() => expect(screen.getByText(/Velocity/)).toBeTruthy());
    expect(asked.sort()).toEqual([...ANALYTICS_SLICES].sort());
    expect(blocks()).toEqual(['velocity', 'burnup']);
  });

  it('«Поток» — Throughput и Lead time; «Моя сводка» — блоки обеих вкладок с меткой вкладки', async () => {
    ui(async s => DATA[s]);
    await waitFor(() => expect(screen.getByText(/Velocity/)).toBeTruthy());
    fireEvent.click(screen.getByRole('tab', { name: 'Поток' }));
    expect(blocks()).toEqual(['throughput', 'lead']);
    fireEvent.click(screen.getByRole('tab', { name: 'Моя сводка' }));
    expect(blocks()).toEqual(['velocity', 'throughput', 'burnup', 'lead']);
    expect([...document.querySelectorAll('.an-block__src')].map(e => e.textContent)).toEqual(['Прогресс', 'Поток', 'Прогресс', 'Поток']);
  });

  it('не загрузилось — причина словами и «Повторить», а не пустые графики', async () => {
    ui(async () => { throw new Error('502 шлюз'); });
    await waitFor(() => expect(screen.getAllByText(/Не загрузилось: 502 шлюз/).length).toBeGreaterThan(0));
    expect(screen.getAllByRole('button', { name: /Повторить/ }).length).toBeGreaterThan(0);
  });

  it('срез обрезан — так и сказано над графиками', async () => {
    ui(async s => (s === 'task_done_dates' ? { ...(DATA[s] as object), truncated: true } : DATA[s]));
    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('task_done_dates'));
  });
});
