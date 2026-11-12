// @vitest-environment jsdom
// «Библиотека» — документы владельца по виду (SPRINT_UXR_S10_SEIDR_KIT_2/K2-VIEW-LIBRARY).
// Прототип утверждён владелицей 11.11.2026 (https://claude.ai/artifact/6W4ztEg8AZ19ivN5HW4hry):
// группы слева, чтение на месте справа, на телефоне — нижним листом; фильтр «устарели»;
// в группе первые пять, дальше «ещё N»; пусто, нет прав и сбой — разными словами.
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { libraryModel } from './libraryModel';
import { LibraryView } from './LibraryView';
import type { LibraryGroup } from './libraryModel';

const doc = (id: string, title: string, stale = false, body?: string) => ({ id, code: id, title, state: stale ? 'устарел' : 'принят', stale, body });

const groups: LibraryGroup[] = [
  { key: 'adr', title: 'Решения (ADR)', docs: [doc('ADR-1', 'Колонки по модели', false, 'Тело **ADR-1**'), doc('ADR-2', 'Правка на месте'), doc('ADR-3', 'Гейты по слоям', true), doc('ADR-4', 'Четыре'), doc('ADR-5', 'Пять'), doc('ADR-6', 'Шесть'), doc('ADR-7', 'Семь')] },
  { key: 'doc', title: 'Документы', total: 9, docs: [doc('DOC-1', 'Как читать вердикт', true), doc('DOC-2', 'Словарь правил')] },
];

describe('модель библиотеки', () => {
  it('поиск — по коду и названию, без регистра; пустые группы уходят', () => {
    const m = libraryModel(groups, { query: 'вердикт', filter: 'all' });
    expect(m.groups.map(g => g.key)).toEqual(['doc']);
    expect(m.groups[0].docs.map(d => d.id)).toEqual(['DOC-1']);
    expect(libraryModel(groups, { query: 'adr-2', filter: 'all' }).groups[0].docs.map(d => d.id)).toEqual(['ADR-2']);
  });

  it('фильтр «устарели» и «актуальные»; счёт устаревших — по всем загруженным', () => {
    expect(libraryModel(groups, { query: '', filter: 'stale' }).groups.flatMap(g => g.docs.map(d => d.id))).toEqual(['ADR-3', 'DOC-1']);
    expect(libraryModel(groups, { query: '', filter: 'fresh' }).groups.flatMap(g => g.docs).some(d => d.stale)).toBe(false);
    expect(libraryModel(groups, { query: '', filter: 'all' }).staleCount).toBe(2);
  });
});

describe('вид «Библиотека»', () => {
  it('группы с числом, первые пять и «ещё N», нажатие показывает следующие', () => {
    render(<LibraryView groups={groups} narrow={false} />);
    const adr = screen.getByRole('region', { name: 'Решения (ADR)' });
    expect(within(adr).getAllByRole('button', { name: /^ADR-/ })).toHaveLength(5);
    fireEvent.click(within(adr).getByRole('button', { name: 'ещё 2' }));
    expect(within(adr).getAllByRole('button', { name: /^ADR-/ })).toHaveLength(7);
    // Сервер прислал не всё: 9 в группе, загружено 2 — так и сказано, а не «ещё 7» кнопкой.
    const docs = screen.getByRole('region', { name: 'Документы' });
    expect(within(docs).getByText('показаны 2 из 9')).toBeTruthy();
  });

  it('чтение на месте: первый документ открыт сразу, выбор меняет читалку; «Открыть паспорт» — ссылка приложения', () => {
    const onSelect = vi.fn();
    render(<LibraryView groups={groups} narrow={false} href={id => `/p/${id}`} onSelect={onSelect} />);
    const reader = screen.getByRole('article');
    expect(within(reader).getByRole('heading', { name: 'Колонки по модели' })).toBeTruthy();
    expect(reader.querySelector('strong')?.textContent).toBe('ADR-1');
    fireEvent.click(screen.getByRole('button', { name: /ADR-2/ }));
    expect(onSelect).toHaveBeenLastCalledWith('ADR-2');
    expect(within(screen.getByRole('article')).getByRole('heading', { name: 'Правка на месте' })).toBeTruthy();
    expect(within(screen.getByRole('article')).getByRole('link', { name: 'Открыть паспорт' }).getAttribute('href')).toBe('/p/ADR-2');
  });

  it('renderBody: своё тело — без дубля meta/заголовка и без «Открыть паспорт»', () => {
    const withMeta: LibraryGroup[] = [{ key: 'adr', title: 'Решения (ADR)', docs: [{ id: 'ADR-1', code: 'ADR-1', title: 'Колонки по модели', state: 'принят', stale: false, body: 'Тело', meta: 'принят 08.11 · владелица' }] }];
    render(<LibraryView groups={withMeta} narrow={false} href={id => `/p/${id}`} renderBody={() => <h1>Паспорт ADR-1</h1>} />);
    const reader = screen.getByRole('article');
    expect(within(reader).getAllByRole('heading')).toHaveLength(1);
    expect(within(reader).queryByText('принят 08.11 · владелица')).toBeNull();
    expect(within(reader).queryByRole('link', { name: 'Открыть паспорт' })).toBeNull();
  });

  it('фильтр «устарели N» в чипе; устаревший помечен', () => {
    render(<LibraryView groups={groups} narrow={false} />);
    fireEvent.click(screen.getByRole('button', { name: 'устарели 2' }));
    expect(screen.getAllByRole('button', { name: /^(ADR|DOC)-/ }).map(b => b.getAttribute('data-doc-id'))).toEqual(['ADR-3', 'DOC-1']);
    expect(document.querySelector('[data-doc-id="ADR-3"]')?.hasAttribute('data-stale')).toBe(true);
  });

  it('на телефоне: список без читалки, документ открывается нижним листом', () => {
    render(<LibraryView groups={groups} narrow />);
    expect(screen.queryByRole('article')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /ADR-2/ }));
    const sheet = screen.getByRole('dialog', { name: 'Правка на месте' });
    expect(sheet).toBeTruthy();
  });

  it('честные состояния: пусто, нет прав, сбой — разные; поиск без совпадений — не «пусто»', () => {
    const { rerender } = render(<LibraryView groups={[]} narrow={false} />);
    expect(document.querySelector('[data-state="empty"]')).toBeTruthy();
    rerender(<LibraryView groups={[]} narrow={false} status={{ kind: 'forbidden', reason: 'вне скоупа' }} />);
    expect(document.querySelector('[data-state="forbidden"]')).toBeTruthy();
    rerender(<LibraryView groups={[]} narrow={false} status={{ kind: 'error', error: new Error('503') }} />);
    expect(screen.getByRole('alert')).toBeTruthy();
    rerender(<LibraryView groups={groups} narrow={false} />);
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'нет такого' } });
    expect(screen.getByText('Ничего не нашлось по «нет такого»')).toBeTruthy();
  });
});

// Долг, найденный при подключении в web-next (серверная сессия 11.11.2026): поиск и
// фильтр должны держаться в адресе — значит, у вида они управляемые, с колбэками.
describe('библиотека: поиск и фильтр управляемые', () => {
  it('задан query/filter снаружи — вид их показывает; ввод и чип уходят в колбэки', () => {
    const onQuery = vi.fn();
    const onFilter = vi.fn();
    render(<LibraryView groups={groups} narrow={false} query="гейт" onQuery={onQuery} filter="stale" onFilter={onFilter} />);
    expect((screen.getByRole('searchbox') as HTMLInputElement).value).toBe('гейт');
    expect(screen.getAllByRole('button', { name: /^(ADR|DOC)-/ }).map(b => b.getAttribute('data-doc-id'))).toEqual(['ADR-3']);
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'гейты' } });
    expect(onQuery).toHaveBeenLastCalledWith('гейты');
    fireEvent.click(screen.getByRole('button', { name: /^все/ }));
    expect(onFilter).toHaveBeenLastCalledWith('all');
  });
});
