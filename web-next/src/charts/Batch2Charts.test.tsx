// @vitest-environment jsdom
// Пачка 2 графиков (19.11.2026): блоки по местам — свои срезы и честные состояния.
import { beforeEach, describe, expect, it } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { KitLangProvider } from '@seidr/kit';
import { BlockedBlock, GateCharts, ProjectCharts } from './Batch2Charts';

const NOW = Date.parse('2026-11-19T12:00:00Z');
const wrap = (n: React.ReactNode) => render(<KitLangProvider lang="ru">{n}</KitLangProvider>);
const kinds = () => [...document.querySelectorAll('[data-testid="kit-chart"]')].map(e => e.getAttribute('data-kind'));

beforeEach(() => { window.history.replaceState(null, '', '/?pch=1'); });

describe('паспорт проекта: №4 и №8', () => {
  it('срезы — по проекту; релизы без PR — словами, не нулём', async () => {
    const asked: string[] = [];
    wrap(<ProjectCharts slug="org/a" now={NOW} load={async (s, p) => {
      asked.push(`${s}:${p.project}`);
      if (s === 'releases') return { rows: [{ git_tag: 'v1', release_date: '2026-10-01', pr_count: 4 }, { git_tag: 'v2', release_date: '2026-11-01', pr_count: 0 }] };
      return { rows: [{ task_uid: 'S/A', status_raw: '⬜ TODO', valid_from: '2026-11-01T00:00:00Z' }] };
    }} />);
    await waitFor(() => expect(kinds()).toEqual(['bar', 'scatter']));
    expect(asked.sort()).toEqual(['releases:org/a', 'task_status_versions:org/a']);
    expect(screen.getByText(/Релизов без связанных PR: 1/)).toBeTruthy();
  });
});

describe('паспорт гейта: №16', () => {
  it('рутина — код гейта в нижнем регистре; прогонов нет — словами', async () => {
    wrap(<GateCharts qgId="QG-LORE-X" now={NOW} load={async () => ({ rows: [{ routine_name: 'qg-other', run_date: '2026-11-17', status: 'PASS' }] })} />);
    await waitFor(() => expect(screen.getByTestId('gate-pass-none').textContent).toContain('qg-lore-x'));
    expect(kinds()).toEqual([]);
  });

  it('прогоны есть — линия доли PASS', async () => {
    wrap(<GateCharts qgId="QG-LORE-X" now={NOW} load={async () => ({ rows: [{ routine_name: 'qg-lore-x', run_date: '2026-11-17', status: 'PASS' }] })} />);
    await waitFor(() => expect(kinds()).toEqual(['line']));
  });
});

describe('№5 блокировки', () => {
  it('сбой — причина и «Повторить»', async () => {
    wrap(<BlockedBlock now={NOW} load={async () => { throw new Error('502 шлюз'); }} />);
    await waitFor(() => expect(screen.getAllByRole('button', { name: /Повторить/ }).length).toBeGreaterThan(0));
  });
  it('блоков не было — словами, а не нулевая линия', async () => {
    wrap(<BlockedBlock now={NOW} load={async () => ({ rows: [] })} />);
    await waitFor(() => expect(screen.getByTestId('blocked-none')).toBeTruthy());
  });
});
