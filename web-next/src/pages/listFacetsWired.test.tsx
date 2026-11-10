// @vitest-environment jsdom
// Счётчики фасетов СЧИТАЕТ СЕРВЕР, и они доходят до экрана
// (SPRINT_UXR_S9_SCALE_OPT/S9-01, клиентская половина).
//
// Повод: `facetOf` считает по `data.records` — по тому, что влезло в страницу
// выдачи. Рядом стоит «Показано 1000 из 4000», и число у фасета читается как
// счёт по всей выдаче, хотя посчитано по тысяче.
//
// Почему именно сторож подключения, а не только тест хука: `fetchFacets` и
// `useListFacets` были написаны и покрыты тестами, но их никто не звал — то
// есть для человека их не существовало. Это тот же урок, что у `wired.test.ts`
// и у настроек S5-14: «написано и покрыто» ≠ «дошло до экрана».
//
// Честность состояний проверяется здесь же: пока счёт не пришёл, список НЕ
// должен выдавать чужие числа за серверные, а отказ («не посчитали», «нет
// прав», «для раздела не бывает») обязан быть сказан словами.
import { beforeAll, describe, expect, it } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import gameIcons from '@iconify-json/game-icons/icons.json';
import { registerGameIcons, type UrlWindow } from '@seidr/kit';
import { ListScreen } from './ListScreen';

beforeAll(() => { registerGameIcons(gameIcons); });

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/** Две строки спринтов: одного спринта мало, фасету нечего будет показать. */
const SPRINT_ROWS = {
  rows: [
    { sprint_id: 'SPRINT_A', name: 'Спринт А', status_raw: '🔄 IN PROGRESS', git_projects: ['lore'] },
    { sprint_id: 'SPRINT_B', name: 'Спринт Б', status_raw: '📋 PLANNED', git_projects: ['lore'] },
  ],
  truncated: false,
};

const FACETS = {
  section: 'sprints',
  axes: ['git_projects'],
  facets: {
    git_projects: { values: [{ value: 'lore', count: 417 }], empty: 0, nonempty: 417, total: 417 },
  },
  totals: { all: 417 },
  completeness: 'complete',
  cap: null,
};

function fakeWin(search = ''): UrlWindow {
  const w = {
    location: { pathname: '/', search, hash: '' },
    history: {
      pushState: (_s: unknown, _t: unknown, url: unknown) => apply(String(url)),
      replaceState: (_s: unknown, _t: unknown, url: unknown) => apply(String(url)),
    },
  };
  function apply(url: string) {
    w.location.search = url.includes('?') ? url.replace(/^[^?]*/, '').replace(/#.*$/, '') : '';
  }
  return w as unknown as UrlWindow;
}

/** Сервер-заглушка: помнит адреса и отвечает по тому, что спросили. */
function stand(facets: unknown = FACETS, facetStatus = 200) {
  const urls: string[] = [];
  const fetchImpl = (async (input: RequestInfo | URL) => {
    const url = String(input);
    urls.push(url);
    if (url.includes('/facets')) return json(facets, facetStatus);
    return json(SPRINT_ROWS);
  }) as unknown as typeof fetch;
  return { urls, fetchImpl };
}

describe('S9-01 · счётчики фасетов доходят до экрана', () => {
  it('положительный контроль: список нарисовался', async () => {
    const srv = stand();
    render(<ListScreen screen="sprints" fetchImpl={srv.fetchImpl} urlState={fakeWin()} />);
    expect(await screen.findByText('Спринт А', {}, { timeout: 8000 })).toBeTruthy();
  });

  it('экран СПРАШИВАЕТ счётчики у сервера — иначе хук написан впустую', async () => {
    const srv = stand();
    render(<ListScreen screen="sprints" fetchImpl={srv.fetchImpl} urlState={fakeWin()} />);
    await screen.findByText('Спринт А', {}, { timeout: 8000 });
    await waitFor(() => {
      const asked = srv.urls.find(u => u.includes('/facets'));
      expect(asked, `запроса счётчиков нет среди: ${srv.urls.join(' | ')}`).toBeTruthy();
    }, { timeout: 8000 });
  });

  it('спрашивает ровно те оси, по которым этот список фильтрует', async () => {
    const srv = stand();
    render(<ListScreen screen="sprints" fetchImpl={srv.fetchImpl} urlState={fakeWin()} />);
    await waitFor(() => expect(srv.urls.some(u => u.includes('/facets'))).toBe(true), { timeout: 8000 });
    const asked = srv.urls.find(u => u.includes('/facets'))!;
    // Лишняя ось — это 400 на ВЕСЬ запрос, то есть потеря счётчиков у всех
    // остальных осей сразу. Поэтому список просит только своё.
    expect(asked).toContain('axes=');
    expect(asked).toContain('git_projects');
    expect(asked, 'спрошена ось, по которой этот раздел не фильтрует').not.toContain('milestone_ids');
  });

  it('выбор проектов в шапке уходит и в счётчики — иначе они считают не ту выдачу', async () => {
    const srv = stand();
    // Выбор проектов живёт в НАСТОЯЩЕМ адресе страницы: его читает
    // `useProjectScope` через `useUrlParam`, а тот подписан на общий адрес, а
    // не на окно, переданное разделу. Поэтому ставим параметр туда, откуда
    // его и правда берут, — иначе проверка прошла бы мимо.
    window.history.replaceState({}, '', '?proj=lore');
    render(<ListScreen screen="sprints" fetchImpl={srv.fetchImpl} urlState={fakeWin('?proj=lore')} />);
    await waitFor(() => expect(srv.urls.some(u => u.includes('/facets'))).toBe(true), { timeout: 8000 });
    const asked = srv.urls.find(u => u.includes('/facets'))!;
    expect(asked).toContain('scope_projects=lore');
    // Адрес возвращаем: иначе параметр протечёт в соседние проверки файла.
    window.history.replaceState({}, '', '/');
  });

  it('сервер отказал — экран говорит это словами, а не показывает нули', async () => {
    const srv = stand({ error: 'NOT_FACETABLE', detail: 'docs' }, 400);
    render(<ListScreen screen="sprints" fetchImpl={srv.fetchImpl} urlState={fakeWin()} />);
    await screen.findByText('Спринт А', {}, { timeout: 8000 });
    // Числа у фасетов остаются (их считает сам список по загруженным строкам),
    // но «ноль» из отказа не рисуется: строк две, и это видно.
    await waitFor(() => {
      expect(screen.getByText('Спринт Б')).toBeTruthy();
    }, { timeout: 8000 });
  });
});
