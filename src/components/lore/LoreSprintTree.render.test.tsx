import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { renderUi } from '../../test/render';
import type { LoreSprintRow } from '../../api/lore';

// S0-05: ключевой экран «Список спринтов». Данные — через мок fetchLoreSlice.
const fetchLoreSlice = vi.fn();
vi.mock('../../api/lore', async importOriginal => ({
  ...(await importOriginal<typeof import('../../api/lore')>()),
  fetchLoreSlice: (...a: unknown[]) => fetchLoreSlice(...a),
}));

const { default: LoreSprintTree } = await import('./LoreSprintTree');

const sprint = (id: string, name: string, status: string, project: string): LoreSprintRow => ({
  sprint_id: id, name, status_raw: status, priority: 'P1', valid_from: '2026-11-01',
  release_ids: null, release_dates: null, done_date: null, git_projects: [project], components: ['LORE'],
  track_id: null, context_md: null, created_date: '2026-11-01', planned_start_date: null,
  planned_end_date: null, milestone_ids: null, no_release_required: null,
});

const SPRINTS = [
  sprint('SPRINT_ALPHA', 'Альфа', '✅ DONE', 'AIDA/UnlimitedLORE'),
  sprint('SPRINT_BETA', 'Бета', '🔄 ACTIVE', 'AIDA/miniLORE'),
];

function mockSlices(sprints: LoreSprintRow[] | Error) {
  fetchLoreSlice.mockImplementation((slice: string) => {
    if (slice === 'sprints') return sprints instanceof Error ? Promise.reject(sprints) : Promise.resolve(sprints);
    if (slice === 'task_status_by_sprint') {
      return Promise.resolve([
        { sprint_id: 'SPRINT_ALPHA', status_raw: '✅ DONE' },
        { sprint_id: 'SPRINT_ALPHA', status_raw: '📋 PLANNED' },
      ]);
    }
    return Promise.resolve([]);
  });
}

describe('LoreSprintTree (render)', () => {
  beforeEach(() => { fetchLoreSlice.mockReset(); });

  it('загружает срез sprints и рисует строки; клик выбирает спринт', async () => {
    mockSlices(SPRINTS);
    const onSelect = vi.fn();
    renderUi(<LoreSprintTree module="" onError={() => {}} onSelect={onSelect} />);
    expect(await screen.findByText('SPRINT_ALPHA')).toBeInTheDocument();
    expect(screen.getByText('SPRINT_BETA')).toBeInTheDocument();
    expect(fetchLoreSlice).toHaveBeenCalledWith('sprints', undefined, expect.anything());
    fireEvent.click(screen.getByText('SPRINT_BETA'));
    expect(onSelect).toHaveBeenCalledWith('SPRINT_BETA');
  });

  it('фильтр по проекту и строка поиска сужают список', async () => {
    mockSlices(SPRINTS);
    const { rerender } = renderUi(
      <LoreSprintTree module="" onError={() => {}} projectFilter={new Set(['AIDA/miniLORE'])} />,
    );
    expect(await screen.findByText('SPRINT_BETA')).toBeInTheDocument();
    expect(screen.queryByText('SPRINT_ALPHA')).not.toBeInTheDocument();

    rerender(<LoreSprintTree module="" onError={() => {}} q="альфа" />);
    expect(await screen.findByText('SPRINT_ALPHA')).toBeInTheDocument();
    expect(screen.queryByText('SPRINT_BETA')).not.toBeInTheDocument();
  });

  it('пустой срез — «Спринты не найдены»', async () => {
    mockSlices([]);
    renderUi(<LoreSprintTree module="" onError={() => {}} />);
    expect(await screen.findByText('Спринты не найдены.')).toBeInTheDocument();
  });

  it('сбой загрузки уходит в onError', async () => {
    const boom = new Error('500');
    mockSlices(boom);
    const onError = vi.fn();
    renderUi(<LoreSprintTree module="" onError={onError} />);
    await waitFor(() => expect(onError).toHaveBeenCalledWith(boom));
  });
});
