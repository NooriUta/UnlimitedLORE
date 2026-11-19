// @vitest-environment jsdom
// K4-CHARTS, первая поставка: раздел «Аналитика» — вкладки «Прогресс», «Поток», «Моя сводка»; блоки-графики kit.
import { beforeEach, describe, expect, it } from 'vitest';
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

// Адрес jsdom общий на файл: вкладка (?atab) прошлого теста не должна течь в следующий.
beforeEach(() => { window.history.replaceState(null, '', '/'); });

describe('Аналитика v2', () => {
  it('грузит срезы v1 и показывает «Прогресс»: Velocity и Burnup', async () => {
    const asked: string[] = [];
    ui(async s => { asked.push(s); return DATA[s]; });
    await waitFor(() => expect(screen.getByText(/Velocity/)).toBeTruthy());
    expect(asked.sort()).toEqual([...ANALYTICS_SLICES].sort()); // «Прогресс» не грузит версии статуса — они нужны только «Потоку»
    expect(blocks()).toEqual(['velocity', 'burnup']);
  });

  it('«Поток» — Throughput и Lead time; «Моя сводка» — блоки обеих вкладок с меткой вкладки', async () => {
    ui(async s => DATA[s]);
    await waitFor(() => expect(screen.getByText(/Velocity/)).toBeTruthy());
    fireEvent.click(screen.getByRole('tab', { name: 'Поток' }));
    expect(blocks()).toEqual(['throughput', 'lead', 'cycle', 'blocked']);
    fireEvent.click(screen.getByRole('tab', { name: 'Моя сводка' }));
    expect(blocks()).toEqual(['velocity', 'throughput', 'burnup', 'lead', 'cycle']);
    expect([...document.querySelectorAll('.an-block__src')].map(e => e.textContent)).toEqual(['Прогресс', 'Поток', 'Прогресс', 'Поток', 'Поток']);
  });

  it('не загрузилось — причина словами и «Повторить», а не пустые графики', async () => {
    ui(async () => { throw new Error('502 шлюз'); });
    await waitFor(() => expect(screen.getAllByText(/Не загрузилось: 502 шлюз/).length).toBeGreaterThan(0));
    expect(screen.getAllByRole('button', { name: /Повторить/ }).length).toBeGreaterThan(0);
  });
  it('«Поток»: время цикла (№1, графики 19.11) — по версиям статуса, отдельной загрузкой, за те же недели', async () => {
    const asked: string[] = [];
    const V = { rows: [
      { task_uid: 'S1/A', status_raw: '🔄 IN PROGRESS', valid_from: '2026-11-02T09:00:00Z', valid_to: '2026-11-05T09:00:00Z' },
      { task_uid: 'S1/A', status_raw: '✅ DONE', valid_from: '2026-11-05T09:00:00Z', valid_to: null },
    ] };
    ui(async s => { asked.push(s); return s === 'task_status_versions' ? V : DATA[s]; });
    await waitFor(() => expect(screen.getByText(/Velocity/)).toBeTruthy());
    expect(asked).not.toContain('task_status_versions');
    fireEvent.click(screen.getByRole('tab', { name: 'Поток' }));
    await waitFor(() => expect(document.querySelectorAll('[data-block="cycle"] [data-point]').length).toBe(1));
    expect(asked).toContain('task_status_versions');
  });

  it('пачка 2 (графики 19.11): вкладки «Люди и агенты», «Релизы», «Архитектура», «Качество» — свои блоки и свои срезы', async () => {
    const asked: string[] = [];
    ui(async s => { asked.push(s); return DATA[s] ?? { rows: [] }; });
    await waitFor(() => expect(screen.getByText(/Velocity/)).toBeTruthy());
    fireEvent.click(screen.getByRole('tab', { name: 'Люди и агенты' }));
    expect(blocks()).toEqual(['wip']);
    fireEvent.click(screen.getByRole('tab', { name: 'Релизы' }));
    expect(blocks()).toEqual(['rhythm', 'ship']);
    fireEvent.click(screen.getByRole('tab', { name: 'Архитектура' }));
    expect(blocks()).toEqual(['decisions']);
    fireEvent.click(screen.getByRole('tab', { name: 'Качество' }));
    expect(blocks()).toEqual(['gates']);
    expect(new URL(window.location.href).searchParams.get('atab')).toBe('quality');
    await waitFor(() => expect(asked).toEqual(expect.arrayContaining(['all_tasks', 'releases', 'pr_ship_lag', 'decision_status_versions', 'qg_run_outcomes'])));
  });

  it('срез обрезан — так и сказано над графиками', async () => {
    ui(async s => (s === 'task_done_dates' ? { ...(DATA[s] as object), truncated: true } : DATA[s]));
    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('task_done_dates'));
  });
});
