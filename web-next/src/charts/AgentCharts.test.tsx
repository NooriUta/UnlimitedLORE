// @vitest-environment jsdom
// №13 «действия агентов по дням» (Журнал) и №14 «отказы MCP по кодам» (экран MCP), предложение 19.11.2026.
import { beforeEach, describe, expect, it } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { KitLangProvider } from '@seidr/kit';
import { AgentActionsChart, McpFailureCodesChart } from './AgentCharts';

const NOW = Date.parse('2026-11-19T15:00:00Z');
const ROWS = { rows: [
  { ts: '2026-11-19T10:00:00Z', caller: 'full', client: 'c-full', status: 200 },
  { ts: '2026-11-18T10:00:00Z', caller: 'full', client: 'c-full', status: 409 },
  { ts: '2026-11-17T10:00:00Z', caller: 'pm', client: 'c-pm', status: 401 },
] };
const kinds = () => [...document.querySelectorAll('[data-testid="kit-chart"]')].map(e => e.getAttribute('data-kind'));

beforeEach(() => { window.history.replaceState(null, '', '/'); });

describe('№13 действия агентов', () => {
  it('по умолчанию 30 дней: since — начало периода; линии по профилю', async () => {
    const asked: Record<string, string>[] = [];
    render(<KitLangProvider lang="ru"><AgentActionsChart now={NOW} load={async (_s, p) => { asked.push(p); return ROWS; }} /></KitLangProvider>);
    await waitFor(() => expect(kinds()).toEqual(['line']));
    expect(asked[0]).toEqual({ since: '2026-10-21' });
    expect(document.querySelectorAll('path[data-series]').length).toBe(2);
  });

  it('период и разрез — в адресе', async () => {
    render(<KitLangProvider lang="ru"><AgentActionsChart now={NOW} load={async () => ROWS} /></KitLangProvider>);
    await waitFor(() => expect(kinds()).toEqual(['line']));
    fireEvent.click(screen.getByRole('button', { name: '7 дней' }));
    fireEvent.click(screen.getByRole('button', { name: 'по клиенту' }));
    const q = new URL(window.location.href).searchParams;
    expect(q.get('adm-chp')).toBe('7');
    expect(q.get('adm-chby')).toBe('client');
  });

  it('действий нет — словами, а не нулевые линии', async () => {
    render(<KitLangProvider lang="ru"><AgentActionsChart now={NOW} load={async () => ({ rows: [] })} /></KitLangProvider>);
    await waitFor(() => expect(screen.getByText(/действий агентов не видели/)).toBeTruthy());
  });

  it('нет прав — так и сказано', async () => {
    const e = Object.assign(new Error('ADMIN_ONLY: срез — админский журнал'), { status: 403 });
    render(<KitLangProvider lang="ru"><AgentActionsChart now={NOW} load={async () => { throw e; }} /></KitLangProvider>);
    await waitFor(() => expect(screen.getAllByText(/Нет прав|ADMIN_ONLY/).length).toBeGreaterThan(0));
  });
});

describe('№14 отказы MCP по кодам', () => {
  it('столбики по дням, группы — коды', async () => {
    render(<KitLangProvider lang="ru"><McpFailureCodesChart now={NOW} load={async () => ROWS} /></KitLangProvider>);
    await waitFor(() => expect(kinds()).toEqual(['bar']));
    expect(screen.getByText('401')).toBeTruthy();
    expect(screen.getByText('409')).toBeTruthy();
  });

  it('отказов нет — словами', async () => {
    render(<KitLangProvider lang="ru"><McpFailureCodesChart now={NOW} load={async () => ({ rows: [ROWS.rows[0]] })} /></KitLangProvider>);
    await waitFor(() => expect(screen.getByText(/Отказов за период нет/)).toBeTruthy());
  });
});
