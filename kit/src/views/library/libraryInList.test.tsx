// @vitest-environment jsdom
// «Библиотека» — вид общего переключателя ListView (SPRINT_UXR_S10_SEIDR_KIT_2/K2-VIEW-LIBRARY).
// Долг, найденный при подключении в web-next (11.11.2026): вида `library` в ListView не было,
// и приложение рисовало отдельную кнопку. Группы по записям строит приложение (K-14) — пропом;
// поиск — тот же текст списка (lt), фильтр «устарели» — в состоянии списка (llf), значит в адресе.
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { KitConfig, KitData, KitRecord } from '../../core/contract';
import { ListView } from '../../list/ListView';
import { readListState, writeListState, DEFAULT_LIST_STATE } from '../../list/listModel';
import type { LibraryGroup } from './libraryModel';

const rec = (id: string, stale = false): KitRecord => ({ id, kind: 'doc', title: `Документ ${id}`, status: 'todo', fields: { stale } });
const cfg: KitConfig = {
  modules: [], menu: { groups: [] }, kinds: { doc: { title: 'Документы', icon: 'book' } },
  statuses: { items: [{ code: 'todo', title: 'к работе', category: 'todo', icon: 'book', color: 'var(--t3)' }] },
  list: { views: ['list', 'library'], columns: ['title'] },
};
const data: KitData = { records: [rec('D-1'), rec('D-2', true)], edges: [], journal: [], meta: { generated_at: '2026-11-11T00:00:00Z' } };
const groups = (rs: readonly KitRecord[]): LibraryGroup[] =>
  [{ key: 'doc', title: 'Документы', docs: rs.map(r => ({ id: r.id, code: r.id, title: r.title, stale: r.fields.stale === true })) }];

describe('вид «Библиотека» в ListView', () => {
  it('адрес: ?lv=library и фильтр llf читаются и пишутся', () => {
    expect(readListState(new URLSearchParams('lv=library&llf=stale')).view).toBe('library');
    expect(readListState(new URLSearchParams('lv=library&llf=stale')).libFilter).toBe('stale');
    expect(readListState(new URLSearchParams('llf=мусор')).libFilter).toBeUndefined();
    expect(writeListState({ ...DEFAULT_LIST_STATE, view: 'library', libFilter: 'stale' }).llf).toBe('stale');
  });

  it('в общем переключателе; группы — от приложения; фильтр уходит в состояние', () => {
    const onStateChange = vi.fn();
    render(<ListView config={cfg} data={data} urlState={false} narrow={false} library={{ groups }}
      initial={{ view: 'library' }} onStateChange={onStateChange} />);
    expect(screen.getAllByText('Библиотека').length).toBeGreaterThan(0);
    expect(document.querySelector('[data-doc-id="D-1"]')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /устарели 1/ }));
    expect(onStateChange).toHaveBeenLastCalledWith(expect.objectContaining({ libFilter: 'stale' }));
  });

  it('вид выбран, а групп приложение не дало — сказано словами', () => {
    render(<ListView config={cfg} data={data} urlState={false} narrow={false} initial={{ view: 'library' }} />);
    expect(screen.getByText(/библиотек.*не задан/i)).toBeTruthy();
  });
});
