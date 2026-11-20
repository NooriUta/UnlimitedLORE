// @vitest-environment jsdom
// №2 CFD и №1 время цикла в паспорте спринта; №2 и №7 прогноз в паспорте вехи (предложение 19.11.2026).
// Честные состояния: сбой — причина и «Повторить»; данных мало — словами; часть — «показана часть».
import { beforeEach, describe, expect, it } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { KitLangProvider } from '@seidr/kit';
import { SprintCharts, MilestoneCharts } from './TaskFlowCharts';

const NOW = Date.parse('2026-11-19T12:00:00Z');
const V = { rows: [
  { task_uid: 'S1/A', status_raw: '⬜ TODO', valid_from: '2026-11-10T09:00:00Z', valid_to: '2026-11-11T09:00:00Z' },
  { task_uid: 'S1/A', status_raw: '🔄 IN PROGRESS', valid_from: '2026-11-11T09:00:00Z', valid_to: '2026-11-13T09:00:00Z' },
  { task_uid: 'S1/A', status_raw: '✅ DONE', valid_from: '2026-11-13T09:00:00Z', valid_to: null },
  { task_uid: 'S1/B', status_raw: '✅ DONE', valid_from: '2026-11-12T09:00:00Z', valid_to: null },
] };
type Load = (s: string, p: Record<string, string>) => Promise<unknown>;
const kinds = () => [...document.querySelectorAll('[data-testid="kit-chart"]')].map(e => e.getAttribute('data-kind'));
const open = () => fireEvent.click(screen.getByRole('button', { name: /Графики/ }));

beforeEach(() => { window.history.replaceState(null, '', '/'); });

describe('паспорт спринта: графики потока', () => {
  it('компьютер — графики сразу, без кнопки (одно правило с графиками вехи #1632)', async () => {
    render(<KitLangProvider lang="ru"><SprintCharts sprintId="S1" now={NOW} narrow={false} load={async () => V} /></KitLangProvider>);
    expect(screen.queryByRole('button', { name: /Графики/ })).toBeNull();
    await waitFor(() => expect(kinds()).toEqual(['line', 'scatter']));
  });

  it('телефон — свёрнуты кнопкой; раскрытие — в адресе (pch=1)', async () => {
    render(<KitLangProvider lang="ru"><SprintCharts sprintId="S1" now={NOW} narrow load={async () => V} /></KitLangProvider>);
    expect(kinds()).toEqual([]);
    open();
    expect(new URL(window.location.href).searchParams.get('pch')).toBe('1');
    await waitFor(() => expect(kinds()).toEqual(['line', 'scatter']));
  });

  it('грузит версии статуса своего спринта; закрытые мимо «в работе» и мало точек — словами', async () => {
    const asked: string[] = [];
    window.history.replaceState(null, '', '/?pch=1');
    render(<KitLangProvider lang="ru"><SprintCharts sprintId="S1" now={NOW} load={async (s, p) => { asked.push(`${s}:${p.sprint ?? ''}`); return V; }} /></KitLangProvider>);
    await waitFor(() => expect(kinds()).toEqual(['line', 'scatter']));
    expect(asked).toEqual(['task_status_versions:S1']);
    expect(screen.getByText(/минуя «в работе»: 1/)).toBeTruthy();
    expect(screen.getByText(/Мало точек/)).toBeTruthy();
  });

  it('сбой — причина и «Повторить»', async () => {
    window.history.replaceState(null, '', '/?pch=1');
    render(<KitLangProvider lang="ru"><SprintCharts sprintId="S1" now={NOW} load={async () => { throw new Error('502 шлюз'); }} /></KitLangProvider>);
    await waitFor(() => expect(screen.getAllByRole('button', { name: /Повторить/ }).length).toBeGreaterThan(0));
    expect(screen.getAllByText(/502 шлюз/).length).toBeGreaterThan(0);
  });
});

describe('паспорт вехи: прогноз и поток', () => {
  const load: Load = async (s, p) => {
    if (s === 'milestone_by_id') return { rows: [{ milestone_id: 'M', date_display: '2026-12-31', direct_sprint_ids: ['S1'] }] };
    if (s === 'task_status_versions') return p.sprint === 'S1' ? V : { rows: [] };
    if (s === 'task_created_dates') return { rows: [{ task_uid: 'S1/A', valid_from: '2026-11-10' }, { task_uid: 'S1/B', valid_from: '2026-11-10' }, { task_uid: 'S1/C', valid_from: '2026-11-10' }] };
    if (s === 'task_done_dates') return { rows: [{ task_uid: 'S1/B', valid_from: '2026-11-12' }] };
    return { rows: [] };
  };

  it('прогноз (линии с трендом) и CFD; закрытий одна неделя — «мало данных для тренда»', async () => {
    window.history.replaceState(null, '', '/?pch=1');
    render(<KitLangProvider lang="ru"><MilestoneCharts milestoneId="M" now={NOW} load={load} /></KitLangProvider>);
    await waitFor(() => expect(kinds()).toEqual(['bar', 'line', 'line', 'line'])); // Velocity и Burnup спринтов (#1632), прогноз, CFD
    expect(screen.getByTestId('forecast-verdict').textContent).toMatch(/мало/i);
  });

  it('у вехи нет спринтов — словами, без графиков', async () => {
    window.history.replaceState(null, '', '/?pch=1');
    render(<KitLangProvider lang="ru"><MilestoneCharts milestoneId="M" now={NOW} load={async s => (s === 'milestone_by_id' ? { rows: [{ direct_sprint_ids: [] }] } : { rows: [] })} /></KitLangProvider>);
    await waitFor(() => expect(screen.getByTestId('pch-nosprints')).toBeTruthy());
    expect(kinds()).toEqual([]);
  });
});
