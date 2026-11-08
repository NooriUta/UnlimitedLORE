import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { renderUi } from '../../test/render';
import type { LoreDecisionRow } from '../../api/lore';

// Ключевой экран «Решения»: данные — через мок fetchLoreSlice, остальное API — настоящее.
const fetchLoreSlice = vi.fn();
vi.mock('../../api/lore', async importOriginal => ({
  ...(await importOriginal<typeof import('../../api/lore')>()),
  fetchLoreSlice: (...a: unknown[]) => fetchLoreSlice(...a),
}));

const { default: LoreDecisionBoard } = await import('./LoreDecisionBoard');

const row = (id: string, title: string, parent: string | null): LoreDecisionRow => ({
  decision_id: id, title, date_created: '2026-11-01', status_raw: null, component_id: 'LORE',
  components: ['LORE'], projects: ['UnlimitedLORE'], tags: null, parent_adr: parent,
});

describe('LoreDecisionBoard (render)', () => {
  // Тело в фигурных скобках: стрелка-выражение вернула бы mock, и Vitest вызвал бы его
  // как teardown-хук после теста (отклонённый промис мока валит тест).
  beforeEach(() => { fetchLoreSlice.mockReset(); });

  it('загружает срез decisions и рисует решения', async () => {
    fetchLoreSlice.mockResolvedValue([
      row('D-2026-ONE', 'Рендер-тесты обязательны', 'ADR-LORE-001'),
      row('D-2026-TWO', 'Сирота без ADR', null),
    ]);
    renderUi(<LoreDecisionBoard q="" onError={() => {}} />);
    expect(await screen.findByText(/Рендер-тесты обязательны/)).toBeInTheDocument();
    expect(screen.getByText(/Сирота без ADR/)).toBeInTheDocument();
    expect(fetchLoreSlice).toHaveBeenCalledWith('decisions', undefined, expect.anything());
  });

  it('сбой загрузки уходит в onError, а не рисуется как пустой список', async () => {
    const boom = new Error('403');
    fetchLoreSlice.mockImplementation(() => Promise.reject(boom));
    const onError = vi.fn();
    renderUi(<LoreDecisionBoard q="" onError={onError} />);
    await waitFor(() => expect(onError).toHaveBeenCalledWith(boom));
  });
});
