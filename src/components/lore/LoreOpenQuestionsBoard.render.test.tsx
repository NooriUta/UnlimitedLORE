import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { renderUi } from '../../test/render';
import type { LoreQuestionRow } from '../../api/lore';

// Ключевой экран «Открытые вопросы»: слайсы — мок, остальное API — настоящее.
const fetchLoreSlice = vi.fn();
vi.mock('../../api/lore', async importOriginal => ({
  ...(await importOriginal<typeof import('../../api/lore')>()),
  fetchLoreSlice: (...a: unknown[]) => fetchLoreSlice(...a),
}));

const { default: LoreOpenQuestionsBoard } = await import('./LoreOpenQuestionsBoard');

const q = (id: string, title: string, status: string): LoreQuestionRow => ({
  question_id: id, title, body_md: null, status, component_id: 'LORE', components: ['LORE'],
  projects: null, due_date: null, priority: 'normal', owner: null, raised_by: null,
  opened_date: '2026-11-01', closed_date: null, gating_tasks: null, raised_adr: null,
  raised_sprint: null, answered_by: null,
});

describe('LoreOpenQuestionsBoard (render)', () => {
  beforeEach(() => fetchLoreSlice.mockReset());

  it('загружает срез questions и рисует вопросы', async () => {
    fetchLoreSlice.mockImplementation((slice: string) =>
      Promise.resolve(slice === 'questions' ? [q('Q-1', 'Нужен ли jsdom в CI?', 'open')] : []));
    renderUi(<LoreOpenQuestionsBoard q="" onError={() => {}} />);
    expect(await screen.findByText(/Нужен ли jsdom в CI\?/)).toBeInTheDocument();
    expect(fetchLoreSlice).toHaveBeenCalledWith('questions');
  });

  it('сбой среза questions уходит в onError', async () => {
    const boom = new Error('500');
    fetchLoreSlice.mockImplementation((slice: string) =>
      slice === 'questions' ? Promise.reject(boom) : Promise.resolve([]));
    const onError = vi.fn();
    renderUi(<LoreOpenQuestionsBoard q="" onError={onError} />);
    await waitFor(() => expect(onError).toHaveBeenCalledWith(boom));
  });
});
