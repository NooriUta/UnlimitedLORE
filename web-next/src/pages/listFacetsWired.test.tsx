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
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
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

// SPRINT_UXR_S9_SCALE_OPT/S9-03 — закреплённые значения фасета (текущие релизы)
// приходят с сервера в том же ответе /facets и доходят до панели фасета.
// Блоки фасета появляются только когда значений больше порога (FACET_SCALE.
// findFrom = 10), поэтому релизов здесь двенадцать.
describe('S9-03 · текущий релиз закреплён в фасете «Релиз»', () => {
  beforeEach(() => { window.history.replaceState({}, '', '/'); });

  const releases = Array.from({ length: 12 }, (_, i) => `v1.0.${i}`);
  const rows = {
    rows: releases.map((r, i) => ({
      sprint_id: `SPRINT_${i}`, name: `Спринт ${i}`, status_raw: '📋 PLANNED', git_projects: ['lore'], release_ids: [r],
    })),
    truncated: false,
  };
  const relAxis = { values: releases.map(value => ({ value, count: 1 })), empty: 0, nonempty: 12, total: 12 };

  function standPinned(pinned: unknown) {
    const fetchImpl = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/facets')) {
        return json({
          section: 'sprints', axes: ['release_ids'], facets: { release_ids: relAxis },
          totals: { all: 12 }, completeness: 'complete', cap: null, ...(pinned ? { pinned } : {}),
        });
      }
      return json(rows);
    }) as unknown as typeof fetch;
    return fetchImpl;
  }

  const openRelease = (c: HTMLElement) => {
    const btn = [...c.querySelectorAll<HTMLButtonElement>('.sk-facet__btn')]
      .find(b => b.querySelector('.sk-list__label')?.textContent === 'Релиз');
    expect(btn, 'кнопки фасета «Релиз» нет').toBeTruthy();
    fireEvent.click(btn!);
  };

  it('сервер назвал текущий релиз — он встаёт блоком «Закреплённые»', async () => {
    const { container } = render(
      <ListScreen screen="sprints" fetchImpl={standPinned({ release_ids: ['v1.0.11'] })} urlState={fakeWin()} />,
    );
    await screen.findByText('Спринт 0', {}, { timeout: 8000 });
    openRelease(container);
    // Счётчики (и с ними закреплённые) приходят вторым запросом — панель
    // открыта и перерисовывается, когда они пришли.
    await waitFor(() => {
      const sec = container.querySelector('.sk-facet__sec[data-sec="pinned"]');
      expect(sec, 'блока закреплённых нет').toBeTruthy();
      expect([...sec!.querySelectorAll('.sk-facet__vt')].map(e => e.textContent)).toEqual(['v1.0.11']);
    }, { timeout: 8000 });
  });

  it('положительный контроль: сервер ничего не закрепил — блока нет', async () => {
    const { container } = render(<ListScreen screen="sprints" fetchImpl={standPinned(null)} urlState={fakeWin()} />);
    await screen.findByText('Спринт 0', {}, { timeout: 8000 });
    openRelease(container);
    expect(container.querySelector('.sk-facet__sec[data-sec="pinned"]')).toBeNull();
    expect(container.querySelector('.sk-facet__sec')).toBeTruthy();
  });
});
