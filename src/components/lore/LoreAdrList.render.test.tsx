import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { renderUi } from '../../test/render';
import type { LoreAdrRow } from '../../api/lore';

// S0-05: ключевой экран «ADR». Данные — через мок fetchLoreSlice.
const fetchLoreSlice = vi.fn();
vi.mock('../../api/lore', async importOriginal => ({
  ...(await importOriginal<typeof import('../../api/lore')>()),
  fetchLoreSlice: (...a: unknown[]) => fetchLoreSlice(...a),
}));

const { default: LoreAdrList } = await import('./LoreAdrList');

const adr = (id: string, name: string, status: string): LoreAdrRow => ({
  adr_id: id, name, status, date_created: '2026-11-01', component: 'LORE', components: ['LORE'],
  tags: null, git_projects: ['AIDA/UnlimitedLORE'], decision_count: 2,
});

const noop = () => {};
const props = (over: Partial<Parameters<typeof LoreAdrList>[0]> = {}) => ({
  module: '', q: '', statusSel: new Set<string>(), compSel: new Set<string>(), tagSel: new Set<string>(),
  projSel: new Set<string>(), onError: noop, onOpen: noop, onNew: noop,
  onCounts: noop, onCompCounts: noop, onTagCounts: noop, onProjCounts: noop, ...over,
});

describe('LoreAdrList (render)', () => {
  beforeEach(() => {
    fetchLoreSlice.mockReset();
    fetchLoreSlice.mockImplementation((slice: string) => Promise.resolve(slice === 'adrs' ? [
      adr('ADR-LORE-001', 'Рендер-тесты обязательны', 'ACCEPTED'),
      adr('ADR-LORE-002', 'Черновик навигации', 'PROPOSED'),
    ] : []));
  });

  it('рисует ADR из среза adrs и открывает по клику', async () => {
    const onOpen = vi.fn();
    renderUi(<LoreAdrList {...props({ onOpen })} />);
    expect(await screen.findByText('Рендер-тесты обязательны')).toBeInTheDocument();
    expect(screen.getByText('ADR-LORE-002')).toBeInTheDocument();
    fireEvent.click(screen.getByText('ADR-LORE-001'));
    expect(onOpen).toHaveBeenCalledWith('ADR-LORE-001');
  });

  it('фильтр по статусу оставляет только ACCEPTED и отдаёт счётчики фасетов', async () => {
    const onCounts = vi.fn();
    renderUi(<LoreAdrList {...props({ statusSel: new Set(['ACCEPTED']), onCounts })} />);
    expect(await screen.findByText('ADR-LORE-001')).toBeInTheDocument();
    expect(screen.queryByText('ADR-LORE-002')).not.toBeInTheDocument();
    await waitFor(() => expect(onCounts).toHaveBeenLastCalledWith({ ACCEPTED: 1, PROPOSED: 1 }));
  });

  it('сбой среза adrs уходит в onError', async () => {
    const boom = new Error('403');
    fetchLoreSlice.mockImplementation(() => Promise.reject(boom));
    const onError = vi.fn();
    renderUi(<LoreAdrList {...props({ onError })} />);
    await waitFor(() => expect(onError).toHaveBeenCalledWith(boom));
  });
});
