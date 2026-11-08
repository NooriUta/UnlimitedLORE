// @vitest-environment jsdom
// Аудит навигации 08.11.2026, находка P1: «"Недавние" пусто даже после
// открытия записи».
//
// Разбор. У оболочки есть openRecord, который и ведёт список недавних, но
// экраны списков его не зовут: щелчок по строке открывал паспорт своим
// состоянием (?open=…), а оболочка об этом не узнавала. То есть список был
// пуст не потому, что «ничего не открывали», а потому что о «открывали» никто
// не сообщал.
//
// Второе: у оболочки не было названий записей. KitShell берёт их из data,
// которую приложение в v2 не передаёт, и недавнее печаталось кодом с пометкой
// «название не найдено» — честно, но бесполезно. Поэтому openRecord принимает
// название и запоминает его рядом со списком.
import { beforeAll, describe, expect, it } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import gameIcons from '@iconify-json/game-icons/icons.json';
import { KitShell, createSafeStorage, registerGameIcons, useKitShell, useOptionalKitShell } from '../index';
import type { KitConfig } from '../index';
import type { UrlWindow } from '../resilience/urlState';

beforeAll(() => { registerGameIcons(gameIcons); });

const CONFIG: KitConfig = {
  modules: [{ id: 'lore', title: 'LORE', icon: 'scroll-unfurled', status: 'active' }],
  menu: { recent: true, groups: [{ id: 'work', title: 'Работа', items: [{ id: 'sprints', title: 'Спринты' }] }] },
  kinds: {}, statuses: { items: [] },
};

function fakeWin(): UrlWindow {
  const w: UrlWindow = {
    location: { pathname: '/', search: '', hash: '' },
    history: { pushState: () => {}, replaceState: () => {} },
  };
  return w;
}

function memStorage() {
  const m = new Map<string, string>();
  return {
    map: m,
    storage: createSafeStorage(() => ({
      getItem: (k: string) => m.get(k) ?? null,
      setItem: (k: string, v: string) => { m.set(k, v); },
      removeItem: (k: string) => { m.delete(k); },
    } as unknown as Storage)),
  };
}

/** Экран, который открывает запись так, как это делает список v2. */
function Screen() {
  const api = useKitShell();
  return <button type="button" onClick={() => api.openRecord('SPRINT_A', { title: 'Спринт А', href: '/?sec=sprint&open=SPRINT_A' })}>открыть</button>;
}

/** Экран вне оболочки: useOptionalKitShell не должен падать. */
function Standalone() {
  const api = useOptionalKitShell();
  return <p data-testid="api">{api ? 'есть' : 'нет'}</p>;
}

const recent = () => within(screen.getByRole('navigation', { name: 'Разделы' })).getByRole('region', { name: 'Недавние' });

describe('«Недавние» наполняются', () => {
  it('положительный контроль: до открытия список честно пуст', () => {
    const { storage } = memStorage();
    render(<KitShell config={CONFIG} win={fakeWin()} storage={storage} narrow={false}><Screen /></KitShell>);
    expect(recent().textContent).toMatch(/Пока пусто/);
  });

  it('после открытия записи она в списке — с названием, а не одним кодом', () => {
    const { storage } = memStorage();
    render(<KitShell config={CONFIG} win={fakeWin()} storage={storage} narrow={false}><Screen /></KitShell>);
    fireEvent.click(screen.getByRole('button', { name: 'открыть' }));
    expect(within(recent()).getByText('Спринт А')).toBeTruthy();
    expect(within(recent()).getByText('SPRINT_A')).toBeTruthy();
  });

  it('название переживает перезагрузку: оно рядом со списком, а не в памяти вкладки', () => {
    const { storage } = memStorage();
    const first = render(<KitShell config={CONFIG} win={fakeWin()} storage={storage} narrow={false}><Screen /></KitShell>);
    fireEvent.click(screen.getByRole('button', { name: 'открыть' }));
    first.unmount();
    render(<KitShell config={CONFIG} win={fakeWin()} storage={storage} narrow={false}><Screen /></KitShell>);
    expect(within(recent()).getByText('Спринт А')).toBeTruthy();
  });

  it('открыли без названия — печатается код и честная пометка, а не выдуманное имя', () => {
    const { storage } = memStorage();
    function NoTitle() {
      const api = useKitShell();
      return <button type="button" onClick={() => api.openRecord('X-1')}>открыть</button>;
    }
    render(<KitShell config={CONFIG} win={fakeWin()} storage={storage} narrow={false}><NoTitle /></KitShell>);
    fireEvent.click(screen.getByRole('button', { name: 'открыть' }));
    expect(within(recent()).getByText('X-1')).toBeTruthy();
    expect(within(recent()).getByText(/нет в выгрузке/i)).toBeTruthy();
  });

  it('вне оболочки useOptionalKitShell отвечает «нет», а не падает', () => {
    render(<Standalone />);
    expect(screen.getByTestId('api').textContent).toBe('нет');
  });
});

describe('недавнее — ссылка, когда адрес известен', () => {
  it('открыли с адресом — пункт стал ссылкой на ту же запись', () => {
    const { storage } = memStorage();
    render(<KitShell config={CONFIG} win={fakeWin()} storage={storage} narrow={false}><Screen /></KitShell>);
    fireEvent.click(screen.getByRole('button', { name: 'открыть' }));
    const link = within(recent()).getByRole('link');
    expect(link.getAttribute('href')).toBe('/?sec=sprint&open=SPRINT_A');
  });

  it('адрес тоже переживает перезагрузку — иначе после неё пункт мёртв', () => {
    const { storage } = memStorage();
    const first = render(<KitShell config={CONFIG} win={fakeWin()} storage={storage} narrow={false}><Screen /></KitShell>);
    fireEvent.click(screen.getByRole('button', { name: 'открыть' }));
    first.unmount();
    render(<KitShell config={CONFIG} win={fakeWin()} storage={storage} narrow={false}><Screen /></KitShell>);
    expect(within(recent()).getByRole('link').getAttribute('href')).toBe('/?sec=sprint&open=SPRINT_A');
  });

  it('без адреса — кнопка, а не ссылка в никуда', () => {
    const { storage } = memStorage();
    function NoHref() {
      const api = useKitShell();
      return <button type="button" onClick={() => api.openRecord('X-1', { title: 'Икс' })}>открыть</button>;
    }
    render(<KitShell config={CONFIG} win={fakeWin()} storage={storage} narrow={false}><NoHref /></KitShell>);
    fireEvent.click(screen.getByRole('button', { name: 'открыть' }));
    expect(within(recent()).queryByRole('link')).toBeNull();
    expect(within(recent()).getByRole('button', { name: /Икс/ })).toBeTruthy();
  });
});
