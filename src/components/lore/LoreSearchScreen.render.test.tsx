import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import { renderUi } from '../../test/render';
import type { LoreSearchHit, LoreSearchResult } from '../../api/lore';

// S0-05: ключевой экран «Поиск». Данные — через мок fetchLoreSearch.
const fetchLoreSearch = vi.fn();
vi.mock('../../api/lore', async importOriginal => ({
  ...(await importOriginal<typeof import('../../api/lore')>()),
  fetchLoreSearch: (...a: unknown[]) => fetchLoreSearch(...a),
}));

const { LoreSearchScreen } = await import('./LoreSearchScreen');

const hit = (ref: string, title: string): LoreSearchHit => ({
  type: 'adr', ref_id: ref, title, score: 1, bm25: 1, type_priority: 1, matched_field: 'title',
  snippet: null, components: ['LORE'], inherited_from: null, projects: ['AIDA/UnlimitedLORE'],
});

const result = (hits: LoreSearchHit[]): LoreSearchResult => ({
  hits, by_type: hits.length ? { adr: hits.length } : {}, by_component: {}, by_project: {}, warnings: [],
  total_collected: hits.length, capped_at: 500, lucene: '(рендер OR рендер*)', mode: 'smart',
  offset: 0, limit: 50, took_ms: 3,
});

const type = (text: string) => fireEvent.change(screen.getByRole('textbox', { name: 'Сквозной поиск' }), { target: { value: text } });

describe('LoreSearchScreen (render)', () => {
  beforeEach(() => { fetchLoreSearch.mockReset(); });

  it('запрос из 2+ символов уходит в поиск, выдача рисуется', async () => {
    fetchLoreSearch.mockResolvedValue(result([hit('ADR-LORE-001', 'Рендер-тесты обязательны')]));
    renderUi(<LoreSearchScreen />);
    type('рендер');
    expect(await screen.findByText('Рендер-тесты обязательны')).toBeInTheDocument();
    expect(fetchLoreSearch).toHaveBeenCalledWith(expect.objectContaining({ q: 'рендер', mode: 'smart' }), expect.anything());
  });

  it('пусто и сбой рисуются по-разному: «ничего не попало» ≠ «поиск не ответил»', async () => {
    fetchLoreSearch.mockResolvedValue(result([]));
    const { unmount } = renderUi(<LoreSearchScreen />);
    type('пусто');
    expect(await screen.findByText('Под эти фильтры ничего не попало')).toBeInTheDocument();
    expect(screen.queryByText('Поиск не ответил')).not.toBeInTheDocument();
    unmount();

    fetchLoreSearch.mockRejectedValue(new Error('502 upstream'));
    renderUi(<LoreSearchScreen />);
    type('сбой');
    expect(await screen.findByText('Поиск не ответил')).toBeInTheDocument();
    expect(screen.getByText('502 upstream')).toBeInTheDocument();
    expect(screen.queryByText('Под эти фильтры ничего не попало')).not.toBeInTheDocument();
  });
});
