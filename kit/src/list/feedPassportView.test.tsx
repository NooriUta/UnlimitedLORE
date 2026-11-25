// @vitest-environment jsdom
// Лента паспортов в виде «Лента» (SPRINT_LORE_BOARD_PASSPORTS/BP-01-FULL-PASSPORT-FEED).
//
// Замечание владелицы 14.11.2026: «Лента содержит только контекст (облегченные
// лента паспартов а я думала полноценную ленту паспортов сделаешь)». Прототип
// docs/prototypes/bp-01-passport-feed.html принят 25.11.2026 как есть:
//   • переключатель «Контекст / Полные паспорта», режим и число показанных — в адресе;
//   • «Полные паспорта» — каждая запись паспортом (его рисует приложение: kit
//     не знает, откуда брать паспорт LORE, K-14);
//   • догрузка по 4, автоматом до 12 паспортов / 40 карточек, дальше кнопкой
//     «Показать ещё» и «показано N из M»;
//   • у карточки контекста — «Открыть паспорт целиком», раскрывает в ленте.
// Прежняя лента («Контекст») не теряет ничего: тело, поиск, фильтры — на месте.
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { KitConfig, KitData, KitRecord } from '../core/contract';
import type { UrlWindow } from '../resilience/urlState';
import { ListView } from './ListView';

const NOW = '2026-11-25T12:00:00Z';
const rec = (i: number): KitRecord => ({
  id: `R-${String(i).padStart(2, '0')}`, kind: 'item', title: `Запись ${i}`, status: 'todo',
  fields: { lead: `суть ${i}` },
  // Свежие сверху: R-01 — самая свежая.
  updated_at: new Date(Date.parse(NOW) - i * 60_000).toISOString(),
});
const many = (n: number) => Array.from({ length: n }, (_, i) => rec(i + 1));

const cfg: KitConfig = {
  modules: [{ id: 'm', title: 'Раздел', icon: 'scroll-quill' }], menu: { groups: [] },
  kinds: { item: { title: 'Предмет', icon: 'scroll-quill', fields: [{ key: 'lead', title: 'Суть', type: 'text' }] } },
  statuses: { items: [{ code: 'todo', title: 'к работе', category: 'todo', icon: 'calendar', color: 'var(--t3)' }] },
  list: {
    views: ['list', 'feed'], columns: ['title+id', 'status'], groupings: ['status'], filters: ['status'], showClosed: 'all',
    feed: { timeField: 'updated_at', lead: ['fields.lead'] },
  },
};
const data = (records: KitRecord[]): KitData => ({ records, edges: [], journal: [], meta: { generated_at: NOW, total: records.length } });

/** Окно с адресом в памяти: что лента пишет в адрес, видно тесту. */
function memWin(search: string): UrlWindow & { params: () => URLSearchParams } {
  const w = {
    location: { pathname: '/', search, hash: '' },
    history: {
      pushState: (_s: unknown, _t: string, url?: string | URL | null) => { if (url) w.location.search = String(url).replace(/^[^?#]*/, '').replace(/#.*$/, ''); },
      replaceState: (_s: unknown, _t: string, url?: string | URL | null) => { if (url) w.location.search = String(url).replace(/^[^?#]*/, '').replace(/#.*$/, ''); },
    },
    params: () => new URLSearchParams(w.location.search),
  };
  return w;
}

const passport = vi.fn((r: KitRecord) => <div data-testid="pp" data-pp={r.id}>паспорт {r.id}</div>);
const ppIds = () => screen.queryAllByTestId('pp').map(e => e.getAttribute('data-pp'));
const itemIds = (c: HTMLElement) => [...c.querySelectorAll('.sk-feed__item[data-record-id]')].map(e => e.getAttribute('data-record-id'));

describe('BP-01 · переключатель «Контекст / Полные паспорта»', () => {
  it('приложение умеет паспорт — переключатель есть, по умолчанию «Контекст»', () => {
    render(<ListView config={cfg} data={data(many(3))} urlState={memWin('?lv=feed')} feedPassport={passport} />);
    const group = screen.getByRole('group', { name: 'Что показывать в ленте' });
    expect(group).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Контекст' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('button', { name: 'Полные паспорта' }).getAttribute('aria-pressed')).toBe('false');
  });

  it('паспорта приложение не дало — переключателя нет (обещать нечего)', () => {
    render(<ListView config={cfg} data={data(many(3))} urlState={memWin('?lv=feed')} />);
    expect(screen.queryByRole('group', { name: 'Что показывать в ленте' })).toBeNull();
  });

  it('выбор режима пишется в адрес (lfm=full) и обратно снимается', () => {
    const win = memWin('?lv=feed');
    render(<ListView config={cfg} data={data(many(3))} urlState={win} feedPassport={passport} />);
    fireEvent.click(screen.getByRole('button', { name: 'Полные паспорта' }));
    expect(win.params().get('lfm')).toBe('full');
    fireEvent.click(screen.getByRole('button', { name: 'Контекст' }));
    expect(win.params().get('lfm')).toBeNull();
  });
});

describe('BP-01 · «Полные паспорта»', () => {
  it('каждая видимая запись — паспортом приложения, и прежнего тела-контекста нет', () => {
    const { container } = render(<ListView config={cfg} data={data(many(3))} urlState={memWin('?lv=feed&lfm=full')} feedPassport={passport} />);
    expect(ppIds()).toEqual(['R-01', 'R-02', 'R-03']);
    expect(container.querySelector('.sk-feed__lead')).toBeNull();
  });

  it('автоматом — не больше 12 паспортов, дальше кнопка и «показано 12 из 20»', () => {
    passport.mockClear();
    render(<ListView config={cfg} data={data(many(20))} urlState={memWin('?lv=feed&lfm=full')} feedPassport={passport} />);
    expect(ppIds()).toHaveLength(12);
    // Паспорт невидимой записи не строится вовсе: его загрузка — забота приложения, и она не начнётся.
    expect(passport.mock.calls.map(c => c[0].id)).not.toContain('R-13');
    expect(screen.getAllByText('показано 12 из 20').length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole('button', { name: 'Показать ещё 4' }));
    expect(ppIds()).toHaveLength(16);
  });

  it('число показанных — в адресе (lfn) и восстанавливается из него', () => {
    const win = memWin('?lv=feed&lfm=full&lfn=16');
    render(<ListView config={cfg} data={data(many(20))} urlState={win} feedPassport={passport} />);
    expect(ppIds()).toHaveLength(16);
    fireEvent.click(screen.getByRole('button', { name: 'Показать ещё 4' }));
    expect(win.params().get('lfn')).toBe('20');
    expect(screen.getByText('Это вся лента · 20')).toBeTruthy();
  });

  it('переход в «Полные паспорта» с длинной ленты контекста — не больше 12', () => {
    render(<ListView config={cfg} data={data(many(50))} urlState={memWin('?lv=feed')} feedPassport={passport} />);
    fireEvent.click(screen.getByRole('button', { name: 'Полные паспорта' }));
    expect(ppIds()).toHaveLength(12);
  });
});

describe('BP-01 · «Контекст»', () => {
  it('прежняя лента: суть видна, паспортов нет; автоматом — до 40 карточек', () => {
    const { container } = render(<ListView config={cfg} data={data(many(45))} urlState={memWin('?lv=feed')} feedPassport={passport} />);
    expect(itemIds(container)).toHaveLength(40);
    expect(ppIds()).toEqual([]);
    expect(container.querySelector('.sk-feed__lead')).toBeTruthy();
    expect(screen.getAllByText('показано 40 из 45').length).toBeGreaterThan(0);
  });

  it('«Открыть паспорт целиком» раскрывает паспорт ЭТОЙ записи прямо в ленте', () => {
    render(<ListView config={cfg} data={data(many(3))} urlState={memWin('?lv=feed')} feedPassport={passport} />);
    const open = screen.getAllByRole('button', { name: 'Открыть паспорт целиком' });
    expect(open).toHaveLength(3);
    fireEvent.click(open[1]);
    expect(ppIds()).toEqual(['R-02']);
  });

  it('фильтр по тексту работает до окна показа: лента не теряет поиск', () => {
    const { container } = render(<ListView config={cfg} data={data(many(45))} urlState={memWin('?lv=feed&lt=R-07')} feedPassport={passport} />);
    expect(itemIds(container)).toEqual(['R-07']);
    expect(screen.getByText('Это вся лента · 1')).toBeTruthy();
  });
});
