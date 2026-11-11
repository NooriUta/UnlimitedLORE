// @vitest-environment jsdom
// Аудит навигации 08.11.2026, находки P1:
//   • «Кнопка "← Спринты" док закрывается, но в адресе остаются place=bottom
//     #SPRINT_…» — мусорные параметры после выхода;
//   • «Крошка — элемент <button class="sk-crumbs__back">, не ссылка: путь
//     нельзя открыть в новой вкладке».
//
// Почему это не косметика. Адрес v2 — состояние: по оставшемуся `place` и
// якорю запись откроется снова, то есть «закрыл» и «поделился ссылкой на
// список» дают разные страницы. А крошка-кнопка молча отбирает у пути
// свойства пути: новую вкладку, копирование, средний клик.
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import gameIcons from '@iconify-json/game-icons/icons.json';
import { registerGameIcons, type UrlWindow } from '@seidr/kit';
import { ListScreen } from './ListScreen';
import ListPassport from '../record/ListPassport';

beforeAll(() => { registerGameIcons(gameIcons); });

const jsonRes = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });

function fakeFetch() {
  return vi.fn(async (input: RequestInfo | URL) => {
    const slice = new URL(String(input), 'http://lore.test').pathname.split('/').pop();
    if (slice === 'sprints') return jsonRes({ rows: [{ sprint_id: 'SP', name: 'Спринт SP', status_raw: '🔄 IN PROGRESS' }] });
    if (slice === 'tasks_of_sprints_batch' || slice === 'tasks_of_sprint') {
      return jsonRes({ rows: [{ task_uid: 'SP/T1', task_id: 'T1', title: 'Задача T1', status_raw: '✅ DONE', sprint_id: 'SP', order_index: 1 }] });
    }
    return jsonRes({ rows: [] });
  }) as unknown as typeof fetch;
}

/** Окно, в котором видно и query, и якорь: именно их пара и оставалась мусором. */
function fakeWin(search = '', hash = ''): UrlWindow {
  const w: UrlWindow = {
    location: { pathname: '/', search, hash },
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

const dock = (c: HTMLElement) => c.querySelector('[data-testid="kit-rec-dock"]');

describe('адрес после выхода из дока', () => {
  it('положительный контроль: запись открывается и пишется в адрес', async () => {
    const win = fakeWin();
    const { container } = render(<ListScreen screen="sprints" fetchImpl={fakeFetch()} urlState={win} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Спринт SP' }));
    await waitFor(() => expect(dock(container)).toBeTruthy());
    expect(win.location.search).toMatch(/open=SP/);
  });

  it('закрытие снимает и open, и place, и якорь', async () => {
    const win = fakeWin('', '#SP');
    const { container } = render(<ListScreen screen="sprints" fetchImpl={fakeFetch()} urlState={win} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Спринт SP' }));
    await waitFor(() => expect(dock(container)).toBeTruthy());

    fireEvent.click(screen.getByRole('button', { name: /^Вид/ }));
    fireEvent.click(within(screen.getByRole('radiogroup', { name: 'Паспорт открывается' })).getByRole('radio', { name: 'снизу' }));
    expect(win.location.search).toMatch(/place=bottom/);

    fireEvent.click(screen.getByRole('button', { name: 'Закрыть паспорт' }));
    expect(dock(container)).toBeNull();
    expect(win.location.search).not.toMatch(/open=/);
    expect(win.location.search).not.toMatch(/place=/);
    expect(win.location.hash).toBe('');
  });

  it('фильтры списка при этом не теряются — закрытие записи не трогает чужое', async () => {
    const win = fakeWin('?lq=поиск', '#SP');
    const { container } = render(<ListScreen screen="sprints" fetchImpl={fakeFetch()} urlState={win} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Спринт SP' }));
    await waitFor(() => expect(dock(container)).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Закрыть паспорт' }));
    expect(decodeURIComponent(win.location.search)).toMatch(/lq=поиск/);
  });
});

describe('крошка — ссылка на список', () => {
  it('у крошки есть адрес, и в нём нет ни записи, ни места', async () => {
    render(<ListPassport type="sprint" id="SP" placement="right" fetchImpl={fakeFetch()}
      backLabel="Спринты" backHref="/?sec=sprint" onBack={() => {}} />);
    const back = await screen.findByRole('link', { name: /Спринты/ });
    expect(back.getAttribute('href')).toBe('/?sec=sprint');
    expect(back.getAttribute('href')).not.toMatch(/open=|place=|#/);
  }, 15000);

  it('обычный щелчок остаётся возвратом внутри приложения', async () => {
    const onBack = vi.fn();
    render(<ListPassport type="sprint" id="SP" placement="right" fetchImpl={fakeFetch()}
      backLabel="Спринты" backHref="/?sec=sprint" onBack={onBack} />);
    const back = await screen.findByRole('link', { name: /Спринты/ });
    const ev = fireEvent.click(back, { button: 0 });
    expect(ev).toBe(false); // перехвачено приложением: перезагрузки нет
    expect(onBack).toHaveBeenCalledTimes(1);
  }, 15000);

  it('без адреса крошка остаётся кнопкой — поддельную ссылку не рисуем', async () => {
    render(<ListPassport type="sprint" id="SP" placement="right" fetchImpl={fakeFetch()}
      backLabel="Спринты" onBack={() => {}} />);
    expect(await screen.findByRole('button', { name: /Спринты/ })).toBeTruthy();
  }, 15000);
});

// D-24 (аудит 09.11, SPRINT_UXR_S4_UI_SHELL_LISTS/S4-28): «назад»/«вперёд»
// должны закрывать и открывать сам паспорт. Было: открытие писалось в адрес
// ЗАМЕНОЙ — шага в истории не возникало, и «назад» уводил со страницы целиком,
// а список за popstate не следил вовсе.
describe('D-24 · «назад» и «вперёд» управляют паспортом', () => {
  const popped = () => new Promise<void>(res => window.addEventListener('popstate', () => res(), { once: true }));

  it('открыли запись → «назад» закрывает паспорт, «вперёд» открывает снова', async () => {
    window.history.replaceState(null, '', '/');
    const { container } = render(<ListScreen screen="sprints" fetchImpl={fakeFetch()} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Спринт SP' }));
    await waitFor(() => expect(dock(container)).toBeTruthy());
    expect(window.location.search).toMatch(/open=SP/);

    let p = popped(); window.history.back(); await p;
    await waitFor(() => expect(dock(container)).toBeNull());
    expect(window.location.search).not.toMatch(/open=/);

    p = popped(); window.history.forward(); await p;
    await waitFor(() => expect(dock(container)).toBeTruthy());
    window.history.replaceState(null, '', '/');
  });
});

// S4-14: экран списка публикует цель палитры — открытую запись.
describe('S4-14 · экран списка отдаёт палитре открытую запись', () => {
  it('открыли — цель «запись SP»; закрыли — цели нет', async () => {
    const { getPaletteTarget } = await import('../palette/paletteTarget');
    const win = fakeWin();
    const { container } = render(<ListScreen screen="sprints" fetchImpl={fakeFetch()} urlState={win} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Спринт SP' }));
    await waitFor(() => expect(dock(container)).toBeTruthy());
    expect(getPaletteTarget()).toMatchObject({ type: 'record', record: { id: 'SP' } });
    fireEvent.click(within(dock(container) as HTMLElement).getAllByRole('button', { name: /Закрыть/ })[0]);
    await waitFor(() => expect(getPaletteTarget()).toBeNull());
  });
});
