// @vitest-environment jsdom
// Аудит навигации 08.11.2026, находка P1: «"Недавние" пусто даже после
// открытия записи».
//
// Разбор: список открывает паспорт своим состоянием (?open=…), а «Недавнее»
// ведёт оболочка — и о том, что запись открыли, ей никто не сообщал. То есть
// пусто было не потому, что ничего не открывали.
//
// Здесь закрепляется связка целиком: щелчок по строке списка → запись в
// «Недавнем» оболочки, с названием и рабочим адресом. Экран живёт и вне
// оболочки (демо, тесты), поэтому второй тест — что без оболочки он не падает.
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import { fireEvent } from '@testing-library/react';
import gameIcons from '@iconify-json/game-icons/icons.json';
import { KitShell, createSafeStorage, registerGameIcons, type UrlWindow } from '@seidr/kit';
import { v2Config } from '../shell/v2Config';
import { ListScreen } from './ListScreen';

beforeAll(() => { registerGameIcons(gameIcons); });

const jsonRes = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });

function fakeFetch() {
  return vi.fn(async (input: RequestInfo | URL) => {
    const slice = new URL(String(input), 'http://lore.test').pathname.split('/').pop();
    if (slice === 'sprints') return jsonRes({ rows: [{ sprint_id: 'SP', name: 'Спринт SP', status_raw: '🔄 IN PROGRESS' }] });
    if (slice === 'tasks_of_sprints_batch' || slice === 'tasks_of_sprint') return jsonRes({ rows: [] });
    return jsonRes({ rows: [] });
  }) as unknown as typeof fetch;
}

function fakeWin(search = '?sec=sprint'): UrlWindow {
  const w: UrlWindow = {
    location: { pathname: '/', search, hash: '' },
    history: {
      pushState: (_s, _t, url) => {
        const s = String(url);
        w.location.search = s.includes('?') ? s.replace(/^[^?]*/, '').replace(/#.*$/, '') : '';
        w.location.hash = s.includes('#') ? s.replace(/^[^#]*/, '') : '';
      },
      replaceState: (_s, _t, url) => w.history.pushState(null, '', url),
    },
  };
  return w;
}

const mem = () => {
  const m = new Map<string, string>();
  return createSafeStorage(() => ({
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => { m.set(k, v); },
    removeItem: (k: string) => { m.delete(k); },
  } as unknown as Storage));
};

const recentBlock = () =>
  within(screen.getByRole('navigation', { name: 'Разделы' })).getByRole('region', { name: 'Недавние' });

describe('«Недавние» наполняются из списка', () => {
  it('положительный контроль: до открытия блок честно пуст', () => {
    const win = fakeWin();
    render(
      <KitShell config={v2Config('ru')} win={win} storage={mem()} narrow={false}>
        <ListScreen screen="sprints" fetchImpl={fakeFetch()} urlState={win} heading={false} />
      </KitShell>,
    );
    expect(recentBlock().textContent).toMatch(/Пока пусто/);
  });

  it('открытая запись появляется в «Недавнем» — названием и ссылкой', async () => {
    const win = fakeWin();
    render(
      <KitShell config={v2Config('ru')} win={win} storage={mem()} narrow={false}>
        <ListScreen screen="sprints" fetchImpl={fakeFetch()} urlState={win} heading={false} />
      </KitShell>,
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Спринт SP' }));
    const link = await waitFor(() => within(recentBlock()).getByRole('link'));
    expect(link.textContent).toContain('Спринт SP');
    expect(link.getAttribute('href')).toMatch(/open=SP/);
    // Место (place) в адрес недавнего не попадает: запись откроется там, где
    // человек смотрит сейчас.
    expect(link.getAttribute('href')).not.toMatch(/place=/);
  }, 15000);

  it('вне оболочки список работает и ничего не падает', async () => {
    const win = fakeWin();
    render(<ListScreen screen="sprints" fetchImpl={fakeFetch()} urlState={win} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Спринт SP' }));
    expect(screen.queryByRole('navigation', { name: 'Разделы' })).toBeNull();
    expect(win.location.search).toMatch(/open=SP/);
  }, 15000);
});
