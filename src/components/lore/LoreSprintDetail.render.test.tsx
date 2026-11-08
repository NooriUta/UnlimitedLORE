import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { renderUi } from '../../test/render';
import { LoreHttpError, type LoreSprintTask } from '../../api/lore';

// S0-05: ключевой экран «Карточка спринта с задачами». Данные — через мок fetchLoreSlice.
const fetchLoreSlice = vi.fn();
vi.mock('../../api/lore', async importOriginal => ({
  ...(await importOriginal<typeof import('../../api/lore')>()),
  fetchLoreSlice: (...a: unknown[]) => fetchLoreSlice(...a),
}));

const { default: LoreSprintDetail } = await import('./LoreSprintDetail');

const META = {
  sprint_id: 'SPRINT_ALPHA', name: 'Альфа', status_raw: '🔄 ACTIVE', priority: 'P1', pr_refs: null,
  release_ids: null, milestone_ids: null, depends_on: null, blocks: null, components: ['LORE'],
  adr_ids: null, context_md: null, git_projects: ['AIDA/UnlimitedLORE'], created_date: '2026-11-01',
  planned_start_date: null, planned_end_date: null, no_release_required: null,
};

const task = (id: string, title: string, status: string): LoreSprintTask => ({
  task_uid: `SPRINT_ALPHA/${id}`, task_id: id, title, order_index: 0, phase_uid: null,
  status_raw: status, effort_days: null, note_md: null, component_ids: ['LORE'],
});

function mockSlices(main: 'ok' | Error) {
  fetchLoreSlice.mockImplementation((slice: string) => {
    if (main instanceof Error && ['sprint_tree', 'phases_of_sprint', 'tasks_of_sprint'].includes(slice)) {
      return Promise.reject(main);
    }
    if (slice === 'sprint_tree') return Promise.resolve([META]);
    if (slice === 'tasks_of_sprint') {
      return Promise.resolve([
        task('A-1', 'Каркас рендер-тестов', '✅ DONE'),
        task('A-2', 'Тесты ключевых экранов', '📋 PLANNED'),
      ]);
    }
    return Promise.resolve([]);
  });
}

describe('LoreSprintDetail (render)', () => {
  beforeEach(() => { fetchLoreSlice.mockReset(); });

  it('карточка спринта рисует id и задачи из tasks_of_sprint', async () => {
    mockSlices('ok');
    renderUi(<LoreSprintDetail sprintId="SPRINT_ALPHA" onError={() => {}} />);
    expect(await screen.findByText('Каркас рендер-тестов')).toBeInTheDocument();
    expect(screen.getByText('Тесты ключевых экранов')).toBeInTheDocument();
    expect(screen.getAllByText('SPRINT_ALPHA').length).toBeGreaterThan(0);
    expect(fetchLoreSlice).toHaveBeenCalledWith('tasks_of_sprint', { sprint_id: 'SPRINT_ALPHA' }, expect.anything());
  });

  it('сбой загрузки — LoadError с повтором, а не «спринт не найден»', async () => {
    mockSlices(new LoreHttpError(500, 'LORE_QUERY_FAILED', ''));
    const onError = vi.fn();
    renderUi(<LoreSprintDetail sprintId="SPRINT_ALPHA" onError={onError} />);
    expect(await screen.findByText(/Спринт SPRINT_ALPHA не загрузился/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Повторить' })).toBeInTheDocument();
    expect(screen.queryByText(/не найден/)).not.toBeInTheDocument();
  });
});
