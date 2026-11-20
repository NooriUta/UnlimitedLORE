// @vitest-environment jsdom
// K4-CHARTS (вопрос 11 владелицы 19.11.2026): в паспорте вехи — графики её спринтов на kit (Velocity, Burnup),
// как в v1 по фильтру «Веха». Честные состояния: сбой с «Повторить», «нет спринтов», «показана часть».
import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { KitLangProvider } from '@seidr/kit';
import { MilestoneSprintCharts } from './MilestoneSprintCharts';

const TODAY = Date.parse('2026-11-19T12:00:00Z');
const MS = { rows: [{ milestone_id: 'M7', direct_sprint_ids: ['S1', 'S2', 'GONE'] }] };
const SPRINTS = { rows: [
  { sprint_id: 'S1', created_date: '2026-10-26', done_date: '2026-11-03' },
  { sprint_id: 'S2', created_date: '2026-10-28', done_date: null },
] };
type Load = (slice: string, params: Record<string, string>) => Promise<unknown>;
const ui = (load: Load) => render(
  <KitLangProvider lang="ru"><MilestoneSprintCharts milestoneId="M7" now={TODAY} load={(s, p) => load(s, p)} /></KitLangProvider>,
);

describe('паспорт вехи: графики спринтов вехи на kit', () => {
  it('столбики Velocity и линии Burnup; спринт вне среза — «показана часть»', async () => {
    const asked: string[] = [];
    ui(async (s, p) => { asked.push(`${s}:${p.id ?? ''}`); return s === 'milestone_by_id' ? MS : SPRINTS; });
    await waitFor(() => expect(document.querySelectorAll('[data-testid="kit-chart"]').length).toBe(2));
    expect([...document.querySelectorAll('[data-testid="kit-chart"]')].map(e => e.getAttribute('data-kind'))).toEqual(['bar', 'line']);
    expect(asked).toContain('milestone_by_id:M7');
    expect(asked.some(a => a.startsWith('sprints:'))).toBe(true);
    expect(screen.getAllByText(/Показано 2 из 3|2 из 3/).length).toBeGreaterThan(0);
  });

  it('не загрузилось — причина и «Повторить», не пустые графики', async () => {
    ui(async () => { throw new Error('502 шлюз'); });
    await waitFor(() => expect(screen.getAllByRole('button', { name: /Повторить/ }).length).toBeGreaterThan(0));
    expect(screen.getAllByText(/502 шлюз/).length).toBeGreaterThan(0);
  });

  // «можно и на дорожную карту» (19.11): на телефоне графики под вехой — раскрытием; до раскрытия срезы не грузятся.
  it('свёрнуто (телефон) — кнопка «Графики вехи», без запросов; раскрыл — два графика', async () => {
    const asked: string[] = [];
    render(<KitLangProvider lang="ru"><MilestoneSprintCharts milestoneId="M7" now={TODAY} fold
      load={async s => { asked.push(s); return s === 'milestone_by_id' ? MS : SPRINTS; }} /></KitLangProvider>);
    const btn = screen.getByRole('button', { name: /Графики вехи/ });
    expect(btn.getAttribute('aria-expanded')).toBe('false');
    expect(document.querySelectorAll('[data-testid="kit-chart"]').length).toBe(0);
    expect(asked).toEqual([]);
    fireEvent.click(btn);
    expect(btn.getAttribute('aria-expanded')).toBe('true');
    await waitFor(() => expect(document.querySelectorAll('[data-testid="kit-chart"]').length).toBe(2));
  });

  it('у вехи нет спринтов — так и сказано, графиков нет', async () => {
    ui(async s => (s === 'milestone_by_id' ? { rows: [{ milestone_id: 'M7', direct_sprint_ids: [] }] } : SPRINTS));
    await waitFor(() => expect(screen.getByTestId('milestone-charts-nosprints')).toBeTruthy());
    expect(document.querySelectorAll('[data-testid="kit-chart"]').length).toBe(0);
  });
});
